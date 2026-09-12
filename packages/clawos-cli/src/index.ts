/**
 * `clawos` CLI entry point.
 *
 * Host layer: install, cell, status, doctor, config apply, backup. Kernel administration uses paired operator RPC. Blueprints provision versioned agent workspaces. Update and rollback remain separate-phase work.
 */

import { readFileSync } from "node:fs";
import { blueprint } from "./commands/blueprint.js";
import { update, rollback } from "./commands/update.js";
import { kernelCommand } from "./commands/kernel.js";
import { backup } from "./commands/backup.js";
import { cell } from "./commands/cell.js";
import { configApply } from "./commands/config-apply.js";
import { doctor } from "./commands/doctor.js";
import { installPolicy } from "./commands/install-policy.js";
import { install } from "./commands/install.js";
import { status } from "./commands/status.js";
import { parseGlobals, type GlobalOptions } from "./options.js";
import { StepError } from "./util/proc.js";

type Command = (args: string[], globals: GlobalOptions) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  ...Object.fromEntries(["grant", "audit", "approvals", "gatekeeper", "kernel"].map(name => [name, (args: string[], globals: GlobalOptions) => kernelCommand(name, args, globals)])),
  blueprint,
  install,
  update,
  rollback,
  "install-policy": installPolicy,
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
      "  install [--environment-file <absolute-path>]",
      "                             install or converge this cell (idempotent)",
      "  blueprint list|lint|apply|diff  versioned agent workspaces (apply requires --agent and --yes)",
      "  update --check|--to      guarded update with live conformance",
      "  rollback --yes          recover a journaled update",
      "  status                     report cell health",
      "  doctor                     host-layer diagnostics with fix hints",
      "  cell create <name> --port  create an additional cell",
      "  cell list                  list registered cells",
      "  config apply               reconcile os/config.d/*.json5 into openclaw.json",
      "  backup create|restore      archive and roll back a cell",
      "",
      "grant add|list|revoke; audit tail; approvals list|apply|reject|revert; gatekeeper list; kernel status",
    ].join("\n"),
  );
  return 2;
}

export async function main(argv: string[]): Promise<void> {
  if (argv.length === 1 && argv[0] === "--version") { console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version); return; }
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
