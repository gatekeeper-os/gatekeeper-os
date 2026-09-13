import { realpathSync } from "node:fs";
import { Value } from "typebox/value";
import { GatekeeperToolDefSchema, SupportedResourceSchema, type ActionDescription, type GatekeeperToolDef, type GatekeeperVendor, type SupportedResource } from "@gatekeeper-os/shared";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

/** Gatekeeper declaration: metadata is separate from instance-bound implementations. */
export interface GatekeeperDefinition {
  vendor: string;
  apiVersion: 1;
  id: `gkos-gatekeeper-${string}`;
  name: string;
  description: string;
  resources: SupportedResource[];
  tools: GatekeeperToolDef[];
  /** Pure descriptions are mandatory for all declared action tools; instance implementations are checked again on calls. */
  actions?: Record<string, { describe(params: Record<string, unknown>): ActionDescription | Promise<ActionDescription> }>;
  createVendor(ctx: VendorContext): GatekeeperVendor;
}
/** Lifecycle-owned vendor configuration. No OpenClaw registration API is handed to a driver. */
export interface VendorContext {
  pluginConfig: Record<string, unknown>;
  stateDir: string;
  logger: { debug(message: string): void; info(message: string): void; warn(message: string): void; error(message: string): void };
}
/** Cell/root identity the kernel must compare to its trusted catalog before using a live driver. */
export interface GatekeeperRuntimeIdentity { pluginId: string; vendor: string; apiVersion: 1; stateDir: string; root: string; }
/** Lifecycle slot. Its vendor and every retained account/resource/session fail closed after revocation. */
export interface GatekeeperRuntime extends GatekeeperRuntimeIdentity {
  getVendor(): GatekeeperVendor;
  revoke(): void;
}
const forbidden = /approv|oauth|cache|queue|simulat/i;

/** Access transport only: the kernel still validates enablement/catalog identity and uses resolveGrant(). */
export function gatekeeperRuntimeSlot(pluginId: string) {
  if (!/^gkos-gatekeeper-[a-z][a-z0-9_]*$/.test(pluginId)) throw new Error("Invalid gatekeeper id.");
  return createPluginRuntimeStore<GatekeeperRuntime>({ pluginId, errorMessage: "Gatekeeper unavailable." });
}

/** Validate before loading a vendor; never registers tools or starts services in discovery modes. */
export function defineGatekeeper(def: GatekeeperDefinition) {
  if (!/^[a-z][a-z0-9_]*$/.test(def.vendor) || def.id !== `gkos-gatekeeper-${def.vendor}` || def.apiVersion !== 1) throw new Error("Invalid gatekeeper identity.");
  const resources = new Map<string, SupportedResource>();
  for (const resource of def.resources) {
    if (!Value.Check(SupportedResourceSchema, resource) || resources.has(resource.type)) throw new Error("Invalid or duplicate resource.");
    resources.set(resource.type, resource);
  }
  const names = new Set<string>();
  for (const tool of def.tools) {
    if (forbidden.test(tool.description)) throw new Error("Tool description leaks internals.");
    if (!Value.Check(GatekeeperToolDefSchema, JSON.parse(JSON.stringify(tool))) || !tool.name.startsWith(`gk_${def.vendor}_`) || names.has(tool.name)) throw new Error("Invalid or duplicate tool name/metadata.");
    const parameters = tool.parameters as { type?: unknown; required?: unknown; properties?: Record<string, { type?: unknown }> };
    const properties = parameters.properties;
    const required = parameters.required;
    if (parameters.type !== "object" || !properties || !Object.hasOwn(properties, "grant") || properties.grant?.type !== "string" || !Array.isArray(required) || !required.includes("grant")) throw new Error("Tool requires a string grant parameter.");
    if (!resources.get(tool.resourceType)?.tools.includes(tool.name)) throw new Error("Tool resource mapping mismatch.");
    if (tool.kind === "action" && (!def.actions || !Object.hasOwn(def.actions, tool.name) || typeof def.actions[tool.name]?.describe !== "function")) throw new Error("Action tool requires describe().");
    names.add(tool.name);
  }
  for (const resource of resources.values()) for (const name of resource.tools) {
    if (!def.tools.some(tool => tool.name === name && tool.resourceType === resource.type)) throw new Error("Resource tool mapping mismatch.");
  }
  for (const name of Object.keys(def.actions ?? {})) if (!def.tools.some(tool => tool.name === name && tool.kind === "action")) throw new Error("Undeclared action implementation.");
  // Capture identity/factory now; callers cannot redirect the slot by mutating the declaration after validation.
  const { id, vendor, apiVersion, name, description, createVendor } = def;
  return definePluginEntry({ id, name, description, register(api: OpenClawPluginApi) {
    if (api.id !== id) throw new Error("Plugin identity mismatch.");
    if (api.registrationMode !== "full") return;
    const slot = gatekeeperRuntimeSlot(id);
    let owned: GatekeeperRuntime | undefined;
    api.registerService({ id: `${id}-driver`, start(ctx) {
      if (!api.rootDir) throw new Error("Plugin root unavailable.");
      const root = realpathSync(api.rootDir), stateDir = realpathSync(ctx.stateDir);
      const instance = createVendor({ pluginConfig: structuredClone(api.pluginConfig ?? {}), stateDir, logger: { debug: message => ctx.logger.debug?.(message), info: message => ctx.logger.info(message), warn: message => ctx.logger.warn(message), error: message => ctx.logger.error(message) } });
      if (instance.vendor !== vendor || instance.apiVersion !== apiVersion) throw new Error("Vendor identity mismatch.");
      let active = true;
      const guard = () => { if (!active || slot.tryGetRuntime() !== owned) throw new Error("Gatekeeper unavailable."); };
      const wrapped = revocable(instance, guard);
      const runtime: GatekeeperRuntime = { pluginId: id, vendor, apiVersion, root, stateDir,
        getVendor() { guard(); return wrapped; }, revoke() { active = false; } };
      // A new lifecycle owner invalidates every retained handle from its predecessor.
      slot.tryGetRuntime()?.revoke();
      owned = runtime; slot.setRuntime(runtime);
    }, stop() {
      owned?.revoke();
      if (owned && slot.tryGetRuntime() === owned) slot.clearRuntime();
      owned = undefined;
    } });
  } });
}

/** Guard returned objects recursively, so retaining an account, resource or session cannot bypass service stop. */
function revocable<T extends object>(root: T, guard: () => void): T {
  const cache = new WeakMap<object, object>();
  function wrap<V>(value: V): V {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
    const existing = cache.get(value);
    if (existing) return existing as V;
    const proxy = new Proxy(value, {
      get(target, key) {
        guard();
        const member: unknown = Reflect.get(target, key, target);
        if (typeof member !== "function") return wrap(member);
        return (...args: unknown[]) => {
          guard();
          const result: unknown = Reflect.apply(member, target, args);
          if (result instanceof Promise) return result.then(resolved => { guard(); return wrap(resolved); });
          guard(); return wrap(result);
        };
      },
    });
    cache.set(value, proxy); return proxy;
  }
  return wrap(root);
}
