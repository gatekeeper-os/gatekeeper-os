/**
 * `clawos cell create|list` — multi-cell support (plan §9 Phase 1 step 3, §10.5).
 *
 * A named cell is the same install under `OPENCLAW_PROFILE=<name>`, which gives it its own state directory, its
 * own `openclaw-gateway-<name>.service` unit, its own port, key, token and OS state. Cells are a trust boundary
 * (plan §7.1), so `create` refuses to reuse a port or a name that another cell already holds rather than
 * silently colliding two firms onto one Gateway.
 */

import { existsSync } from "node:fs";
import { assertCellName, readRegistry, resolveCell, resolveCellFromRegistry, type CellRecord } from "../util/cell.js";
import { run, StepError } from "../util/proc.js";
import { installedVersion } from "../util/openclaw.js";
import { readLockfile } from "../util/lockfile.js";
import { unitIsActive } from "./status.js";
import { install } from "./install.js";
import { parseCellPolicy } from "../util/policy.js";
import { optionValue } from "../options.js";
import type { GlobalOptions } from "../options.js";

/** True when something is already listening on a TCP port. */
export function portInUse(port: number): boolean {
  const result = run("sh", ["-c", `ss -H -ltn 'sport = :${port}' 2>/dev/null | grep -q .`]);
  return result.code === 0;
}

export async function cell(args: string[], globals: GlobalOptions): Promise<number> {
  const sub = args[0];
  if (sub === "create") return cellCreate(args.slice(1), globals);
  if (sub === "list") return cellList(globals);
  console.error("usage: clawos cell create <name> --port <n> [--policy messaging|runtime] [--yes] | clawos cell list");
  return 2;
}

async function cellCreate(args: string[], globals: GlobalOptions): Promise<number> {
  const name = args.find((a) => !a.startsWith("--"));
  if (!name) throw new StepError("clawos cell create requires a cell name");
  assertCellName(name);
  if (name === "default") throw new StepError("the default cell is created by `clawos install`");

  const policy = parseCellPolicy(optionValue(args, "--policy") ?? "messaging");
  const portArg = optionValue(args, "--port");
  if (!portArg) throw new StepError("clawos cell create requires --port <n>");
  const port = Number(portArg);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new StepError(`invalid port '${portArg}'`);

  const registry = readRegistry();
  const existing = registry.find((entry) => entry.name === name);
  const portOwner = registry.find((entry) => entry.port === port && entry.name !== name);
  if (portOwner) throw new StepError(`port ${port} already belongs to cell '${portOwner.name}'`);

  // An occupied port is only a conflict when this cell does not already own it — otherwise `cell create` could
  // never be re-run against a healthy cell, which would break the idempotence criterion.
  if (!existing && portInUse(port)) throw new StepError(`port ${port} is already in use by another process`);

  const target = resolveCell(name, port);
  if (existing && existsSync(target.osDir)) {
    console.log(`cell ${name} already exists at ${target.stateDir}; re-running install to converge`);
  }

  return install(["--port", String(port), "--policy", policy], { ...globals, cell: name, yes: true });
}

function cellList(globals: GlobalOptions): number {
  const rows = readRegistry().map((record: CellRecord) => {
    const target = resolveCellFromRegistry(record.name);
    return {
      ...record,
      active: unitIsActive(target.unit),
      version: installedVersion(target),
      pin: readLockfile(target)?.upstream.version,
    };
  });
  if (globals.json) {
    console.log(JSON.stringify(rows));
    return 0;
  }
  if (rows.length === 0) {
    console.log("no cells registered");
    return 0;
  }
  console.log("NAME        PORT   UNIT                              ACTIVE  VERSION");
  for (const row of rows) {
    console.log(
      `${row.name.padEnd(11)} ${String(row.port).padEnd(6)} ${row.unit.padEnd(33)} ${
        row.active ? "yes   " : "no    "
      }  ${row.version ?? "-"}`,
    );
  }
  return 0;
}
