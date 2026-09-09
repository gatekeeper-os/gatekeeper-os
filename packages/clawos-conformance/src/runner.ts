/** Fail-closed selection and structural verdict validation for live acceptance. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

/** Explicit test inventory: a misspelled or empty selection is an error, not an empty pass. */
export const testIds = [
  "plugin-loads", "hooks-fire", "tool-narrowing", "gate-blocks", "rpc-methods", "cli-mounted",
  "health", "fs-gatekeeper", "install-gate", "install-hook", "config-reconcile", "deferred-approval", "require-approval-roundtrip",
] as const;

/** Requested acceptance suites and destination for their structural verdict. */
export interface RunOptions { selected: string[]; verdictPath: string }

/** Parse supported flags without confusing absent --verdict with the first argument. */
export function parseArgs(args: string[]): RunOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!flag || !["--only", "--verdict"].includes(flag) || values.has(flag) || !value || value.startsWith("--")) {
      throw new Error("CONFORMANCE_INVALID_ARGUMENTS");
    }
    values.set(flag, value);
  }
  const selected = values.has("--only") ? values.get("--only")!.split(",").map(id => id.trim()) : [...testIds];
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !testIds.some(known => known === id))) {
    throw new Error("CONFORMANCE_INVALID_SELECTION");
  }
  return { selected, verdictPath: values.get("--verdict") ?? "conformance-verdict.json" };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Sanitized evidence: no assertion titles, failure messages, params or server payloads. */
export interface Verdict {
  ok: boolean;
  reasons: string[];
  tests: Array<{ id: string; passed: number; failed: number; skipped: number }>;
}

/** Require every selected suite and assertion to pass; process exit zero alone is insufficient. */
export function evaluateReport(selected: string[], report: unknown, status: number | null, signal: string | null): Verdict {
  const reasons = new Set<string>();
  const result = record(report);
  if (status !== 0 || signal !== null) reasons.add("PROCESS_FAILED");
  if (!result || result.success !== true || !Array.isArray(result.testResults)) reasons.add("INVALID_REPORT");
  const suites = Array.isArray(result?.testResults) ? result.testResults : [];
  const tests = selected.map(id => ({ id, passed: 0, failed: 0, skipped: 0 }));
  const seen = new Set<string>();
  for (const raw of suites) {
    const suite = record(raw);
    const id = typeof suite?.name === "string" ? basename(suite.name).replace(/\.test\.ts$/, "") : "";
    const target = tests.find(test => test.id === id);
    if (!target || seen.has(id)) { reasons.add("UNEXPECTED_SUITE"); continue; }
    seen.add(id);
    if (suite?.status !== "passed") reasons.add("SUITE_NOT_PASSED");
    if (!Array.isArray(suite?.assertionResults) || !suite.assertionResults.length) { reasons.add("EMPTY_SUITE"); continue; }
    for (const rawAssertion of suite.assertionResults) {
      const status = record(rawAssertion)?.status;
      if (status === "passed") target.passed++;
      else if (status === "failed") target.failed++;
      else target.skipped++;
    }
    if (target.failed) reasons.add("ASSERTION_FAILED");
    if (target.skipped) reasons.add("ASSERTION_NOT_RUN");
  }
  if (selected.some(id => !seen.has(id))) reasons.add("MISSING_SUITE");
  const passed = tests.reduce((n, test) => n + test.passed, 0);
  if (!passed) reasons.add("NO_PASSED_ASSERTIONS");
  if (result?.numTotalTests !== passed || result?.numPassedTests !== passed || result?.numFailedTests !== 0 || result?.numPendingTests !== 0 || (result?.numTodoTests ?? 0) !== 0) reasons.add("INCOMPLETE_COUNTS");
  return { ok: reasons.size === 0, reasons: [...reasons], tests };
}

/** Run only the dedicated live workspace, retaining a sanitized, fail-closed verdict. */
export function runConformance(options: RunOptions, packageRoot: string, upstreamVersion: string): Verdict {
  const temporary = mkdtempSync(join(tmpdir(), "clawos-conformance-"));
  try {
    const reportPath = join(temporary, "report.json");
    const processResult = spawnSync("pnpm", ["exec", "vitest", "run", "--workspace", "conformance.workspace.ts", "--reporter=json", `--outputFile=${reportPath}`], {
      cwd: packageRoot,
      env: { ...process.env, CLAWOS_CONFORMANCE_ONLY: options.selected.join(",") },
      encoding: "utf8", timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024,
    });
    let report: unknown;
    try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch { report = undefined; }
    const verdict = evaluateReport(options.selected, report, processResult.status, processResult.signal);
    if (processResult.error) { verdict.ok = false; verdict.reasons.push("RUNNER_ERROR"); }
    writeFileSync(options.verdictPath, JSON.stringify({ ...verdict, upstreamVersion, scope: "live-conformance", process: { code: processResult.status, signal: processResult.signal } }, null, 2) + "\n", { mode: 0o600 });
    return verdict;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
