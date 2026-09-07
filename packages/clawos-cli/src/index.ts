/**
 * `clawos` CLI entry point.
 *
 * Phase 1 mounts the host layer only: install, cell, status, doctor, config apply, backup. Grants, approvals,
 * gatekeepers, blueprints, update and rollback belong to later phases and are absent rather than stubbed, so an
 * operator cannot invoke a command that silently does nothing.
 */

import { backup } from "./commands/backup.js";
import { cell } from "./commands/cell.js";
import { configApply } from "./commands/config-apply.js";
import { doctor } from "./commands/doctor.js";
import { install } from "./commands/install.js";
import { status } from "./commands/status.js";
import { parseGlobals, type GlobalOptions } from "./options.js";
import { StepError } from "./util/proc.js";

type Command = (args: string[], globals: GlobalOptions) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  install,
  status,
  doctor,
  cell,
  backup,
  config: async (args, globals) => {
    if (args[0] === "apply") return configApply(args.slice(1), globals);
    console.error("usage: clawos config apply [--dry-run] [--force]");
    return 2;
  },
};

function usage(): number {
  console.error(
    [
      "usage: clawos <command> [--cell <name>] [--json] [--yes]",
      "",
      "  install                    install or converge this cell (idempotent)",
      "  status                     report cell health",
      "  doctor                     host-layer diagnostics with fix hints",
      "  cell create <name> --port  create an additional cell",
      "  cell list                  list registered cells",
      "  config apply               reconcile os/config.d/*.json5 into openclaw.json",
      "  backup create|restore      archive and roll back a cell",
      "",
      "later phases: grant, approvals, gatekeeper, audit (3-5), blueprint (6), update, rollback (7)",
    ].join("\n"),
  );
  return 2;
}

export async function main(argv: string[]): Promise<void> {
  let code: number;
  try {
    const { globals, rest } = parseGlobals(argv);
    const [name, ...args] = rest;
    const command = name ? COMMANDS[name] : undefined;
    code = command ? await command(args, globals) : usage();
  } catch (error) {
    if (error instanceof StepError) {
      console.error(`clawos: ${error.message}`);
      if (error.hint) console.error(`  hint: ${error.hint}`);
    } else {
      console.error(`clawos: ${error instanceof Error ? error.message : String(error)}`);
    }
    code = 1;
  }
  process.exit(code);
}
