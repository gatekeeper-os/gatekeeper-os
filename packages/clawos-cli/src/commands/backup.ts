/**
 * `clawos backup create|restore` — cell backup and rollback on top of upstream's archive mechanism.
 *
 * INVARIANT 1 forbids reading upstream's SQLite, so nothing here opens a database. `openclaw backup create`
 * archives the whole state directory (so `os/` is included — VERIFIED, `docs/upstream-reference.md`) and
 * `openclaw backup verify` checks integrity, including the SQLite payloads, before we act on an archive.
 *
 * Two upstream constraints shape the design and neither is optional:
 *
 *  - **Output cannot live inside the state tree.** Upstream rejects an output path inside the source state or
 *    workspace tree to avoid self-inclusion. So archives go to `~/.clawos/backups/<cell>/`, not to
 *    `os/backups/` as plan §3.3 sketched. The plan is corrected accordingly.
 *  - **Restore is never in place.** `openclaw backup restore` requires a fresh empty target, has no `--force`,
 *    and leaves activation to the operator. `clawos backup restore` performs exactly upstream's documented
 *    activation sequence — stop the Gateway, move current state aside (never delete it), move the extracted
 *    state asset into place, run `doctor`, restart — so a failed restore is always recoverable.
 */

import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveCellFromRegistry, type Cell } from "../util/cell.js";
import { ensureDir, readJson } from "../util/fsx.js";
import { openclaw, waitForEndpoint } from "../util/openclaw.js";
import { run, StepError } from "../util/proc.js";
import type { GlobalOptions } from "../options.js";

/** Where a cell's archives live — outside the state tree, because upstream rejects self-inclusion. */
export function backupDir(cell: Cell): string {
  return join(homedir(), ".clawos", "backups", cell.name);
}

/** The subset of upstream's schema-version-1 manifest this command relies on. */
interface BackupManifest {
  archiveRoot?: string;
  assets?: { kind: string; sourcePath: string; archivePath: string }[];
}

export async function backup(args: string[], globals: GlobalOptions): Promise<number> {
  const sub = args[0];
  if (sub === "create") return backupCreate(globals);
  if (sub === "restore") return backupRestore(args.slice(1), globals);
  console.error("usage: clawos backup create | clawos backup restore <archive.tar.gz> --yes");
  return 2;
}

async function backupCreate(globals: GlobalOptions): Promise<number> {
  const cell = resolveCellFromRegistry(globals.cell);
  const output = backupDir(cell);
  ensureDir(output, 0o700);
  const before = new Set(existsSync(output) ? readdirSync(output) : []);

  const result = openclaw(cell, ["backup", "create", "--output", output, "--verify", "--json"]);
  if (result.code !== 0) throw new StepError(`openclaw backup create failed: ${result.stderr || result.stdout}`);

  // Prefer the archive path upstream reports; fall back to the file that appeared in the output directory.
  const reported = (() => {
    try {
      const parsed = JSON.parse(result.stdout) as { archive?: string; path?: string; output?: string };
      return parsed.archive ?? parsed.path ?? parsed.output;
    } catch {
      return undefined;
    }
  })();
  const appeared = readdirSync(output).filter((name) => !before.has(name) && name.endsWith(".tar.gz"));
  const archive = reported ?? (appeared[0] ? join(output, appeared[0]) : undefined);
  if (!archive) throw new StepError("backup created but the archive path could not be determined");

  if (globals.json) console.log(JSON.stringify({ cell: cell.name, archive, verified: true }));
  else console.log(`backup created and verified: ${archive}`);
  return 0;
}

async function backupRestore(args: string[], globals: GlobalOptions): Promise<number> {
  const cell = resolveCellFromRegistry(globals.cell);
  const archive = args.find((a) => !a.startsWith("--"));
  if (!archive) throw new StepError("clawos backup restore requires an archive path");
  if (!existsSync(archive)) throw new StepError(`archive not found: ${archive}`);
  if (!globals.yes) throw new StepError("restore replaces this cell's state directory", "re-run with --yes");

  // 1. Verify before touching anything.
  const verify = openclaw(cell, ["backup", "verify", archive]);
  if (verify.code !== 0) throw new StepError(`archive failed verification: ${verify.stderr || verify.stdout}`);

  // 2. Extract to a fresh directory outside the state tree — upstream refuses a non-empty target.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const staging = join(homedir(), ".clawos", "restore", `${cell.name}-${stamp}`);
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  const restore = openclaw(cell, ["backup", "restore", archive, "--target", staging]);
  if (restore.code !== 0) throw new StepError(`openclaw backup restore failed: ${restore.stderr || restore.stdout}`);

  // 3. Locate the state asset through the manifest, which is the documented source of truth.
  //
  // `archivePath` is recorded relative to the extraction directory and already includes the archive-root segment
  // (e.g. `<root>/payload/posix/home/tester/.openclaw`), so it resolves against `staging`, not against the
  // archive root. The archive-root fallback covers any archive that records it the other way.
  const root = findArchiveRoot(staging);
  const manifest = readJson<BackupManifest>(join(root, "manifest.json"));
  const stateAsset = manifest?.assets?.find((asset) => asset.kind === "state");
  if (!stateAsset) throw new StepError("restored archive has no state asset in its manifest");
  const restoredState = [join(staging, stateAsset.archivePath), join(root, stateAsset.archivePath)].find((p) =>
    existsSync(p),
  );
  if (!restoredState) throw new StepError("manifest names a state asset that is not in the archive");

  // 4. Activation, exactly as upstream documents it: stop, move current state aside, move the asset into place.
  run("systemctl", ["--user", "stop", cell.unit]);
  const aside = `${cell.stateDir}.pre-restore-${stamp}`;
  if (existsSync(cell.stateDir)) renameSync(cell.stateDir, aside);
  try {
    renameSync(restoredState, cell.stateDir);
  } catch (error) {
    if (existsSync(aside)) renameSync(aside, cell.stateDir); // put the cell back before reporting
    run("systemctl", ["--user", "start", cell.unit]);
    throw new StepError(`could not move the restored state into place: ${String(error)}`);
  }

  // 4b. Re-assert the permission invariants. Extraction applies the archive's own modes under the current umask,
  // so a restored state directory can come back more permissive than the cell requires (observed: 775 on
  // `~/.openclaw`). A restore that silently loosens the security posture would be a real regression, so the modes
  // are enforced here rather than left for `clawos doctor` to report afterwards.
  ensureDir(cell.stateDir, 0o700);
  ensureDir(cell.osDir, 0o700);
  for (const [file, mode] of [
    [cell.configPath, 0o600],
    [join(cell.osDir, "cell.key"), 0o600],
    [join(cell.stateDir, ".env"), 0o600],
  ] as const) {
    if (existsSync(file)) chmodSync(file, mode);
  }

  // 5. doctor before restarting, then verify the cell actually came back.
  const doctor = openclaw(cell, ["doctor", "--non-interactive"]);
  const start = run("systemctl", ["--user", "start", cell.unit]);
  if (start.code !== 0) throw new StepError(`could not start ${cell.unit} after restore: ${start.stderr}`);
  const ready = await waitForEndpoint(cell.port, "/readyz", 60_000);

  const result = {
    cell: cell.name,
    archive,
    restoredFrom: staging,
    previousStateKept: aside,
    doctorExit: doctor.code,
    ready,
  };
  if (globals.json) console.log(JSON.stringify(result));
  else {
    console.log(`restored ${cell.name} from ${archive}`);
    console.log(`  previous state kept at ${aside}`);
    console.log(`  /readyz: ${ready ? "ok" : "NOT ready"}`);
  }
  return ready ? 0 : 1;
}

/** The extracted tree keeps the archive root as its single top-level directory (or is the root itself). */
function findArchiveRoot(staging: string): string {
  if (existsSync(join(staging, "manifest.json"))) return staging;
  const entries = readdirSync(staging);
  for (const entry of entries) {
    if (existsSync(join(staging, entry, "manifest.json"))) return join(staging, entry);
  }
  throw new StepError("could not find manifest.json in the restored archive");
}
