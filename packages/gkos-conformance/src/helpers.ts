import { execFileSync } from "node:child_process";

/** Run a fixed CLI argument list; reject failed or non-JSON output without leaking payloads. */
export function runCliJson(args: string[]): unknown {
  if (!process.env.OPENCLAW_STATE_DIR || !process.env.OPENCLAW_CONFIG_PATH) throw new Error("CONFORMANCE_EXPLICIT_STATE_REQUIRED");
  try {
    const output = execFileSync("openclaw", args, {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    return JSON.parse(output.trim());
  } catch { throw new Error("CONFORMANCE_CLI_FAILED"); }
}

/** Live selection is explicit at the runner boundary; retained for named test declarations. */
export function shouldRun(testId: string): boolean {
  const only = process.env.GKOS_CONFORMANCE_ONLY?.split(",");
  return !only || only.includes(testId);
}
