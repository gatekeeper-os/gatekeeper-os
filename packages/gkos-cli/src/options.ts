/** Options every `gkos` command accepts, parsed once before dispatch. */
export interface GlobalOptions {
  /** Cell to operate on; `default` unless `--cell <name>` was given. */
  cell: string;
  /** Emit one machine-readable JSON object on stdout instead of prose. */
  json: boolean;
  /** Proceed without interactive confirmation. Required for every non-interactive install path. */
  yes: boolean;
}

/** Split global options out of an argument list, returning the options and the remaining command arguments. */
export function parseGlobals(argv: string[]): { globals: GlobalOptions; rest: string[] } {
  const globals: GlobalOptions = { cell: "default", json: false, yes: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--cell") {
      const value = argv[++i];
      if (!value) throw new Error("--cell requires a name");
      globals.cell = value;
    } else if (arg.startsWith("--cell=")) {
      globals.cell = arg.slice("--cell=".length);
    } else if (arg === "--json") {
      globals.json = true;
    } else if (arg === "--yes" || arg === "-y") {
      globals.yes = true;
    } else {
      rest.push(arg);
    }
  }
  return { globals, rest };
}

/** Read `--flag <value>` or `--flag=value` from an argument list. */
export function optionValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1) return args[index + 1];
  const inline = args.find((a) => a.startsWith(`${flag}=`));
  return inline?.slice(flag.length + 1);
}
