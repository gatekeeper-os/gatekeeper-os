/** Shared fail-closed install decision used by the primary executable and secondary hook. */
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";

/** Operator-owned rules. Hash rules authorize regular staged files only, never an unmeasured directory. */
export interface InstallRules { allowSources?: string[]; allowHashes?: string[]; }
/** Common documented fields supplied by both upstream install boundaries. */
export interface InstallMaterial { targetType: string; sourcePath: string; sourcePathKind: string; request: { kind: string; mode: string; requestedSpecifier?: string }; }
/** Minimal versioned upstream policy response; reasons never contain source material. */
export interface InstallVerdict { protocolVersion: 1; decision: "allow" | "block"; reason?: string; }
const blocked = (): InstallVerdict => ({ protocolVersion: 1, decision: "block", reason: "Install material is not authorized by cell policy." });
/** Match an entire requested specifier, with only `*` as a wildcard. No origin/name/hash labels are authority. */
export function evaluateInstall(rules: InstallRules | undefined, material: InstallMaterial): InstallVerdict {
  try {
    if (!rules || !["plugin", "skill"].includes(material.targetType) || !["install", "update"].includes(material.request.mode) ||
        typeof material.request.kind !== "string" || typeof material.sourcePath !== "string" || !material.sourcePath.startsWith("/") ||
        !["file", "directory"].includes(material.sourcePathKind)) return blocked();
    for (const entries of [rules.allowSources, rules.allowHashes]) if (entries !== undefined && (!Array.isArray(entries) || entries.some(s => typeof s !== "string" || s.length === 0 || s.length > 4096))) return blocked();
    const specifier = material.request.requestedSpecifier;
    if (typeof specifier === "string" && registrySpecifierSafe(specifier) && specifier.length > 0 && specifier.length <= 4096 && !/[\x00-\x20\x7f]/u.test(specifier) &&
        rules.allowSources?.some(pattern => new RegExp(`^${pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "u").test(specifier))) return { protocolVersion: 1, decision: "allow" };
    if (material.sourcePathKind === "file" && rules.allowHashes?.length) {
      const fd = openSync(material.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = fstatSync(fd);
        if (!before.isFile() || before.size > 16 * 1024 * 1024) return blocked();
        // Read at most the accepted size plus one byte even if a staged file grows concurrently.
        const bytes = Buffer.alloc(before.size + 1);
        let length = 0;
        while (length < bytes.length) { const n = readSync(fd, bytes, length, bytes.length - length, null); if (n === 0) break; length += n; }
        if (length !== before.size) return blocked();
        const hash = `sha256:${createHash("sha256").update(bytes.subarray(0, length)).digest("hex")}`;
        const after = fstatSync(fd);
        if (before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && rules.allowHashes.includes(hash)) return { protocolVersion: 1, decision: "allow" };
      } finally { closeSync(fd); }
    }
  } catch { /* invalid input, unreadable material and malformed policy all deny */ }
  return blocked();
}

// A namespace wildcard must not authorize name@URL, name@file or npm alias overrides.
// Upstream receives registry names/versions here; source labels alone do not establish a publisher.
function registrySpecifierSafe(specifier: string): boolean {
  const prefixed = /^(?:npm|clawhub):/.test(specifier);
  const value = prefixed ? specifier.slice(specifier.indexOf(":") + 1) : specifier;
  if (!prefixed && !value.startsWith("@") && !/^[a-z0-9][a-z0-9._-]*(?:@|$)/.test(value)) return true;
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[A-Za-z0-9._+~^<>=|*-]+)?$/.test(value);
}
