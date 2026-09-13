/** Upstream-mounted commands use the installed gkos operator client, never an unstarted local kernel store. */
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Resolve the selected CLI profile and refuse explicit state/config that would silently select another cell. */
export function operatorCell(env: NodeJS.ProcessEnv, home = homedir()): string {
  const cell = env.GKOS_CELL ?? env.OPENCLAW_PROFILE ?? "default";
  if (!/^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(cell)) throw new Error("Invalid operator cell.");
  if (env.GKOS_CELL && env.OPENCLAW_PROFILE && env.GKOS_CELL !== env.OPENCLAW_PROFILE) throw new Error("Conflicting operator cell selectors.");
  const state = join(home, cell === "default" ? ".openclaw" : `.openclaw-${cell}`);
  if ((env.OPENCLAW_STATE_DIR && resolve(env.OPENCLAW_STATE_DIR) !== state) ||
      (env.OPENCLAW_CONFIG_PATH && resolve(env.OPENCLAW_CONFIG_PATH) !== join(state, "openclaw.json"))) {
    throw new Error("Operator CLI requires a registered canonical cell; explicit state/config does not match.");
  }
  return cell;
}

/** Forward only fixed command names and validated option values to the cell-scoped client. */
export function runOperatorCli(cell: string, args: string[]): void {
  const result = spawnSync('gkos', [...args, '--cell', cell, '--json'], {
    env: process.env, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw new Error('Kernel CLI unavailable or unauthorized; verify gkos installation and cell pairing.');
  try { process.stdout.write(`${JSON.stringify(JSON.parse(result.stdout))}\n`); }
  catch { throw new Error('Kernel CLI returned an invalid response.'); }
}

/** Declare the root CLI without instantiating a kernel runtime in discovery/metadata processes. */
export function mountOperatorCli(program: any): void {
  const cell = operatorCell(process.env);
  const os = program.command("os").description("GatekeeperOS kernel administration");
  os.command("status").option("--json").action(() => runOperatorCli(cell, ["kernel", "status"]));
  os.command("grants").option("--json").action(() => runOperatorCli(cell, ["grant", "list"]));
  os.command("approvals").option("--json").action(() => runOperatorCli(cell, ["approvals", "list"]));
  os.command("audit").option("--json").option("--limit <n>").action((o: {limit?: string}) => runOperatorCli(cell, ["audit", "tail", "--limit", o.limit ?? "100"]));
}
