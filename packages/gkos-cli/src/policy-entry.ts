/** Standalone primary-policy entrypoint, bundled into a cell-local, mode-600 script. */
import { installPolicy } from "./commands/install-policy.js";
import { parseGlobals } from "./options.js";
try {
  const { globals, rest } = parseGlobals(process.argv.slice(2));
  void installPolicy(rest, globals).then(code => process.exit(code)).catch(() => process.exit(1));
} catch { process.exit(1); }
