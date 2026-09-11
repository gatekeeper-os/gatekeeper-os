import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GITHUB_APPROVAL_REQUIRED_CHECKS, GITHUB_DEFERRED_REQUIRED_CHECKS, githubScenario } from "../github-scenario.js";

const required = [...GITHUB_DEFERRED_REQUIRED_CHECKS, ...GITHUB_APPROVAL_REQUIRED_CHECKS];
let directory: string;
let report: string;
function evidence() {
  return { runId: "current-vm-run", provider: "github.com", mode: "full", realProvider: true,
    checks: Object.fromEntries(required.map(check => [check, true])) };
}
function save(value: unknown) { writeFileSync(report, JSON.stringify(value)); }

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "github-evidence-"));
  report = join(directory, "scenario.json");
  vi.stubEnv("CLAWOS_KERNEL_VM", "1");
  vi.stubEnv("CLAWOS_SCENARIO_RUN", "current-vm-run");
  vi.stubEnv("CLAWOS_SCENARIO_REPORT", report);
  save(evidence());
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

describe("live GitHub evidence contract (offline parser regressions, not acceptance)", () => {
  it("accepts complete current full-provider evidence for each suite", () => {
    expect(githubScenario(GITHUB_DEFERRED_REQUIRED_CHECKS).checks).toEqual(evidence().checks);
    expect(githubScenario(GITHUB_APPROVAL_REQUIRED_CHECKS).checks).toEqual(evidence().checks);
  });
  it.each([
    ["CLAWOS_KERNEL_VM", ""], ["CLAWOS_KERNEL_VM", "true"],
    ["CLAWOS_SCENARIO_RUN", ""], ["CLAWOS_SCENARIO_RUN", " "], ["CLAWOS_SCENARIO_REPORT", ""],
  ])("requires VM invocation context: %s=%s", (key, value) => {
    vi.stubEnv(key, value);
    expect(() => githubScenario(required)).toThrow("LIVE_GITHUB_SCENARIO_REQUIRED");
  });
  it.each([
    { runId: "stale-vm-run" }, { provider: "fixture" }, { provider: "api.github.com.evil.example" },
    { mode: "integration" }, { mode: "gateway-integration" }, { mode: "smoke" }, { realProvider: false }, { realProvider: "true" },
    { failure: "provider failed" }, { failure: null }, { failure: false },
  ])("rejects stale, forged or failed metadata %#", patch => {
    save({ ...evidence(), ...patch });
    expect(() => githubScenario(required)).toThrow("LIVE_GITHUB_SCENARIO_INVALID");
  });
  it("rejects successful real-Gateway/mock-GitHub fixture results for both production suites", () => {
    save({ ...evidence(), mode: "gateway-integration", realProvider: false });
    expect(() => githubScenario(GITHUB_DEFERRED_REQUIRED_CHECKS)).toThrow("LIVE_GITHUB_SCENARIO_INVALID");
    expect(() => githubScenario(GITHUB_APPROVAL_REQUIRED_CHECKS)).toThrow("LIVE_GITHUB_SCENARIO_INVALID");
  });
  it.each(["runId", "provider", "mode", "realProvider", "checks"])("rejects missing %s", key => {
    const value: Record<string, unknown> = evidence(); delete value[key]; save(value);
    expect(() => githubScenario(required)).toThrow("LIVE_GITHUB_SCENARIO_INVALID");
  });
  it.each([null, [], {}, "checks", true])("rejects malformed report %#", value => {
    save(value); expect(() => githubScenario(required)).toThrow("LIVE_GITHUB_SCENARIO_INVALID");
  });
  it.each([null, [], {}, "true", true])("rejects absent or malformed check maps %#", checks => {
    save({ ...evidence(), checks });
    expect(() => githubScenario(required)).toThrow("LIVE_GITHUB_SCENARIO_INVALID");
  });
  it.each(required)("rejects missing required check %s", check => {
    const value = evidence(); delete value.checks[check]; save(value);
    expect(() => githubScenario(required)).toThrow("LIVE_GITHUB_SCENARIO_INCOMPLETE");
  });
  it.each([false, 1, "true", null])("requires literal true, not %#", value => {
    save({ ...evidence(), checks: { ...evidence().checks, "apply-remote-confirmed": value } });
    expect(() => githubScenario(required)).toThrow("LIVE_GITHUB_SCENARIO_INVALID");
  });
  it("does not discard failures outside the selected suite", () => {
    save({ ...evidence(), checks: { ...evidence().checks, "extra-cleanup": false } });
    expect(() => githubScenario(required)).toThrow("LIVE_GITHUB_SCENARIO_INVALID");
  });
  it("does not accept deferred approval as an awaitDecision roundtrip", () => {
    const value = evidence(); delete value.checks["await-decision-requested"]; save(value);
    expect(() => githubScenario(GITHUB_APPROVAL_REQUIRED_CHECKS)).toThrow("LIVE_GITHUB_SCENARIO_INCOMPLETE");
    expect(() => githubScenario(GITHUB_DEFERRED_REQUIRED_CHECKS)).not.toThrow();
  });
  it("refuses an empty suite requirement", () => {
    expect(() => githubScenario([])).toThrow("LIVE_GITHUB_SCENARIO_INVALID");
  });
  it("does not count inherited properties as check evidence", () => {
    expect(() => githubScenario(["toString"])).toThrow("LIVE_GITHUB_SCENARIO_INCOMPLETE");
  });
  it("sanitizes malformed JSON and unavailable report errors", () => {
    writeFileSync(report, '{"private-payload":');
    expect(() => githubScenario(required)).toThrow(/^LIVE_GITHUB_SCENARIO_INVALID$/);
    vi.stubEnv("CLAWOS_SCENARIO_REPORT", join(directory, "private-path"));
    expect(() => githubScenario(required)).toThrow(/^LIVE_GITHUB_SCENARIO_INVALID$/);
  });
});
