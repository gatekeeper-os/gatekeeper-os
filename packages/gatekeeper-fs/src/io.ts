import { constants as C, closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync, readlinkSync, type BigIntStats } from "node:fs";
import { TextDecoder } from "node:util";
import { createHash } from "node:crypto";
import { DirectoryBinding, denied } from "./paths.js";

/** Encoded byte bound, applied to both host files and simulated text. */
export const MAX_BYTES = 1048576;
/** Literal relative POSIX paths; URLs are never decoded in tool calls. */
export function relativePath(value: unknown): string {
  if (typeof value !== "string" || !value || value.startsWith("/") || /[\\\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.byteLength(value) > 4096 || Buffer.from(value).toString("utf8") !== value ||
    value.split("/").some(part => !part || part === "." || part === "..")) throw denied();
  return value;
}
/** UTF-8 text only, without NUL or silently replaced Unicode. */
export function textBytes(value: unknown): Buffer {
  if (typeof value !== "string") throw denied();
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > MAX_BYTES || bytes.includes(0) || bytes.toString("utf8") !== value) throw denied();
  return bytes;
}
/** Snapshot used to recognize changes, never an authorization token. */
export interface FileSnapshot { content: string; stamp: string; }
/** Bounded immediate directory result. */
export interface DirectoryEntry { name: string; kind: "file" | "directory" | "unavailable"; }
const stamp = (s: BigIntStats) => [s.dev, s.ino, s.nlink, s.size, s.mtimeNs, s.ctimeNs].join(":");
const regular = (s: BigIntStats) => s.isFile() && s.nlink === 1n && s.size <= BigInt(MAX_BYTES);
const dirFlags = C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW;
const fdPath = (fd: number) => `/proc/self/fd/${fd}`;

/**
 * Linux descriptor walk. Each component is opened relative to a pinned parent with
 * O_NOFOLLOW; no attacker-selected symlink is ever followed. /proc/self/fd is used
 * only for our own live descriptors (Node has no openat API). Unsupported hosts deny.
 * A moved/replaced directory is detected before returning data or publishing a file.
 * Existing-file replacement is deliberately unavailable: Node has no atomic CAS rename.
 */
export class ConfinedIO {
  constructor(private readonly binding: DirectoryBinding) {}
  private withDirectory<T>(subpath: string | undefined, fn: (fd: number) => T): T {
    const descriptors: number[] = [];
    try {
      if (process.platform !== "linux" || !C.O_NOFOLLOW || !C.O_DIRECTORY) throw denied();
      this.binding.assertCurrent();
      let fd = openSync("/", dirFlags); descriptors.push(fd);
      for (const part of this.binding.path.split("/").filter(Boolean)) {
        fd = openSync(`${fdPath(fd)}/${part}`, dirFlags); descriptors.push(fd);
      }
      this.binding.assertDescriptor(fstatSync(fd, { bigint: true }));
      let expected = this.binding.path;
      if (subpath !== undefined) for (const part of relativePath(subpath).split("/")) {
        fd = openSync(`${fdPath(fd)}/${part}`, dirFlags); descriptors.push(fd);
        expected = expected === "/" ? `/${part}` : `${expected}/${part}`;
      }
      // Descriptor identity/path checks supplement the no-follow walk, not replace it.
      if (readlinkSync(fdPath(fd)) !== expected) throw denied();
      const value = fn(fd);
      this.binding.assertCurrent();
      if (readlinkSync(fdPath(fd)) !== expected) throw denied();
      return value;
    } catch { throw denied(); }
    finally { for (const fd of descriptors.reverse()) closeSync(fd); }
  }
  private withParent<T>(path: string, fn: (fd: number, name: string) => T): T {
    const parts = relativePath(path).split("/"), name = parts.pop()!;
    return this.withDirectory(parts.length ? parts.join("/") : undefined, fd => fn(fd, name));
  }
  /** Bounded read from a no-follow, single-link regular-file descriptor. Missing alone returns null. */
  read(path: string): FileSnapshot | null {
    return this.withParent(path, (parent, name) => {
      let fd: number;
      try { fd = openSync(`${fdPath(parent)}/${name}`, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw denied(); }
      try {
        const before = fstatSync(fd, { bigint: true });
        if (!regular(before)) throw denied();
        const bytes = Buffer.alloc(MAX_BYTES + 1);
        let total = 0;
        while (total < bytes.length) {
          const n = readSync(fd, bytes, total, bytes.length - total, total);
          if (n === 0) break;
          total += n;
        }
        const after = fstatSync(fd, { bigint: true });
        const named = lstatSync(`${fdPath(parent)}/${name}`, { bigint: true });
        if (total > MAX_BYTES || !regular(after) || stamp(before) !== stamp(after) || stamp(after) !== stamp(named)) throw denied();
        const body = bytes.subarray(0, total);
        if (body.includes(0)) throw denied();
        const content = new TextDecoder("utf-8", { fatal: true }).decode(body);
        return { content, stamp: `${stamp(after)}:${createHash("sha256").update(body).digest("hex")}` };
      } finally { closeSync(fd); }
    });
  }
  /** Never recurse or follow entry symlinks; oversized directories fail, without partial results. */
  list(subpath?: string): DirectoryEntry[] {
    return this.withDirectory(subpath, parent => {
      const dir = opendirSync(fdPath(parent), { encoding: "utf8", bufferSize: 32 });
      const entries: DirectoryEntry[] = [];
      try {
        for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
          relativePath(entry.name);
          if (entry.name.includes("/")) throw denied();
          if (entries.length === 1000) throw denied();
          const stat = lstatSync(`${fdPath(parent)}/${entry.name}`, { bigint: true });
          entries.push({ name: entry.name, kind: stat.isDirectory() ? "directory" : stat.isFile() && stat.nlink === 1n ? "file" : "unavailable" });
        }
      } finally { dir.closeSync(); }
      return entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
  }
  /** Verify the parent exists through the same anchored walk, without returning file data. */
  checkParent(path: string): void { this.withParent(path, () => undefined); }
  /** No supported atomic confined compare-and-publish primitive: all host writes deny. */
  create(_path: string, _content: string, _privateDir: string): never { throw denied(); }
}
