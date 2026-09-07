import type { GatekeeperToolDef, GatekeeperVendor, SupportedResource } from "@clawos/shared";

/** What a gatekeeper package exports (plan Appendix B). */
export interface GatekeeperDefinition {
  vendor: string;
  apiVersion: 1;
  id: `gatekeeper-${string}`;
  name: string;
  description: string;
  resources: SupportedResource[];
  tools: GatekeeperToolDef[];
  createVendor(ctx: VendorContext): GatekeeperVendor;
}

/** Runtime context handed to the vendor: config, encrypted token store, cache dir, logger, http. TODO(phase-2). */
export interface VendorContext {
  pluginConfig: Record<string, unknown>;
  stateDir: string;
  logger: { debug(m: string): void; info(m: string): void; warn(m: string): void; error(m: string): void };
}

const FORBIDDEN_WORDS = /approv|oauth|cache|queue|simulat/i;

/** Validates a definition and returns the OpenClaw plugin entry. Throws on any rule violation (plan §9 Phase 2). */
export function defineGatekeeper(def: GatekeeperDefinition): unknown {
  for (const t of def.tools) {
    if (FORBIDDEN_WORDS.test(t.description)) throw new Error(`tool ${t.name}: description leaks internals`);
    const props = (t.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    if (!("grant" in props)) throw new Error(`tool ${t.name}: missing 'grant' parameter`);
    if (!t.name.startsWith(`gk_${def.vendor}_`)) throw new Error(`tool ${t.name}: must be named gk_${def.vendor}_<resource>_<verb>`);
  }
  for (const r of def.resources) if (!r.observerStrategy) throw new Error(`resource ${r.type}: observerStrategy required`);
  // TODO(phase-2): return definePluginEntry({ id, name, description, register(api) { … expose vendor to the kernel via
  //   api.runtime / gateway_start handshake; never api.registerTool … } }) — import from "openclaw/plugin-sdk/plugin-entry".
  return { __clawosGatekeeper: def };
}
