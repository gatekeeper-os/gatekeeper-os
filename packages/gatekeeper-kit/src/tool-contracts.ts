/** Manifest identity is the upstream registration and policy boundary, not a grant. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { GatekeeperRuntimeIdentity } from "./define-gatekeeper.js";
import type { ToolResult } from "@gatekeeper-os/shared";

/** Require the installed manifest to declare exactly the validated driver/catalog tools. */
export function validateGatekeeperManifest(root: string, id: string, tools: readonly string[]): void {
  const manifest = JSON.parse(readFileSync(join(root, "openclaw.plugin.json"), "utf8"));
  const declared: unknown = manifest.contracts?.tools;
  if (manifest.id !== id || !Array.isArray(declared) || declared.length !== tools.length ||
      new Set(declared).size !== declared.length || declared.some(name => typeof name !== "string" || !tools.includes(name))) {
    throw new Error("Gatekeeper manifest id/contracts.tools mismatch.");
  }
}
/** Kernel-owned execution transport. No vendor code or standalone tool handler receives authority. */
export interface KernelToolRuntime {
  executeGatekeeperTool(identity: GatekeeperRuntimeIdentity, id: string, tool: string, params: Record<string, unknown>): Promise<ToolResult & { details: unknown }>;
}
/** Shares the kernel lifecycle slot; discovery never initializes it and stop revokes it. */
export function kernelToolRuntimeSlot() {
  return createPluginRuntimeStore<KernelToolRuntime>({ pluginId: "gkos-kernel", errorMessage: "Kernel unavailable." });
}
