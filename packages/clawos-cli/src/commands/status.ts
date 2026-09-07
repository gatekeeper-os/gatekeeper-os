/**
 * `clawos status` — is this cell healthy?
 *
 * Health is defined as: the systemd user unit is active, the Gateway answers `/readyz`, the installed upstream
 * version equals the pin, and the OS state directory exists. Phase 1 stops there deliberately — `os.status` over
 * the Gateway RPC is a kernel surface and the kernel does not exist until Phase 3 — so the result names what it
 * could not observe rather than letting a green status be read as more than it is.
 */

import { existsSync } from "node:fs";
import { resolveCellFromRegistry } from "../util/cell.js";
import { readLockfile } from "../util/lockfile.js";
import { installedVersion, waitForEndpoint } from "../util/openclaw.js";
import { run } from "../util/proc.js";
import type { GlobalOptions } from "../options.js";

/** Machine-readable cell health. */
export interface StatusResult {
  cell: string;
  healthy: boolean;
  unitActive: boolean;
  ready: boolean;
  port: number;
  installedVersion?: string | undefined;
  pinnedVersion?: string | undefined;
  versionMatchesPin: boolean;
  stateDir: string;
  osDirPresent: boolean;
  /** Surfaces this phase cannot yet observe. */
  notObserved: string[];
}

/** True when a systemd user unit reports `active`. */
export function unitIsActive(unit: string): boolean {
  if (process.platform === "darwin") {
    const status = run("launchctl", ["print", `gui/${process.getuid!()}/${unit}`]);
    return status.code === 0 && /^\s*state = running\s*$/m.test(status.stdout);
  }
  return run("systemctl", ["--user", "is-active", "--quiet", unit]).code === 0;
}

export async function status(_args: string[], globals: GlobalOptions): Promise<number> {
  const cell = resolveCellFromRegistry(globals.cell);
  const lock = readLockfile(cell);
  const installed = installedVersion(cell);
  const pinned = lock?.upstream.version;

  const unitActive = unitIsActive(cell.unit);
  const ready = unitActive ? await waitForEndpoint(cell.port, "/readyz", 15_000) : false;
  const osDirPresent = existsSync(cell.osDir);
  const versionMatchesPin = Boolean(installed && pinned && installed === pinned);

  const result: StatusResult = {
    cell: cell.name,
    healthy: unitActive && ready && osDirPresent && versionMatchesPin,
    unitActive,
    ready,
    port: cell.port,
    installedVersion: installed,
    pinnedVersion: pinned,
    versionMatchesPin,
    stateDir: cell.stateDir,
    osDirPresent,
    notObserved: ["kernel os.status (Phase 3)", "grants (Phase 3)", "approvals (Phase 5)"],
  };

  if (globals.json) {
    console.log(JSON.stringify(result));
  } else {
    console.log(`cell ${result.cell}: ${result.healthy ? "healthy" : "NOT healthy"}`);
    console.log(`  unit ${cell.unit}: ${unitActive ? "active" : "inactive"}`);
    console.log(`  /readyz on ${cell.port}: ${ready ? "ok" : "no"}`);
    console.log(`  upstream: ${installed ?? "not installed"} (pin ${pinned ?? "none"})`);
    console.log(`  state dir: ${cell.stateDir}${osDirPresent ? "" : " (no os/ — not installed)"}`);
    console.log(`  not observed in this phase: ${result.notObserved.join(", ")}`);
  }
  return result.healthy ? 0 : 1;
}
