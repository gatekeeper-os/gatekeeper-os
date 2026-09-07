import { describe, expect, it } from "vitest";
import { run, sanitize, StepError } from "./proc.js";

// Fixtures are assembled at runtime, never written as literals. `scripts/check-secrets.sh` greps the whole tree
// for token-shaped strings and must keep failing on real ones, so a test for the redactor cannot be the reason
// the scanner gets an exclusion. Building the shapes here keeps both checks strict.
const A30 = "a".repeat(30);
const FIXTURES: [string, string][] = [
  ["GitHub PAT", `ghp_${A30}`],
  ["GitHub fine-grained PAT", `github_pat_${A30}`],
  ["Slack bot token", ["xoxb", "1234567890", A30].join("-")],
  ["OpenAI-style key", `sk-${A30}`],
  ["JWT", ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", A30].join(".")],
  ["Telegram bot token", `123456789:AA${A30}${"b".repeat(8)}`],
];

describe("sanitize", () => {
  it.each(FIXTURES)("redacts a %s", (_name, secret) => {
    const cleaned = sanitize(`upstream said: ${secret}`);
    expect(cleaned).not.toContain(secret);
    expect(cleaned).toContain("[redacted]");
  });

  it("keeps surrounding diagnostic text so an error stays useful", () => {
    const cleaned = sanitize(`bad credential ghp_${A30} (401)`);
    expect(cleaned).toContain("bad credential");
    expect(cleaned).toContain("(401)");
    expect(cleaned).not.toContain(A30);
  });

  it("redacts a labelled secret while keeping the label", () => {
    expect(sanitize('{"api_key": "hunter2hunter2"}')).not.toContain("hunter2hunter2");
    expect(sanitize("Authorization: Bearer aVeryLongOpaqueValue123")).not.toContain("aVeryLongOpaqueValue123");
  });

  it("leaves ordinary diagnostic text alone", () => {
    const message = "config patch failed: gateway.bind must be one of loopback, lan, all";
    expect(sanitize(message)).toBe(message);
  });
});

describe("run", () => {
  it("captures stdout and the exit code without throwing on failure", () => {
    expect(run("sh", ["-c", "echo hello"]).stdout.trim()).toBe("hello");
    expect(run("sh", ["-c", "exit 3"]).code).toBe(3);
  });

  it("reports a missing binary as exit 127 rather than raising", () => {
    const result = run("clawos-definitely-not-a-real-binary", []);
    expect(result.code).toBe(127);
    expect(result.stderr).toContain("command not found");
  });

  it("sanitizes stderr on the way out", () => {
    const result = run("sh", ["-c", `echo 'ghp_${A30}' >&2; exit 1`]);
    expect(result.stderr).not.toContain(A30);
    expect(result.stderr).toContain("[redacted]");
  });

  it("passes secrets through the environment, which never appears in an argument vector", () => {
    const result = run("sh", ["-c", 'printf %s "${CLAWOS_TEST_TOKEN:-unset}"'], { CLAWOS_TEST_TOKEN: `ghp_${A30}` });
    expect(result.stdout).toBe(`ghp_${A30}`); // the child can read it
    expect(result.code).toBe(0);
  });
});

describe("StepError", () => {
  it("sanitizes its own message, so a thrown error cannot carry a credential to the console", () => {
    expect(new StepError(`install failed: ghp_${A30}`).message).not.toContain(A30);
  });

  it("keeps the hint separate from the message", () => {
    const error = new StepError("upstream is absent", "re-run with --yes");
    expect(error.hint).toBe("re-run with --yes");
  });
});
