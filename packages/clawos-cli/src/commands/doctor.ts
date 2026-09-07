/**
 * `clawos doctor` — host-layer health checks with fix hints (plan §9 Phase 1 step 5).
 *
 * This is the OS's own check, not a wrapper around upstream's: it runs `openclaw doctor --lint` and then adds the
 * things upstream has no reason to know about — the permission criteria, the lockfile-versus-installed pin, the
 * drop-in, the unit, and disk headroom. Findings carry a severity and a hint; nothing is repaired implicitly.
 */

import { existsSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveCellFromRegistry } from "../util/cell.js";
import { modeOf } from "../util/fsx.js";
import { readLockfile } from "../util/lockfile.js";
import { installedVersion, openclaw } from "../util/openclaw.js";
import { unitIsActive } from "./status.js";
import type { GlobalOptions } from "../options.js";

/** One diagnostic. `error` means the cell is misconfigured; `warn` means it works but should be looked at. */
export interface Finding {
  id: string;
  severity: "error" | "warn";
  message: string;
  hint?: string | undefined;
}

/** Paths whose mode is a Phase 1 acceptance criterion, with the mode each must have. */
export function permissionTargets(stateDir: string): { path: string; mode: number }[] {
  return [
    { path: stateDir, mode: 0o700 },
    { path: join(stateDir, "openclaw.json"), mode: 0o600 },
    { path: join(stateDir, "os"), mode: 0o700 },
    { path: join(stateDir, "os", "cell.key"), mode: 0o600 },
    { path: join(stateDir, ".env"), mode: 0o600 },
  ];
}

/** Check every permission target that exists. A missing file is not a permission finding. */
export function checkPermissions(stateDir: string): Finding[] {
  return permissionTargets(stateDir).flatMap(({ path, mode }) => {
    const actual = modeOf(path);
    if (actual === undefined || actual === mode) return [];
    return [{
      id: "permissions",
      severity: "error" as const,
      message: `${path} is ${actual.toString(8)}, expected ${mode.toString(8)}`,
      hint: `chmod ${mode.toString(8)} ${path}`,
    }];
  });
}

export async function doctor(_args: string[], globals: GlobalOptions): Promise<number> {
  const cell = resolveCellFromRegistry(globals.cell);
  const findings: Finding[] = [];

  if (!existsSync(cell.osDir)) {
    findings.push({ id: "not-installed", severity: "error", message: `${cell.osDir} is missing`, hint: "clawos install" });
  }

  findings.push(...checkPermissions(cell.stateDir));

  const lock = readLockfile(cell);
  const installed = installedVersion(cell);
  if (!installed) {
    findings.push({ id: "upstream-missing", severity: "error", message: "openclaw is not on PATH", hint: "clawos install" });
  } else if (lock && installed !== lock.upstream.version) {
    findings.push({
      id: "pin-drift",
      severity: "error",
      message: `installed openclaw ${installed} does not match the pin ${lock.upstream.version}`,
      hint: `npm install -g openclaw@${lock.upstream.version} --allow-scripts=openclaw`,
    });
  }

  const dropIn = process.platform === "darwin" ? join(homedir(), "Library", "LaunchAgents", `${cell.unit}.plist`) : join(cell.dropInDir, "clawos.conf");
  if (!existsSync(dropIn)) {
    findings.push({ id: "dropin-missing", severity: "error", message: `${dropIn} is missing`, hint: "clawos install" });
  }

  if (!unitIsActive(cell.unit)) {
    findings.push({
      id: "unit-inactive",
      severity: "error",
      message: `${cell.unit} is not active`,
      hint: "openclaw gateway status",
    });
  }

  try {
    const stats = statfsSync(cell.stateDir);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (freeBytes < 2 * 1024 ** 3) {
      findings.push({
        id: "disk",
        severity: "warn",
        message: `less than 2 GB free on the state directory filesystem (${Math.round(freeBytes / 1024 ** 2)} MB)`,
      });
    }
  } catch {
    // A filesystem that cannot be stat'd is not itself a finding.
  }

  const lint = openclaw(cell, ["doctor", "--lint", "--json"]);
  if (lint.code !== 0) {
    findings.push({
      id: "upstream-lint",
      severity: lint.code >= 2 ? "error" : "warn",
      message: `openclaw doctor --lint exited ${lint.code}`,
      hint: "openclaw doctor --lint",
    });
  }

  const errors = findings.filter((f) => f.severity === "error");
  if (globals.json) {
    console.log(JSON.stringify({ cell: cell.name, ok: errors.length === 0, findings }));
  } else if (findings.length === 0) {
    console.log(`clawos doctor: cell ${cell.name} is healthy`);
  } else {
    for (const finding of findings) {
      console.log(`${finding.severity.toUpperCase().padEnd(5)} ${finding.id}: ${finding.message}`);
      if (finding.hint) console.log(`      hint: ${finding.hint}`);
    }
  }
  return errors.length === 0 ? 0 : 1;
}
