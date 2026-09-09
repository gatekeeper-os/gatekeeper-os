import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { evaluateReport, parseArgs, runConformance } from "../runner.js";

function report(status = "passed") {
  return {
    success: true, numTotalTests: 1, numPassedTests: status === "passed" ? 1 : 0,
    numFailedTests: status === "failed" ? 1 : 0, numPendingTests: status === "pending" ? 1 : 0,
    testResults: [{ name: "/test/hooks-fire.test.ts", status: "passed", assertionResults: [{ status }] }],
  };
}

describe("selection", () => {
  it("defaults the verdict independently of --only", () => {
    expect(parseArgs(["--only", "hooks-fire"])).toEqual({ selected: ["hooks-fire"], verdictPath: "conformance-verdict.json" });
    expect(parseArgs(["--verdict", "result.json", "--only", "health,hooks-fire"]).selected).toEqual(["health", "hooks-fire"]);
  });
  it.each([
    ["--only"], ["--only", ""], ["--only", "health,"], ["--only", "typo"],
    ["--only", "health,health"], ["--wat", "health"], ["--verdict"],
    ["--only", "health", "--only", "health"], ["--only", "../health"],
  ])("rejects malformed arguments %#", (...args) => { expect(() => parseArgs(args)).toThrow(); });
});

describe("verdict integrity", () => {
  it("requires real passing assertions", () => { expect(evaluateReport(["hooks-fire"], report(), 0, null).ok).toBe(true); });
  it.each(["pending", "todo", "skipped", "failed", "unknown"])("refuses assertion status %s despite exit zero", status => {
    expect(evaluateReport(["hooks-fire"], report(status), 0, null).ok).toBe(false);
  });
  it("refuses missing and empty suites", () => {
    expect(evaluateReport(["hooks-fire", "health"], report(), 0, null).reasons).toContain("MISSING_SUITE");
    const empty = report(); empty.testResults[0]!.assertionResults = [];
    expect(evaluateReport(["hooks-fire"], empty, 0, null).reasons).toContain("EMPTY_SUITE");
  });
  it("refuses absent reports, false success, counter mismatch and abnormal process exits", () => {
    expect(evaluateReport(["hooks-fire"], undefined, 0, null).ok).toBe(false);
    expect(evaluateReport(["hooks-fire"], { ...report(), success: false }, 0, null).ok).toBe(false);
    expect(evaluateReport(["hooks-fire"], { ...report(), numTotalTests: 2 }, 0, null).ok).toBe(false);
    expect(evaluateReport(["hooks-fire"], report(), 1, null).ok).toBe(false);
    expect(evaluateReport(["hooks-fire"], report(), null, "SIGTERM").ok).toBe(false);
  });
  it("rejects duplicated or unrelated suites", () => {
    const duplicate = report(); duplicate.testResults.push(duplicate.testResults[0]!);
    expect(evaluateReport(["hooks-fire"], duplicate, 0, null).reasons).toContain("UNEXPECTED_SUITE");
    expect(evaluateReport(["health"], report(), 0, null).ok).toBe(false);
  });
  it("never copies failure payloads into verdicts", () => {
    const value = report("failed");
    Object.assign(value.testResults[0]!, { message: "private fixture payload", failureMessages: ["private fixture payload"] });
    expect(JSON.stringify(evaluateReport(["hooks-fire"], value, 1, null))).not.toContain("private fixture payload");
  });
});

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("real Vitest process regressions (offline fixtures)", () => {
  it.each([
    ["it('passes', () => expect(1).toBe(1));", true],
    ["it.skip('not implemented', () => {});", false],
    ["it('fails', () => { throw new Error('private fixture payload'); });", false],
    ["// no tests", false],
  ] as const)("evaluates fixture %# without relying on exit status alone", (body, ok) => {
    const directory = mkdtempSync(fileURLToPath(new URL(".runner-fixture-", import.meta.url)));
    temporary.push(directory);
    writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "conformance-fixture", private: true, type: "module" }));
    mkdirSync(join(directory, "src/tests"), { recursive: true });
    writeFileSync(join(directory, "src/tests/hooks-fire.test.ts"), `import { it, expect } from 'vitest';\n${body}`);
    writeFileSync(join(directory, "conformance.workspace.ts"), `export default [{test:{name:'fixture',root:${JSON.stringify(directory)},include:['src/tests/*.test.ts']}}];`);
    const verdictPath = join(directory, "verdict.json");
    const result = runConformance({ selected: ["hooks-fire"], verdictPath }, directory, "fixture");
    expect(result, JSON.stringify(result)).toMatchObject({ ok });
    const evidence = readFileSync(verdictPath, "utf8");
    expect(JSON.parse(evidence).ok).toBe(ok);
    expect(evidence).not.toContain("private fixture payload");
    if (body.includes("it.skip")) {
      expect(JSON.parse(evidence).process.code).toBe(0);
      expect(result.reasons).toContain("ASSERTION_NOT_RUN");
    }
  }, 60_000);
});
