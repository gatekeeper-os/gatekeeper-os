// clawos CLI entry. TODO(phase-1): commander-style dispatch; each command in src/commands/<name>.ts.
import { install } from "./commands/install.js";
import { status } from "./commands/status.js";
import { configApply } from "./commands/config-apply.js";

const commands: Record<string, (args: string[]) => Promise<number>> = {
  install, status, "config": async (a) => (a[0] === "apply" ? configApply(a.slice(1)) : usage()),
  // TODO(phase-1): cell, doctor, backup, operator, adopt, uninstall, dev
  // TODO(phase-3): grant, approvals, gatekeeper, audit (forwarded to os.* over WebSocket)
  // TODO(phase-6): blueprint
  // TODO(phase-7): update, rollback
};
async function usage() { console.error("usage: clawos <command> [--cell <name>] [--json] …"); return 2; }
export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const fn = cmd ? commands[cmd] : undefined;
  process.exit(fn ? await fn(rest) : await usage());
}
