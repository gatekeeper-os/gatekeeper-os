/**
 * Subprocess helpers.
 *
 * Two rules hold everywhere in this module, both from the secrecy invariant (`AGENTS.md` §4):
 * argument vectors never carry a secret or a credential-bearing config value (structured input is delivered by
 * file), and captured output is sanitised before it is printed, logged, or put in an artifact.
 */

import { spawnSync } from "node:child_process";

/** Result of a completed subprocess. `stdout`/`stderr` are raw; use {@link sanitize} before showing them. */
export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Patterns that must never survive into operator-visible output, a log line, or a collected artifact. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(gh[pousr]|github_pat)_[A-Za-z0-9_]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b[0-9]{6,}:AA[A-Za-z0-9_-]{30,}/g,
  /((?:api[_-]?key|token|secret|password|authorization|bearer)["'\s:=]+)[^\s"',}]{8,}/gi,
];

/**
 * Redact anything that looks like a credential.
 *
 * This is a backstop, not the primary control: the primary control is never handing a secret to a subprocess
 * argument in the first place. Vendor and upstream error text is unpredictable, so it is filtered on the way out.
 */
export function sanitize(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) => (prefix ? `${prefix}[redacted]` : "[redacted]"));
  }
  return out;
}

/**
 * Run a command and capture its output. Never throws on a non-zero exit; callers decide what a failure means.
 *
 * @param env  extra environment for the child. Secrets belong here, never in `args`.
 */
export function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string): RunResult {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    cwd,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { code: 127, stdout: "", stderr: `${cmd}: command not found` };
  }
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: sanitize(result.stderr ?? "") };
}

/** Run a command and parse its stdout as JSON. Returns `undefined` on a non-zero exit or unparseable output. */
export function runJson<T>(cmd: string, args: string[], env?: NodeJS.ProcessEnv): T | undefined {
  const result = run(cmd, args, env);
  if (result.code !== 0) return undefined;
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return undefined;
  }
}

/** True when a binary is resolvable on `PATH`. */
export function has(cmd: string): boolean {
  return run("sh", ["-c", `command -v ${JSON.stringify(cmd)} >/dev/null 2>&1`]).code === 0;
}

/** A step failure that should end the command with a clear, already-sanitised operator message. */
export class StepError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(sanitize(message));
    this.name = "StepError";
  }
}
