/**
 * Cell identity: the paths, unit name, port, and environment for one OpenClaw OS cell (plan §3.3).
 *
 * A cell is a trust boundary: one upstream state directory, one Gateway, one systemd user unit, one token.
 * The default cell uses `~/.openclaw`; a named cell uses upstream's `OPENCLAW_PROFILE` convention and lives in
 * `~/.openclaw-<name>`, so OS state stays inside upstream's backup scope in both cases.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Cell names map onto a systemd unit name and a state directory, so the character set is deliberately narrow. */
const CELL_NAME = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$|^[a-z]$/;

/** Every filesystem path and identifier derived from a cell name. */
export interface Cell {
  /** Cell name; `default` for the unnamed cell. */
  name: string;
  /** Upstream state directory (`~/.openclaw` or `~/.openclaw-<name>`). */
  stateDir: string;
  /** OS-owned subtree, which upstream never touches. */
  osDir: string;
  /** Upstream's config file. The OS reconciles into it; it does not own the file. */
  configPath: string;
  /** systemd user unit name for this cell's Gateway. */
  unit: string;
  /** Directory holding our drop-in. A drop-in never modifies upstream's unit file (INVARIANT 1). */
  dropInDir: string;
  /** Gateway TCP port. */
  port: number;
  /** Environment upstream CLI invocations for this cell need. */
  env: NodeJS.ProcessEnv;
}

/** The host-level cell registry — the only OS file outside a state directory (plan §9 Phase 1 step 3). */
export const CELLS_REGISTRY = join(homedir(), ".clawos", "cells.json");

/** Default Gateway port for the unnamed cell. */
export const DEFAULT_PORT = 18789;

/** Validate a cell name, rejecting anything that would produce a surprising unit or directory name. */
export function assertCellName(name: string): void {
  if (!CELL_NAME.test(name)) {
    throw new Error(`invalid cell name '${name}': use lowercase letters, digits and hyphens (2–32 chars)`);
  }
}

/** Build the full path/identity set for a cell. */
export function resolveCell(name = "default", port?: number, platform = process.platform): Cell {
  assertCellName(name);
  if (platform === "darwin" && ["gateway", "node"].includes(name)) throw new Error("cell name collides with an upstream LaunchAgent label");
  const isDefault = name === "default";
  const stateDir = isDefault ? join(homedir(), ".openclaw") : join(homedir(), `.openclaw-${name}`);
  const unit = platform === "darwin" ? (isDefault ? "ai.openclaw.gateway" : `ai.openclaw.${name}`)
    : (isDefault ? "openclaw-gateway.service" : `openclaw-gateway-${name}.service`);
  const resolvedPort = port ?? DEFAULT_PORT;
  const env: NodeJS.ProcessEnv = {
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_PATH: join(stateDir, "openclaw.json"),
    OPENCLAW_PROFILE: name,
    OPENCLAW_GATEWAY_PORT: String(resolvedPort),
    OPENCLAW_NO_AUTO_UPDATE: "1",
    CLAWOS_CELL: name,
  };
  if (!isDefault) {
    env.OPENCLAW_PROFILE = name;
    env.OPENCLAW_GATEWAY_PORT = String(resolvedPort);
  }
  return {
    name,
    stateDir,
    osDir: join(stateDir, "os"),
    configPath: join(stateDir, "openclaw.json"),
    unit,
    dropInDir: join(homedir(), ".config", "systemd", "user", `${unit}.d`),
    port: resolvedPort,
    env,
  };
}

/** One row of the host-level cell registry. */
export interface CellRecord {
  name: string;
  port: number;
  stateDir: string;
  unit: string;
  createdAt: string;
}

/** Read the host-level cell registry. Missing or unreadable registry means "no cells recorded yet". */
export function readRegistry(): CellRecord[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(CELLS_REGISTRY, "utf8"));
    return Array.isArray(parsed) ? (parsed as CellRecord[]) : [];
  } catch {
    return [];
  }
}

/**
 * Resolve a cell, taking its port from the registry when one was recorded.
 *
 * A named cell's port is chosen at `clawos cell create` time and must be stable across later invocations, so the
 * registry — not the cell name — is the source of truth for it.
 */
export function resolveCellFromRegistry(name = "default"): Cell {
  const record = readRegistry().find((entry) => entry.name === name);
  return resolveCell(name, record?.port);
}
