import { constants as C, closeSync, fstatSync, lstatSync, openSync, opendirSync, readFileSync, readSync, readlinkSync, type BigIntStats } from "node:fs";
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
/** Current state of one name below an anchor: explicit absence, or a validated single-link text file. */
export type TargetState = { absent: true } | {
  absent: false; dev: string; ino: string; size: string; mtimeNs: string; ctimeNs: string;
  mode: number; uid: number; sha256: string; bytes: Buffer; stamp: string;
};
export const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const stamp = (s: BigIntStats) => [s.dev, s.ino, s.nlink, s.size, s.mtimeNs, s.ctimeNs].join(":");
const regular = (s: BigIntStats) => s.isFile() && s.nlink === 1n && s.size <= BigInt(MAX_BYTES);
const dirFlags = C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW;
/** Our own live descriptor as a path prefix; Node has no openat API. */
export const fdPath = (fd: number) => `/proc/self/fd/${fd}`;
/** Kernel mount identity of an open descriptor; distinguishes bind mounts that share st_dev. */
function mountId(fd: number): string {
  const line = readFileSync(`/proc/self/fdinfo/${fd}`, "utf8").split("\n").find(entry => entry.startsWith("mnt_id:"));
  if (!line || !/^\d+$/.test(line.slice(7).trim())) throw denied();
  return line.slice(7).trim();
}

/**
 * A directory descriptor reached by the no-follow walk and pinned for the caller's work.
 * Identity is (device, inode, mount id, pathname); any drift is detected, not prevented.
 */
export class Anchor {
  private readonly identity: string;
  constructor(readonly fd: number, readonly path: string, readonly mount: string, private readonly binding: DirectoryBinding, private readonly descriptors: number[]) {
    this.identity = this.current();
  }
  private current(): string {
    const s = fstatSync(this.fd, { bigint: true });
    if (!s.isDirectory() || readlinkSync(fdPath(this.fd)) !== this.path || mountId(this.fd) !== this.mount) throw denied();
    return `${s.dev}:${s.ino}`;
  }
  /** Same directory object at the same path on the same mount, with unchanged grant ancestry. */
  assertCurrent(): void {
    try { this.binding.assertCurrent(); if (this.current() !== this.identity) throw denied(); } catch { throw denied(); }
  }
  /** A child name, opened without following it, must stay on this anchor's mount. */
  assertSameMount(fd: number): void { if (mountId(fd) !== this.mount) throw denied(); }
  close(): void { for (const fd of this.descriptors.splice(0).reverse()) closeSync(fd); }
}

/**
 * Linux descriptor walk. Each component is opened relative to a pinned parent with
 * O_NOFOLLOW; no attacker-selected symlink is ever followed. /proc/self/fd is used
 * only for our own live descriptors (Node has no openat2/openat API, so this is the
 * documented O_NOFOLLOW + identity fallback, not strict openat2). Below the grant root
 * every component must stay on the root's mount (the RESOLVE_NO_XDEV equivalent,
 * including bind mounts). Unsupported hosts deny.
 */
export class ConfinedIO {
  constructor(private readonly binding: DirectoryBinding) {}
  /** Open and pin a directory below the grant root; the caller must close the anchor. */
  anchor(subpath: string | undefined): Anchor {
    const descriptors: number[] = [];
    try {
      if (process.platform !== "linux" || !C.O_NOFOLLOW || !C.O_DIRECTORY) throw denied();
      this.binding.assertCurrent();
      let fd = openSync("/", dirFlags); descriptors.push(fd);
      for (const part of this.binding.path.split("/").filter(Boolean)) {
        fd = openSync(`${fdPath(fd)}/${part}`, dirFlags); descriptors.push(fd);
      }
      this.binding.assertDescriptor(fstatSync(fd, { bigint: true }));
      const mount = mountId(fd);
      let expected = this.binding.path;
      if (subpath !== undefined) for (const part of relativePath(subpath).split("/")) {
        fd = openSync(`${fdPath(fd)}/${part}`, dirFlags); descriptors.push(fd);
        if (mountId(fd) !== mount) throw denied();
        expected = expected === "/" ? `/${part}` : `${expected}/${part}`;
      }
      // Descriptor identity/path checks supplement the no-follow walk, not replace it.
      return new Anchor(fd, expected, mount, this.binding, descriptors);
    } catch { for (const fd of descriptors.reverse()) closeSync(fd); throw denied(); }
  }
  private withDirectory<T>(subpath: string | undefined, fn: (fd: number, anchor: Anchor) => T): T {
    const anchor = this.anchor(subpath);
    try { const value = fn(anchor.fd, anchor); anchor.assertCurrent(); return value; }
    catch { throw denied(); }
    finally { anchor.close(); }
  }
  /** Run with the anchored parent of a relative file path. */
  withParent<T>(path: string, fn: (anchor: Anchor, name: string) => T): T {
    const parts = relativePath(path).split("/"), name = parts.pop()!;
    return this.withDirectory(parts.length ? parts.join("/") : undefined, (_fd, anchor) => fn(anchor, name));
  }
  /** Bounded read from a no-follow, single-link regular-file descriptor. Missing alone returns null. */
  read(path: string): FileSnapshot | null {
    return this.withParent(path, (anchor, name) => {
      const state = inspect(anchor, name);
      return state.absent ? null : { content: state.bytes.toString("utf8"), stamp: state.stamp };
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
}

/**
 * Validate one name below an anchor without following it: absent, or a regular,
 * single-link, bounded UTF-8 text file on the anchor's mount whose descriptor and
 * name agree before and after the read. Anything else denies.
 */
export function inspect(anchor: Anchor, name: string): TargetState {
  let fd: number;
  try { fd = openSync(`${fdPath(anchor.fd)}/${name}`, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { absent: true }; throw denied(); }
  try {
    anchor.assertSameMount(fd);
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
    const named = lstatSync(`${fdPath(anchor.fd)}/${name}`, { bigint: true });
    if (total > MAX_BYTES || !regular(after) || stamp(before) !== stamp(after) || stamp(after) !== stamp(named)) throw denied();
    const body = Buffer.from(bytes.subarray(0, total));
    if (body.includes(0)) throw denied();
    new TextDecoder("utf-8", { fatal: true }).decode(body);
    const hash = sha256(body);
    return { absent: false, dev: String(after.dev), ino: String(after.ino), size: String(after.size), mtimeNs: String(after.mtimeNs),
      ctimeNs: String(after.ctimeNs), mode: Number(after.mode & 0o7777n), uid: Number(after.uid), sha256: hash, bytes: body, stamp: `${stamp(after)}:${hash}` };
  } catch { throw denied(); }
  finally { closeSync(fd); }
}
