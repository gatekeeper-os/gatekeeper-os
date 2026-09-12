import { closeSync, constants as C, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { DirectoryBinding, denied } from "./paths.js";

/** Private OS state only; never placed below a granted resource. */
export function privateDirectory(path: string): string {
  try {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    DirectoryBinding.capture(path);
    const stat = lstatSync(path);
    if ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw denied();
    return path;
  } catch { throw denied(); }
}
/** Read protected local state without treating corruption as an empty store. */
export function readState(path: string): unknown {
  let fd: number | undefined;
  try {
    fd = openSync(path, C.O_RDONLY | C.O_NOFOLLOW);
    return JSON.parse(readFileSync(fd, "utf8"));
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw denied(); }
  finally { if (fd !== undefined) closeSync(fd); }
}
/** Local single-owner journal/cache publication; this does not write a granted resource. */
export function writeState(path: string, value: unknown): void {
  const dir = privateDirectory(dirname(path)), temp = join(dir, `.state-${randomBytes(16).toString("hex")}`);
  let fd: number | undefined;
  try {
    fd = openSync(temp, C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW, 0o600);
    writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temp, path);
    fd = openSync(dir, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW); fsyncSync(fd);
  } catch { throw denied(); }
  finally {
    if (fd !== undefined) closeSync(fd);
    // Cleanup failure must remain fatal even after publication; never report clean persistence.
    // eslint-disable-next-line no-unsafe-finally
    try { unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw denied(); }
  }
}
