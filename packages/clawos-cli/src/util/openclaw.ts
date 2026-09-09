/**
 * The upstream `openclaw` CLI, wrapped.
 *
 * Every upstream invocation goes through here so that (a) the cell's environment is applied consistently, (b) the
 * set of upstream CLI surfaces the OS depends on is enumerable in one file for `docs/upstream-reference.md`, and
 * (c) an upstream flag rename is a one-file change. This is the host-layer analogue of the kernel's
 * `src/upstream/` rule in `AGENTS.md` §2.
 */

import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import type { Cell } from "./cell.js";
import type { Json } from "./json5.js";
import { getPath } from "./merge.js";
import { run, runJson, StepError, type RunResult } from "./proc.js";

/**
 * Config subtrees the OS owns (plan §6.2 INVARIANT). Everything else — channels, models, auth profiles — belongs
 * to the operator and is never written, and never guarded, by the OS.
 */
export const OWNED_PATHS = [
  "gateway.auth",
  "gateway.bind",
  "gateway.mode",
  "gateway.reload",
  "tools",
  "plugins.entries.clawos-kernel",
  "plugins.entries.gatekeeper-fs",
  "plugins.deny",
  "plugins.allow",
  "plugins.load",
  "security.installPolicy",
  "agents.defaults.sandbox",
  "update",
  "hooks.internal.entries.clawos-bootstrap",
  "hooks.internal.entries.clawos-lifecycle",
] as const;

/**
 * Top-level roots covering {@link OWNED_PATHS}. Reading these seven is enough to evaluate every owned path, which
 * keeps a reconciliation to seven upstream invocations instead of one per path.
 */
const OWNED_ROOTS = ["gateway", "tools", "plugins", "agents", "update", "hooks", "security"] as const;

/** Config keys whose change requires a Gateway restart; everything else hot-applies under `gateway.reload.mode`. */
export const RESTART_REQUIRING = ["gateway.port", "gateway.bind", "gateway.auth", "gateway.tls", "gateway.mode", "plugins"];

/** Run the upstream CLI for a cell. Secrets are passed through `env`, never through `args`. */
export function openclaw(cell: Cell, args: string[], extraEnv?: NodeJS.ProcessEnv): RunResult {
  return run("openclaw", args, { ...cell.env, ...extraEnv });
}

/** Run the upstream CLI and parse JSON stdout. */
export function openclawJson<T>(cell: Cell, args: string[], extraEnv?: NodeJS.ProcessEnv): T | undefined {
  return runJson<T>("openclaw", args, { ...cell.env, ...extraEnv });
}

/** Installed upstream version, e.g. `2026.9.2`, or `undefined` when `openclaw` is absent or unreadable. */
export function installedVersion(cell: Cell): string | undefined {
  const result = openclaw(cell, ["--version"]);
  if (result.code !== 0) return undefined;
  return /[0-9]{4}\.[0-9]+\.[0-9]+/.exec(result.stdout)?.[0];
}

/**
 * Read the authored config for every OS-owned root, from upstream's **redacted** snapshot.
 *
 * `config get --json` prints redacted values (secrets never print — VERIFIED, `docs/cli/config.md`), so a
 * credential never enters this process, never reaches a digest, and cannot leak into a diff or an artifact. The
 * cost is that a change confined to a secret's *value* is invisible to the ownership guard; the OS owns no
 * credential leaf directly (`gateway.auth.token` is an env SecretRef), so that is an accepted limitation
 * and is recorded in `docs/upstream-reference.md`.
 */
export function readOwnedConfig(cell: Cell): Json {
  const out: { [key: string]: Json } = {};
  for (const root of OWNED_ROOTS) {
    const result = openclaw(cell, ["config", "get", root, "--json"]);
    let value: Json;
    try { value = JSON.parse(result.stdout) as Json; }
    catch { throw new StepError(`could not read owned config root ${root}; refusing reconciliation`); }
    if (result.code === 0) { out[root] = value; continue; }
    const failure = value as { ok?: boolean; error?: { message?: string } };
    if (result.code === 1 && failure?.ok === false &&
        failure.error?.message?.startsWith(`Config path is valid but unset: ${root}.`)) continue;
    throw new StepError(`could not read owned config root ${root}; refusing reconciliation`);
  }
  return out;
}

/** Extract the OS-owned paths from a config tree, as a path → canonical-value map. */
export function ownedSlice(config: Json): Map<string, Json | undefined> {
  return new Map(OWNED_PATHS.map((path) => [path, getPath(config, path)]));
}

/** `openclaw config patch --file <path>`; `--dry-run` adds schema and SecretRef resolvability checks. */
export function configPatch(cell: Cell, file: string, dryRun: boolean): RunResult {
  const args = ["config", "patch", "--file", file];
  if (dryRun) args.push("--dry-run", "--json");
  return openclaw(cell, args);
}

/** Poll a Gateway HTTP health endpoint until it answers 200 or the budget expires. */
export async function waitForEndpoint(port: number, path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Read `KEY=value` pairs from a cell's `.env`, used to load the Gateway token without putting it on a argv. */
export function readEnvFile(path: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) out[match[1]!] = match[2]!;
  }
  return out;
}

/** Raw authored-file revision (the public SDK baseHash contract). Never returns config values. */
export function configRevision(cell: Cell): string {
  return createHash("sha256").update(readFileSync(cell.configPath)).digest("hex");
}

/** Commit through the installed public SDK in a separate cell-scoped process, without config in argv. */
export function transactionalPatch(cell: Cell, file: string, revision: string): string {
  const binary = run("sh", ["-c", "command -v openclaw"]);
  if (binary.code !== 0) throw new StepError("openclaw is not on PATH");
  const helper = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "config-transaction.mjs");
  const result = run(process.execPath, [helper, binary.stdout.trim(), file, revision], cell.env);
  if (result.code !== 0) throw new StepError("config transaction refused: config changed or validation failed; retry after reviewing live config");
  try {
    const parsed = JSON.parse(result.stdout) as { persistedHash?: string };
    if (parsed.persistedHash && /^[a-f0-9]{64}$/.test(parsed.persistedHash)) return parsed.persistedHash;
  } catch { /* fail closed, never echo SDK output */ }
  throw new StepError("config transaction returned no valid persisted revision");
}
