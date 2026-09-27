/** Manifest identity is the upstream registration and policy boundary, not a grant. */
import { readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

/** Require the installed manifest to declare exactly the validated driver/catalog tools. */
export function validateGatekeeperManifest(root: string, id: string, tools: readonly string[]): void {
  const manifest = JSON.parse(readFileSync(join(root, "openclaw.plugin.json"), "utf8"));
  const declared: unknown = manifest.contracts?.tools;
  if (manifest.id !== id || !Array.isArray(declared) || declared.length !== tools.length ||
      new Set(declared).size !== declared.length || declared.some(name => typeof name !== "string" || !tools.includes(name))) {
    throw new Error("Gatekeeper manifest id/contracts.tools mismatch.");
  }
}

/**
 * Resolve the manifest-declared driver module (`gkos.gatekeeper.driver`) inside the plugin root.
 * The module is loaded by the kernel, so it must stay inside the catalog-validated root after symlink resolution.
 */
export function gatekeeperDriverPath(root: string): string {
  const manifest = JSON.parse(readFileSync(join(root, "openclaw.plugin.json"), "utf8"));
  const declared: unknown = manifest.gkos?.gatekeeper?.driver;
  if (typeof declared !== "string" || !/^\.\/[A-Za-z0-9._/-]+\.m?js$/.test(declared) || declared.split("/").includes("..")) {
    throw new Error("Gatekeeper manifest driver missing or invalid.");
  }
  const canonicalRoot = realpathSync(root), path = realpathSync(join(canonicalRoot, declared));
  if (!path.startsWith(canonicalRoot + sep)) throw new Error("Gatekeeper driver escapes its root.");
  return path;
}
