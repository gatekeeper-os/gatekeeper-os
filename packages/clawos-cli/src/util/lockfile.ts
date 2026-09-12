/**
 * `os/clawos.lock.json` — the pin, plus the reconciliation bookkeeping `clawos config apply` needs (plan §6.1).
 *
 * `ownedDigests` is the addition Phase 1 makes to the §6.1 shape. It records, per OS-owned config path, a digest of
 * the value the OS last wrote there. The next `config apply` re-reads those paths and refuses to run when one of
 * them changed underneath it. That is the concurrent-edit protection the plan attributed to
 * `config patch --expect-current-json`, which does not exist on `config patch` in 2026.9.2 (see plan §6.2).
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Cell } from "./cell.js";
import { readJson, writeJson } from "./fsx.js";

/** On-disk shape of `os/clawos.lock.json`. */
export interface Lockfile {
  schemaVersion: 1;
  cell: string;
  upstream: {
    package: "openclaw";
    version: string;
    channel: string;
    installedAt: string;
    nodeVersion: string;
  };
  lastKnownGood?: { version: string; verifiedAt: string } | undefined;
  plugins: Record<string, string>;
  kernelSchema: number;
  /** Verified per-cell immutable upstream entrypoint selected by the update drop-in. */
  runtimeBinary?: string;
  /** `sha256:…` over the whole generated config, for a cheap "did anything change at all" check. */
  configFingerprint?: string | undefined;
  /** Per-owned-path digests of the values the OS last wrote. See the module comment. */
  ownedDigests?: Record<string, string> | undefined;
}

/** Path of a cell's lockfile. */
export function lockfilePath(cell: Cell): string {
  return join(cell.osDir, "clawos.lock.json");
}

/** Read a cell's lockfile, or `undefined` when the cell has never been installed. */
export function readLockfile(cell: Cell): Lockfile | undefined {
  return readJson<Lockfile>(lockfilePath(cell));
}

/** Write a cell's lockfile at mode 600. Returns true when the content changed. */
export function writeLockfile(cell: Cell, lock: Lockfile): boolean {
  return writeJson(lockfilePath(cell), lock, 0o600);
}

/** `sha256:<hex>` over a string, the digest form used for both the fingerprint and the owned-path digests. */
export function digest(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}
