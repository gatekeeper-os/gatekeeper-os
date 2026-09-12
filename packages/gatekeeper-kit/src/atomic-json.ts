import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/** Publish a private JSON document atomically. Callers own serialization and single-writer scope. */
export function writeJsonAtomic(path: string, value: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.clawos-${randomBytes(16).toString("hex")}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(value), "utf8");
    fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temp, path);
    const directory = openSync(dir, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    // Cleanup failure must remain fatal even after publication; never report clean persistence.
    // eslint-disable-next-line no-unsafe-finally
    try { unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

/** Read private JSON; only an absent file means no prior state. Corruption fails closed. */
export function readJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("Invalid persisted state."); }
}
