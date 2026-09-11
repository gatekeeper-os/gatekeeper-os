import { readFileSync } from "node:fs";

/** Live GitHub deferred mutation acceptance, including remote state and secrecy. */
export const GITHUB_DEFERRED_REQUIRED_CHECKS = [
  "account-connected", "grant-introduced", "action-pending", "pending-overlay-visible",
  "remote-unchanged-before-approval", "apply-remote-confirmed", "reject-overlay-removed",
  "reject-remote-unchanged", "revert-remote-confirmed", "audit-complete", "secret-scan-clean",
] as const;

/** Native synchronous approval acceptance; deferred queue decisions are not this roundtrip. */
export const GITHUB_APPROVAL_REQUIRED_CHECKS = [
  "await-decision-requested", "unauthorized-decision-denied", "operator-approval-resumes", "resolved-once",
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Consume only this VM's full, real-provider evidence, never mock integration results. */
export function githubScenario(requiredChecks: readonly string[]): { checks: Record<string, true> } {
  const { CLAWOS_KERNEL_VM: vm, CLAWOS_SCENARIO_RUN: runId, CLAWOS_SCENARIO_REPORT: report } = process.env;
  if (vm !== "1" || !runId?.trim() || !report?.trim()) throw new Error("LIVE_GITHUB_SCENARIO_REQUIRED");
  let value: unknown;
  try { value = JSON.parse(readFileSync(report, "utf8")); }
  catch { throw new Error("LIVE_GITHUB_SCENARIO_INVALID"); }
  if (!record(value) || value.runId !== runId || value.provider !== "github.com" ||
      value.mode !== "full" || value.realProvider !== true || "failure" in value ||
      !record(value.checks) || !Object.keys(value.checks).length || !requiredChecks.length ||
      Object.values(value.checks).some(check => check !== true)) {
    throw new Error("LIVE_GITHUB_SCENARIO_INVALID");
  }
  const checks = value.checks;
  if (requiredChecks.some(check => !Object.hasOwn(checks, check) || checks[check] !== true)) {
    throw new Error("LIVE_GITHUB_SCENARIO_INCOMPLETE");
  }
  return { checks: checks as Record<string, true> };
}
