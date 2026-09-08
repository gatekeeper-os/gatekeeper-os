import { lstatSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Fixed diagnostic: never expose host paths or native error messages. */
export function denied(): Error { return new Error("Filesystem resource unavailable."); }

/** Validate literal, canonical POSIX directory paths without silently normalizing traversal. */
export function directoryPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/u.test(value) || Buffer.byteLength(value, "utf8") > 4096 ||
    Buffer.from(value, "utf8").toString("utf8") !== value) throw denied();
  const path = value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
  if (path !== "/" && path.slice(1).split("/").some(part => !part || part === "." || part === "..")) throw denied();
  return path;
}

/** Parse the ORIGINAL URL before the WHATWG parser can erase dot components or host aliases. */
export function directoryUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 12300 || !value.startsWith("file:///") ||
    /[?#\\\u0000-\u0020\u007f]/u.test(value) || /%(?:2f|5c)/iu.test(value)) throw denied();
  try { return directoryPath(decodeURIComponent(value.slice("file://".length))); }
  catch { throw denied(); }
}

/** Component-aware containment; a configured root is an allowlist, not a grant. */
export function contains(root: string, path: string): boolean {
  return root === "/" || path === root || path.startsWith(`${root}/`);
}

/** Copy and validate operator configuration; malformed configuration never becomes an empty/default grant. */
export function configuredRoots(config: Record<string, unknown>): string[] {
  if (Object.keys(config).some(key => key !== "roots")) throw denied();
  const roots = config.roots === undefined ? [] : config.roots;
  if (!Array.isArray(roots)) throw denied();
  return [...new Set(roots.map(directoryPath))];
}

interface Identity { path: string; dev: bigint; ino: bigint; }
function identity(path: string): Identity {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw denied();
  return { path, dev: stat.dev, ino: stat.ino };
}

/**
 * Introduction-time directory identity only, NOT a race-safe file-I/O primitive.
 * Every ancestor must remain the same non-symlink directory. All data access stays disabled
 * until a confined use/apply implementation is available; a check-then-open would be unsafe.
 */
export class DirectoryBinding {
  private readonly chain: Identity[];
  private constructor(readonly path: string) {
    const paths = ["/"];
    if (path !== "/") {
      let current = "";
      for (const part of path.slice(1).split("/")) { current += `/${part}`; paths.push(current); }
    }
    this.chain = paths.map(identity);
    this.assertCurrent();
  }
  /** Capture only existing directories, rejecting symlink components including those above the root. */
  static capture(path: string): DirectoryBinding {
    try { return new DirectoryBinding(directoryPath(path)); } catch { throw denied(); }
  }
  /** Reject replacement/removal of the root, target, or any ancestor since introduction. */
  assertCurrent(): void {
    try {
      for (const before of this.chain) {
        const now = identity(before.path);
        if (before.dev !== now.dev || before.ino !== now.ino) throw denied();
      }
    } catch { throw denied(); }
  }
  /** Private kernel resource identity, never an agent-facing title or tool result. */
  key(): string { return pathToFileURL(this.path).href; }
}
