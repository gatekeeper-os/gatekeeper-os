/**
 * Filesystem helpers that enforce the Phase 1 permission criteria: state directories are `700`, config and key
 * material are `600`. Modes are applied on every run, not only at creation, so `clawos doctor` can repair a host
 * whose permissions drifted and a re-install can report the postcondition as already met.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Create a directory (and parents) and force its mode. Returns true when anything actually changed. */
export function ensureDir(path: string, mode = 0o700): boolean {
  let changed = false;
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode });
    changed = true;
  }
  if (modeOf(path) !== mode) {
    chmodSync(path, mode);
    changed = true;
  }
  return changed;
}

/**
 * Write a file atomically with an explicit mode, but only when the content differs.
 *
 * The temporary file is created in the destination directory with the final mode already applied, so the content
 * is never briefly world-readable — which matters for `os/cell.key` and `openclaw.json`.
 *
 * @returns true when the file was created or its content or mode changed.
 */
export function writeFileIfChanged(path: string, content: string, mode = 0o600): boolean {
  const exists = existsSync(path);
  if (exists && readFileSync(path, "utf8") === content) {
    if (modeOf(path) === mode) return false;
    chmodSync(path, mode);
    return true;
  }
  ensureDir(dirname(path), 0o700);
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tmp, content, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
  return true;
}

/** Numeric permission bits of a path, or `undefined` when it does not exist. */
export function modeOf(path: string): number | undefined {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return undefined;
  }
}

/** Read a JSON file, or `undefined` when it is missing or unparseable. */
export function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Write a JSON file with a trailing newline, only when the serialised content changed. */
export function writeJson(path: string, value: unknown, mode = 0o600): boolean {
  return writeFileIfChanged(path, `${JSON.stringify(value, null, 2)}\n`, mode);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
