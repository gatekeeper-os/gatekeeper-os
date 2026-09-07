/**
 * `clawos config apply` — desired-state reconciliation of `os/config.d/*.json5` into upstream's `openclaw.json`.
 *
 * This implements plan §6.2 as corrected in Phase 1. The plan originally specified step 4 as
 * "`openclaw config patch … --expect-current-json` on the paths the OS owns, with `--merge` on protected maps".
 * Neither flag exists on `config patch` in `openclaw@2026.9.2`: the conditional-write flags apply only to a single
 * `config set` (and are explicitly incompatible with batch mode and `--dry-run`), and `--merge` is a `config set`
 * flag that `config patch` does not need because a patch already merges objects recursively.
 *
 * Reverting to per-path `config set --expect-current-json <value>` was rejected: it would place the *expected
 * current value* of every OS-owned path — including `gateway.auth` — into an argument vector, a process listing
 * and any shell trace, which the secrecy invariant forbids outright.
 *
 * The replacement keeps the protection and drops the leak. Ownership is tracked by digest:
 *
 *   1. Merge fragments in filename order → `os/config.generated.json`.
 *   2. Diff against the previously generated file and print the changed **paths** (never values).
 *   3. Guard: re-read the OS-owned paths from upstream's redacted config snapshot and compare each against the
 *      digest recorded in the lockfile at the last successful apply. A mismatch means somebody edited an
 *      OS-owned path outside the OS — abort, change nothing, and name the paths. Fails closed.
 *   4. `config patch --file … --dry-run` for schema and SecretRef validation; abort on failure.
 *   5. Real `config patch --file …`. No `--replace-path`: protected maps such as `agents.entries` and
 *      `plugins.entries` merge recursively, so operator-added entries survive.
 *   6. Verify the postcondition by re-reading the owned paths, which also closes the check-to-write race in the
 *      direction we can observe. Upstream's own config snapshot guard covers the final file replacement.
 *   7. `doctor --lint --json`, then record the fingerprint and the new owned digests.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCell } from "../util/cell.js";
import { writeFileIfChanged, writeJson } from "../util/fsx.js";
import { parseFragment, type Json } from "../util/json5.js";
import { digest, readLockfile, writeLockfile } from "../util/lockfile.js";
import { canonicalize, diffPaths, mergeAll, type ConfigChange } from "../util/merge.js";
import { openclaw, ownedSlice, readOwnedConfig, RESTART_REQUIRING } from "../util/openclaw.js";
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
 * Returns the paths that changed underneath the OS. An empty result means it is safe to write. When the lockfile
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
  opts: { force?: boolean; dryRun?: boolean } = {},
): Promise<ConfigApplyResult> {
  const cell = resolveCell(cellName);
  const force = opts.force ?? false;
  const dryRunOnly = opts.dryRun ?? false;
  const generatedPath = join(cell.osDir, "config.generated.json");

  const desired = mergeFragments(join(cell.osDir, "config.d"));
  const generated = `${JSON.stringify(desired, null, 2)}\n`;
  const fingerprint = digest(generated);

  const previous = existsSync(generatedPath) ? (JSON.parse(readFileSync(generatedPath, "utf8")) as Json) : {};
  const changes = diffPaths(previous, desired);

  // Step 3 — ownership guard. Reads the redacted snapshot, so no credential enters this process.
  const liveOwned = ownedSlice(readOwnedConfig(cell));
  const lock = readLockfile(cell);
  const { conflicts, adopted } = detectConflicts(liveOwned, lock?.ownedDigests);
  if (conflicts.length > 0 && !force) {
    return { changed: false, changes, fingerprint, restarted: false, conflicts };
  }

  // Idempotence: the fragments produced the same generated file and the live owned paths still match.
  const inSync = changes.length === 0 && lock?.configFingerprint === fingerprint && !adopted;
  if (inSync && !dryRunOnly) {
    return { changed: false, changes: [], fingerprint, restarted: false };
  }

  writeFileIfChanged(generatedPath, generated, 0o600);

  // Step 4 — validate before writing anything.
  const dry = openclaw(cell, ["config", "patch", "--file", generatedPath, "--dry-run", "--json"]);
  if (dry.code !== 0) {
    throw new StepError(`config patch --dry-run rejected the generated config: ${dry.stderr || dry.stdout}`);
  }
  if (dryRunOnly) {
    return { changed: changes.length > 0, changes, fingerprint, restarted: false };
  }

  // Step 5 — the real write. Objects merge recursively; no --replace-path, so operator entries survive.
  const patch = openclaw(cell, ["config", "patch", "--file", generatedPath]);
  if (patch.code !== 0) throw new StepError(`config patch failed: ${patch.stderr || patch.stdout}`);

  // Step 6 — postcondition: re-read what upstream actually stored on the owned paths.
  const afterDigests = digestOwned(ownedSlice(readOwnedConfig(cell)));

  // Step 7 — lint. Exit 1 is findings (surfaced); exit 2 or worse is a hard failure.
  const lint = openclaw(cell, ["doctor", "--lint", "--json"]);
  if (lint.code >= 2) throw new StepError(`doctor --lint failed after apply: ${lint.stderr || lint.stdout}`);

  const restartNeeded = changes.some((c) => RESTART_REQUIRING.some((k) => c.path === k || c.path.startsWith(`${k}.`)));
  let restarted = false;
  if (restartNeeded) {
    const restart = openclaw(cell, ["gateway", "restart"]);
    if (restart.code !== 0) throw new StepError(`gateway restart failed: ${restart.stderr || restart.stdout}`);
    restarted = true;
  }

  if (lock) {
    writeLockfile(cell, { ...lock, configFingerprint: fingerprint, ownedDigests: afterDigests });
  } else {
    // `clawos install` writes the lockfile in its last step; stash the digests so the guard is armed either way.
    writeJson(join(cell.osDir, "config.state.json"), { configFingerprint: fingerprint, ownedDigests: afterDigests });
  }

  return { changed: true, changes, fingerprint, restarted, adopted: adopted || undefined };
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
