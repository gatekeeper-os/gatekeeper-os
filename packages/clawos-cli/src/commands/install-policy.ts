/** Upstream's primary install boundary. Bounded stdin, static cell binding, no Gateway/plugin recursion. */
import { readFileSync } from "node:fs";
import { evaluateInstall, type InstallMaterial, type InstallRules } from "@clawos/shared";
import { resolveCell } from "../util/cell.js";
import { parseFragment } from "../util/json5.js";
import type { GlobalOptions } from "../options.js";

/** Read the selected cell's current authored policy, without importing or starting upstream. */
export async function installPolicy(args: string[], globals: GlobalOptions): Promise<number> {
  let verdict = { protocolVersion: 1, decision: "block", reason: "Cell install policy is unavailable or invalid." };
  try {
    if (args.length) throw new Error();
    const cell = resolveCell(globals.cell);
    for (const [key, expected] of [["OPENCLAW_STATE_DIR", cell.stateDir], ["OPENCLAW_CONFIG_PATH", cell.configPath], ["CLAWOS_CELL", cell.name]] as const) {
      if (process.env[key] && process.env[key] !== expected) throw new Error();
    }
    let input = "";
    for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 1024 * 1024) throw new Error(); }
    const material = JSON.parse(input) as InstallMaterial & { protocolVersion: number };
    if (material.protocolVersion !== 1) throw new Error();
    const config = parseFragment(readFileSync(cell.configPath, "utf8"), "cell config") as { plugins?: { entries?: Record<string, { config?: { install?: InstallRules } }> } };
    const result = evaluateInstall(config.plugins?.entries?.["clawos-kernel"]?.config?.install, material);
    verdict = { ...result, reason: result.reason ?? "Cell install policy allows this material." };
  } catch { /* fixed denial only; never echo input, config or upstream diagnostics */ }
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  return 0;
}
