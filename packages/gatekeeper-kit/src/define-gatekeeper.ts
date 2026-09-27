import { realpathSync } from "node:fs";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { defineGatekeeperDriver, type GatekeeperDefinition } from "./driver.js";
import { validateGatekeeperManifest } from "./tool-contracts.js";

/**
 * Inert text returned by every kit wrapper. Only the kernel's tool-result middleware replaces it, after consuming
 * the preflight stash and rechecking the grant; without a running kernel the call does nothing. The result is
 * deliberately not an error status, because upstream keeps an error flag even after middleware replaces it.
 */
export const GATEKEEPER_TOOL_PLACEHOLDER = "Operation denied.";

/**
 * Plugin entry for a gatekeeper: declares its manifest tools under its own upstream identity. It never starts the
 * driver; the kernel loads the driver module from its catalog root and executes calls itself.
 */
export function defineGatekeeper(def: GatekeeperDefinition) {
  const { id, name, description, tools } = defineGatekeeperDriver(def);
  const declarations = structuredClone(tools);
  return definePluginEntry({ id, name, description, register(api: OpenClawPluginApi) {
    if (api.id !== id) throw new Error("Plugin identity mismatch.");
    if (!["full", "discovery", "tool-discovery"].includes(api.registrationMode)) return;
    if (!api.rootDir) throw new Error("Plugin root unavailable.");
    validateGatekeeperManifest(realpathSync(api.rootDir), id, declarations.map(tool => tool.name));
    for (const tool of declarations) api.registerTool({
      name: tool.name, label: tool.name, description: tool.description, parameters: tool.parameters,
      // Tool Search's hidden catalog bridge does not apply result middleware, so the placeholder would reach the model.
      catalogMode: "direct-only",
      execute: async () => ({ content: [{ type: "text" as const, text: GATEKEEPER_TOOL_PLACEHOLDER }], details: {} }),
    });
  } });
}
