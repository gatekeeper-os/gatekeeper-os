/** CLI entrypoint for live conformance. No suppressed connectivity failures or skipped-test passes. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs, runConformance } from "./runner.js";

try {
  const options = parseArgs(process.argv.slice(2));
  const lock: unknown = JSON.parse(readFileSync(new URL("../../../gkos.lock.json", import.meta.url), "utf8"));
  const version = (lock as { upstream?: { version?: unknown } }).upstream?.version;
  if (typeof version !== "string" || !version) throw new Error();
  const verdict = runConformance(options, fileURLToPath(new URL("../", import.meta.url)), version);
  console.log(JSON.stringify(verdict));
  process.exitCode = verdict.ok ? 0 : 1;
} catch {
  console.error("CONFORMANCE_RUN_FAILED");
  process.exitCode = 1;
}
