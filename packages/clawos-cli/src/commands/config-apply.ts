/** Desired-state reconciliation using a preflight ownership guard and an atomic upstream SDK transaction.
 * The full-file revision is captured BEFORE ownership reads; any later edit refuses the commit, even --force.
 * Config values stay in mode-600 files and in the helper's memory, never in argv or output.
 */

import { existsSync, mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCell, resolveCellFromRegistry } from "../util/cell.js";
import { writeFileIfChanged, writeJson } from "../util/fsx.js";
import { parseFragment, type Json } from "../util/json5.js";
import { digest, readLockfile, writeLockfile } from "../util/lockfile.js";
import { canonicalize, diffPaths, mergeAll, type ConfigChange } from "../util/merge.js";
import { configRevision, transactionalPatch, openclaw, ownedSlice, readOwnedConfig, RESTART_REQUIRING } from "../util/openclaw.js";
import { StepError } from "../util/proc.js";
import type { GlobalOptions } from "../options.js";

/** Machine-readable result of a reconciliation, consumed by `test/phase-1.sh` to prove idempotence. */
export interface ConfigApplyResult {
  changed: boolean;
  /** Changed leaf paths, names only — never values. */
  changes: ConfigChange[];
  fingerprint: string;
  restarted: boolean;
  /** Owned paths a concurrent editor had changed, when the guard tripped. */
  conflicts?: string[] | undefined;
  /** True on the first reconciliation of a cell, when there is no recorded state to conflict with. */
  adopted?: boolean | undefined;
}

/** Read and merge `os/config.d/*.json5` in filename order. Numeric prefixes give the order; `90-local` wins. */
export function mergeFragments(configD: string): Json {
  if (!existsSync(configD)) throw new StepError(`missing fragment directory ${configD}`, "run `clawos install` first");
  const files = readdirSync(configD)
    .filter((name) => name.endsWith(".json5") || name.endsWith(".json"))
    .sort();
  if (files.length === 0) throw new StepError(`no config fragments in ${configD}`);
  return mergeAll(files.map((name) => parseFragment(readFileSync(join(configD, name), "utf8"), name)));
}

/**
 * Compare the live OS-owned paths against the digests recorded at the last successful apply.
 *
 * Returns paths changed since the last apply. This is only a preflight; the SDK transaction guards the write. When the lockfile
 * has no recorded digests the cell has never been reconciled, so there is nothing to conflict with and the
 * current state is adopted instead.
 */
export function detectConflicts(
  live: Map<string, Json | undefined>,
  recorded: Record<string, string> | undefined,
): { conflicts: string[]; adopted: boolean } {
  if (!recorded || Object.keys(recorded).length === 0) return { conflicts: [], adopted: true };
  const conflicts: string[] = [];
  for (const [path, value] of live) {
    const expected = recorded[path];
    if (expected === undefined) continue; // path was not OS-owned at the last apply
    if (digest(canonicalize(value)) !== expected) conflicts.push(path);
  }
  return { conflicts, adopted: false };
}

/** Digest every owned path of a config tree, for storage in the lockfile. */
export function digestOwned(live: Map<string, Json | undefined>): Record<string, string> {
  return Object.fromEntries([...live].map(([path, value]) => [path, digest(canonicalize(value))]));
}

/**
 * Reconcile one cell and return the verdict.
 *
 * Separated from the command wrapper so `clawos install` can run step 8 and report whether it actually changed
 * anything, rather than assuming it did.
 */
export async function reconcile(
  cellName: string,
  opts: { force?: boolean; dryRun?: boolean; skipRestart?: boolean; port?: number } = {},
): Promise<ConfigApplyResult> {
  const cell = opts.port === undefined ? resolveCellFromRegistry(cellName) : resolveCell(cellName, opts.port);
  const force = opts.force ?? false;
  const dryRunOnly = opts.dryRun ?? false;
  // `clawos install` reconciles at step 8, before the service exists at step 9. Restarting a service that has
  // not been installed yet fails ("Gateway service disabled"), so install defers the restart to the step that
  // owns the unit.
  const skipRestart = opts.skipRestart ?? false;
  const generatedPath = join(cell.osDir, "config.generated.json");

  const desired = mergeFragments(join(cell.osDir, "config.d"));
  const generated = `${JSON.stringify(desired, null, 2)}\n`;
  const fingerprint = digest(generated);

  const previous = existsSync(generatedPath) ? (JSON.parse(readFileSync(generatedPath, "utf8")) as Json) : {};
  const changes = diffPaths(previous, desired);

  // Step 3 — ownership guard. Reads the redacted snapshot, so no credential enters this process.
  const revision = configRevision(cell);
  const liveOwned = ownedSlice(readOwnedConfig(cell));
  if (configRevision(cell) !== revision) throw new StepError("config changed during ownership read; nothing written");
  const lock = readLockfile(cell);
  const { conflicts, adopted } = detectConflicts(liveOwned, lock?.ownedDigests);
  if (conflicts.length > 0 && !force) {
    return { changed: false, changes, fingerprint, restarted: false, conflicts };
  }

  // Idempotence: the fragments produced the same generated file and the live owned paths still match. A forced
  // run past a detected conflict is never in sync — the whole point is to rewrite the paths that drifted.
  const inSync =
    changes.length === 0 && lock?.configFingerprint === fingerprint && !adopted && conflicts.length === 0;
  if (inSync && !dryRunOnly) {
    return { changed: false, changes: [], fingerprint, restarted: false };
  }

  const staging = mkdtempSync(join(cell.osDir, ".config-apply-"));
  const candidatePath = join(staging, "candidate.json");
  try {
    writeFileIfChanged(candidatePath, generated, 0o600);

    // Step 4 — validate before writing anything.
    const dry = openclaw(cell, ["config", "patch", "--file", candidatePath, "--dry-run", "--json"]);
    if (dry.code !== 0) {
      throw new StepError("config patch --dry-run rejected the generated config; no upstream write performed");
    }
    if (dryRunOnly) {
      return { changed: changes.length > 0, changes, fingerprint, restarted: false };
    }

    // No gap between the caller's revision and upstream's lock/snapshot/atomic publication guard.
    const persistedRevision = transactionalPatch(cell, candidatePath, revision);
    if (configRevision(cell) !== persistedRevision) throw new StepError("config changed after commit; checkpoint not recorded");
    const afterDigests = digestOwned(ownedSlice(readOwnedConfig(cell)));
    if (configRevision(cell) !== persistedRevision) throw new StepError("config changed during verification; checkpoint not recorded");

    // Step 7 — lint. Exit 1 is findings (surfaced); exit 2 or worse is a hard failure.
    const lint = openclaw(cell, ["doctor", "--lint", "--json"]);
    let lintOk = false;
    try {
      const report = JSON.parse(lint.stdout) as { findings?: { severity?: string }[] };
      lintOk = lint.code <= 1 && Array.isArray(report.findings) && !report.findings.some(f => f.severity === "error");
    } catch { /* fail closed on missing/unparseable verdict */ }
    if (!lintOk) throw new StepError("doctor --lint failed after apply; checkpoint not recorded");

    const restartNeeded =
      !skipRestart && [...changes.map(c => c.path), ...conflicts].some(path => RESTART_REQUIRING.some(k => path === k || path.startsWith(`${k}.`)));
    let restarted = false;
    if (restartNeeded) {
      const restart = openclaw(cell, ["gateway", "restart"]);
      if (restart.code !== 0) throw new StepError(`gateway restart failed: ${restart.stderr || restart.stdout}`);
      restarted = true;
    }

    if (configRevision(cell) !== persistedRevision) throw new StepError("config changed before checkpoint; checkpoint not recorded");
    writeFileIfChanged(generatedPath, generated, 0o600);
    if (lock) {
      writeLockfile(cell, { ...lock, configFingerprint: fingerprint, ownedDigests: afterDigests });
    } else {
      // `clawos install` writes the lockfile in its last step; stash the digests so the guard is armed either way.
      writeJson(join(cell.osDir, "config.state.json"), { configFingerprint: fingerprint, ownedDigests: afterDigests });
    }

    return { changed: true, changes, fingerprint, restarted, adopted: adopted || undefined };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** `clawos config apply` command wrapper: run the reconciliation and render its verdict. */
export async function configApply(args: string[], globals: GlobalOptions): Promise<number> {
  const result = await reconcile(globals.cell, {
    force: args.includes("--force"),
    dryRun: args.includes("--dry-run"),
  });

  if (globals.json) {
    console.log(JSON.stringify(result));
  } else if (result.conflicts?.length) {
    console.error("clawos config apply: OS-owned config paths changed outside the OS since the last apply:");
    for (const path of result.conflicts) console.error(`  - ${path}`);
    console.error("Move settings you want to keep into os/config.d/90-local.json5, or re-run with --force.");
  } else if (!result.changed) {
    console.log("clawos config apply: already in sync (no diff)");
  } else {
    for (const change of result.changes) console.log(`  ${change.kind.padEnd(7)} ${change.path}`);
    console.log(`clawos config apply: ${result.changes.length} path(s) changed${result.restarted ? "; gateway restarted" : ""}`);
  }
  return result.conflicts?.length ? 1 : 0;
}
