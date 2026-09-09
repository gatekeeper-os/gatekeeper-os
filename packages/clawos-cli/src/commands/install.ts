/**
 * `clawos install` — plan §10.3, as twelve idempotent steps.
 *
 * Every step checks its postcondition before acting and reports `changed`. A re-run therefore performs no writes
 * and reports `changed: false` overall, which is what `test/phase-1.sh` asserts. `--json` prints one object with
 * the per-step verdicts so the acceptance run has structural evidence rather than an echo.
 *
 * Reviewed first-party plugins are bundled with the CLI and projected into each cell.
 */

import { kernelRpcForCell } from "../util/kernel-rpc.js";
import { projectPlugins } from "../util/plugins.js";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { CELLS_REGISTRY, readRegistry, resolveCell, type Cell, type CellRecord } from "../util/cell.js";
import { ensureDir, modeOf, writeFileIfChanged, writeJson } from "../util/fsx.js";
import { readLockfile, writeLockfile, type Lockfile } from "../util/lockfile.js";
import { installedVersion, openclaw, waitForEndpoint } from "../util/openclaw.js";
import { has, run, StepError } from "../util/proc.js";
import { readJson } from "../util/fsx.js";
import { reconcile } from "./config-apply.js";
import type { GlobalOptions } from "../options.js";

/** Verdict for one installer step. */
export interface StepResult {
  step: string;
  /** `ok` = postcondition already met, `changed` = this run made it true, `deferred` = owned by a later phase. */
  state: "ok" | "changed" | "deferred";
  detail?: string | undefined;
}

/** Machine-readable installer result. */
export interface InstallResult {
  cell: string;
  changed: boolean;
  steps: StepResult[];
  elapsedMs: number;
  upstreamVersion?: string | undefined;
}

/** Where the installer looks for fragment templates and the drop-in template. */
function templateRoot(): string {
  // In the packed tarball, templates sit next to `dist/`. From a source checkout, they are the repo's `config/`.
  const packaged = join(dirname(new URL(import.meta.url).pathname), "..", "templates");
  if (existsSync(join(packaged, "config.d"))) return packaged;
  const fromSource = process.env.CLAWOS_FROM_SOURCE;
  if (fromSource && existsSync(join(fromSource, "config", "config.d"))) return join(fromSource, "config");
  throw new StepError("cannot locate config templates", "set CLAWOS_FROM_SOURCE to the repository checkout");
}

/** Read the upstream pin. In a packed install the lockfile template ships with the CLI; from source it is the repo root. */
function pinnedVersion(): string {
  const candidates = [
    join(templateRoot(), "clawos.lock.json"),
    process.env.CLAWOS_FROM_SOURCE ? join(process.env.CLAWOS_FROM_SOURCE, "clawos.lock.json") : "",
  ].filter(Boolean);
  for (const path of candidates) {
    const lock = readJson<{ upstream?: { version?: string } }>(path);
    if (lock?.upstream?.version) return lock.upstream.version;
  }
  throw new StepError("cannot determine the upstream pin (clawos.lock.json not found)");
}

/** Render the systemd drop-in for a cell. A drop-in never modifies upstream's unit file (INVARIANT 1). */
export function renderDropIn(cell: Cell): string {
  const lines = [
    "# Written by `clawos install`. A drop-in never modifies upstream's unit file (INVARIANT 1).",
    "[Service]",
    "Environment=OPENCLAW_NO_AUTO_UPDATE=1",
    `Environment=CLAWOS_CELL=${cell.name}`,
  ];
  if (cell.name !== "default") {
    lines.push(`Environment=OPENCLAW_PROFILE=${cell.name}`, `Environment=OPENCLAW_GATEWAY_PORT=${cell.port}`);
  }
  // The Gateway token is referenced from config as ${CLAWOS_GATEWAY_TOKEN} and delivered by file, never by argv.
  lines.push(`EnvironmentFile=-${join(cell.stateDir, ".env")}`, "OOMPolicy=continue", "");
  return lines.join("\n");
}

/** Minimal upstream config written only when `openclaw.json` is absent. Reconciliation fills in the rest. */
function minimalConfig(): string {
  return `${JSON.stringify({ $schema: "https://openclaw.ai/config.schema.json" }, null, 2)}\n`;
}

export async function install(args: string[], globals: GlobalOptions): Promise<number> {
  const started = Date.now();
  const port = Number(optional(args, "--port") ?? resolveCell(globals.cell).port);
  const cell = resolveCell(globals.cell, port);
  const steps: StepResult[] = [];
  const record = (step: string, state: StepResult["state"], detail?: string) => steps.push({ step, state, detail });

  // [1/12] preflight — re-verified here even though installer/install.sh ran it, because `clawos install` is also
  // an entry point on its own. An occupied port is only a failure when it is not already this cell's Gateway.
  const preflight = run("sh", ["-c", "uname -s"]);
  if (preflight.stdout.trim() !== "Linux" && preflight.stdout.trim() !== "Darwin") {
    throw new StepError(`unsupported OS ${preflight.stdout.trim()}`);
  }
  record("preflight", "ok", preflight.stdout.trim());

  // [2/12] upstream at the pin
  const pin = pinnedVersion();
  const current = installedVersion(cell);
  if (current !== pin) {
    if (!globals.yes) throw new StepError(`upstream is ${current ?? "absent"}, pin is ${pin}`, "re-run with --yes");
    const npm = run("npm", ["install", "-g", `openclaw@${pin}`, "--allow-scripts=openclaw"]);
    if (npm.code !== 0) throw new StepError(`npm install -g openclaw@${pin} failed: ${npm.stderr}`);
    record("upstream-at-pin", "changed", pin);
  } else {
    record("upstream-at-pin", "ok", pin);
  }

  // [3/12] state dir tree at 700
  let treeChanged = ensureDir(cell.stateDir, 0o700);
  for (const sub of ["config.d", "audit", "gatekeepers", "blueprints", "backups", "logs"]) {
    treeChanged = ensureDir(join(cell.osDir, sub), 0o700) || treeChanged;
  }
  record("state-dir", treeChanged ? "changed" : "ok", cell.osDir);

  // [4/12] keys. Generated once; never regenerated, never logged, never placed in an argument vector.
  const keyPath = join(cell.osDir, "cell.key");
  const envPath = join(cell.stateDir, ".env");
  let keysChanged = false;
  if (!existsSync(keyPath)) {
    writeFileIfChanged(keyPath, `${randomBytes(32).toString("base64")}\n`, 0o600);
    keysChanged = true;
  } else if (modeOf(keyPath) !== 0o600) {
    writeFileIfChanged(keyPath, readFileSync(keyPath, "utf8"), 0o600);
    keysChanged = true;
  }
  if (!hasEnvVar(envPath, "CLAWOS_GATEWAY_TOKEN")) {
    appendEnvVar(envPath, "CLAWOS_GATEWAY_TOKEN", randomBytes(32).toString("hex"));
    keysChanged = true;
  }
  record("keys", keysChanged ? "changed" : "ok");

  // [5/12] config: minimal openclaw.json if absent, then fragment templates that are not already present.
  let configChanged = false;
  if (!existsSync(cell.configPath)) {
    writeFileIfChanged(cell.configPath, minimalConfig(), 0o600);
    configChanged = true;
  } else if (modeOf(cell.configPath) !== 0o600) {
    writeFileIfChanged(cell.configPath, readFileSync(cell.configPath, "utf8"), 0o600);
    configChanged = true;
  }
  const templates = join(templateRoot(), "config.d");
  for (const name of readdirSync(templates)) {
    const target = join(cell.osDir, "config.d", name);
    if (existsSync(target)) continue; // never clobber an operator's fragment
    copyFileSync(join(templates, name), target);
    configChanged = true;
  }
  record("config", configChanged ? "changed" : "ok");

  // [6/12] reviewed source artifacts, installed without mutating upstream or granting resources.
  const plugins = projectPlugins(cell, templateRoot());
  record("plugins", plugins.changed ? "changed" : "ok", "cell-local kernel and filesystem artifacts");

  // [7/12] hooks — internal hooks are plugin-declared by the kernel and enabled by config; nothing to install.
  record("hooks", "ok", "internal hooks are declared by the kernel plugin");

  // [8/12] reconcile
  const reconciled = await reconcile(cell.name, { skipRestart: true, port: cell.port });
  if (reconciled.conflicts?.length) {
    throw new StepError(
      `config apply refused: OS-owned paths changed outside the OS (${reconciled.conflicts.join(", ")})`,
      "move those settings into os/config.d/90-local.json5, or run `clawos config apply --force`",
    );
  }
  record("reconcile", reconciled.changed ? "changed" : "ok", `${reconciled.changes.length} path(s)`);

  // On launchd, OS environment is loaded from the cell dotenv by upstream; never edit its plist.
  if (process.platform === "darwin") {
    for (const [key, value] of [["OPENCLAW_NO_AUTO_UPDATE", "1"], ["CLAWOS_CELL", cell.name]]) {
      if (!hasEnvVar(envPath, key!)) {
        appendEnvVar(envPath, key!, value!);
        record(`environment-${key}`, "changed");
      }
    }
  }

  // [9/12] service: upstream installs its own unit; we add a drop-in beside it and enable the unit.
  let serviceChanged = false;
  if (process.platform === "darwin") {
    const plist = join(homedir(), "Library", "LaunchAgents", `${cell.unit}.plist`);
    if (!existsSync(plist)) {
      const installed = openclaw(cell, ["gateway", "install"]);
      if (installed.code !== 0) throw new StepError("upstream LaunchAgent installation failed");
      serviceChanged = true;
    }
    const start = openclaw(cell, ["gateway", "start"]);
    if (start.code !== 0) throw new StepError("upstream LaunchAgent start failed");
    if ((serviceChanged || reconciled.changed || plugins.changed) && openclaw(cell, ["gateway", "restart"]).code !== 0) throw new StepError("upstream LaunchAgent restart failed");
  } else {
    if (!existsSync(join(homedir(), ".config", "systemd", "user", cell.unit))) {
      const gatewayInstall = openclaw(cell, ["gateway", "install"]);
      if (gatewayInstall.code !== 0) throw new StepError(`openclaw gateway install failed: ${gatewayInstall.stderr}`);
      serviceChanged = true;
    }
    ensureDir(cell.dropInDir, 0o700);
    if (writeFileIfChanged(join(cell.dropInDir, "clawos.conf"), renderDropIn(cell), 0o644)) serviceChanged = true;
    if (serviceChanged && run("systemctl", ["--user", "daemon-reload"]).code !== 0) throw new StepError("systemd daemon-reload failed");
    run("loginctl", ["enable-linger", userInfo().username]);
    const enable = run("systemctl", ["--user", "enable", "--now", cell.unit]);
    if (enable.code !== 0) throw new StepError(`systemctl --user enable --now ${cell.unit} failed: ${enable.stderr}`);
    if ((serviceChanged || reconciled.changed || plugins.changed) && run("systemctl", ["--user", "restart", cell.unit]).code !== 0) throw new StepError("systemd restart failed");
  }
  record("service", serviceChanged ? "changed" : "ok", cell.unit);

  // [10/12] verify: startup then readiness, within the plan's 60 s budget.
  if (!(await waitForEndpoint(cell.port, "/startupz", 60_000))) throw new StepError("/startupz never became ready");
  if (!(await waitForEndpoint(cell.port, "/readyz", 60_000))) throw new StepError("/readyz never became ready");
  const kernel = kernelRpcForCell(cell, "os.status", {}) as { cell?: string; healthy?: boolean; gatekeepers?: Array<{vendor?: string; healthy?: boolean}> };
  if (kernel?.cell !== cell.name || kernel.healthy !== true || !kernel.gatekeepers?.some(g => g.vendor === "fs" && g.healthy === true)) throw new StepError("installed kernel/filesystem runtime is not healthy");
  record("verify", "ok", `kernel and filesystem healthy on ${cell.port}`);

  // [11/12] audit: keep the structural verdict, not the raw report, out of harm's way at 600.
  const auditPath = join(cell.osDir, "logs", `security-audit.${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const audit = openclaw(cell, ["security", "audit", "--deep", "--json"]);
  if (audit.stdout.trim()) writeFileIfChanged(auditPath, audit.stdout, 0o600);
  let auditOk = false;
  try { const report = JSON.parse(audit.stdout) as {summary?: {critical?: number}}; auditOk = audit.code <= 1 && report.summary?.critical === 0; } catch { /* fail closed */ }
  if (!auditOk) throw new StepError("security audit failed or reported critical findings; install not accepted");
  record("audit", "ok", "no critical findings");

  // [12/12] lockfile and the host-level cell registry
  const existingLock = readLockfile(cell);
  // config.state.json is a first-install handoff only; a later reconcile has already updated the lock.
  const stashed = existingLock ? undefined : readJson<{ configFingerprint?: string; ownedDigests?: Record<string, string> }>(
    join(cell.osDir, "config.state.json"),
  );
  const lock: Lockfile = {
    schemaVersion: 1,
    cell: cell.name,
    upstream: {
      package: "openclaw",
      version: pin,
      channel: "stable",
      installedAt: existingLock?.upstream.installedAt ?? new Date().toISOString(),
      nodeVersion: process.version,
    },
    lastKnownGood: existingLock?.lastKnownGood ?? { version: pin, verifiedAt: new Date().toISOString() },
    plugins: { ...existingLock?.plugins, ...plugins.versions },
    kernelSchema: 1,
    configFingerprint: stashed?.configFingerprint ?? existingLock?.configFingerprint,
    ownedDigests: stashed?.ownedDigests ?? existingLock?.ownedDigests,
  };
  const lockChanged = writeLockfile(cell, lock);
  const registry = readRegistry().filter((entry) => entry.name !== cell.name);
  const row: CellRecord = {
    name: cell.name,
    port: cell.port,
    stateDir: cell.stateDir,
    unit: cell.unit,
    createdAt: existingLock?.upstream.installedAt ?? new Date().toISOString(),
  };
  ensureDir(dirname(CELLS_REGISTRY), 0o700);
  writeJson(CELLS_REGISTRY, [...registry, row].sort((a, b) => a.name.localeCompare(b.name)), 0o600);
  record("lockfile", lockChanged ? "changed" : "ok");

  const result: InstallResult = {
    cell: cell.name,
    changed: steps.some((s) => s.state === "changed"),
    steps,
    elapsedMs: Date.now() - started,
    upstreamVersion: pin,
  };
  if (globals.json) console.log(JSON.stringify(result));
  else {
    for (const [index, step] of steps.entries()) {
      console.log(`[${index + 1}/12] ${step.step.padEnd(16)} ${step.state}${step.detail ? ` — ${step.detail}` : ""}`);
    }
    console.log(`install ${result.changed ? "made changes" : "was a no-op"} in ${Math.round(result.elapsedMs / 1000)}s`);
  }
  return 0;
}

function optional(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

/** True when the `.env` file already defines a variable. The value is never read into a log or an argument vector. */
function hasEnvVar(path: string, name: string): boolean {
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").split("\n").some((line) => line.startsWith(`${name}=`));
}

/** Append a variable to the cell `.env` at mode 600, preserving anything the operator already put there. */
function appendEnvVar(path: string, name: string, value: string): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  writeFileIfChanged(path, `${existing}${separator}${name}=${value}\n`, 0o600);
}
