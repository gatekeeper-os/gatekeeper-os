/** Read evidence only from this VM invocation; absent, stale or failed scenario runs cannot pass. */
import { readFileSync } from "node:fs";
export function liveScenario(): { checks: Record<string, boolean> } {
  if (process.env.CLAWOS_KERNEL_VM !== "1" || !process.env.CLAWOS_SCENARIO_RUN || !process.env.CLAWOS_SCENARIO_REPORT) throw new Error("LIVE_SCENARIO_REQUIRED");
  const value: unknown = JSON.parse(readFileSync(process.env.CLAWOS_SCENARIO_REPORT, "utf8"));
  if (!value || typeof value !== "object" || !("runId" in value) || value.runId !== process.env.CLAWOS_SCENARIO_RUN || "failure" in value || !("checks" in value) || !value.checks || typeof value.checks !== "object" || Object.values(value.checks).some(v => v !== true)) throw new Error("LIVE_SCENARIO_INVALID");
  return { checks: value.checks as Record<string, boolean> };
}
