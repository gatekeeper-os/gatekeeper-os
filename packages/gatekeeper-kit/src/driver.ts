import { Value } from "typebox/value";
import { GatekeeperToolDefSchema, SupportedResourceSchema, type ActionDescription, type GatekeeperToolDef, type GatekeeperVendor, type SupportedResource } from "@gatekeeper-os/shared";

/**
 * Gatekeeper declaration: metadata is separate from instance-bound implementations.
 * A driver module never imports `openclaw`; the kernel loads it directly from its catalog root.
 */
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
/** A kernel-started driver. Its vendor and every retained account/resource/session fail closed after revocation. */
export interface LiveGatekeeper {
  vendor: GatekeeperVendor;
  revoke(): void;
}

const forbidden = /approv|oauth|cache|queue|simulat/i;

/**
 * Validate driver metadata and return an immutable snapshot. The kernel calls this with its own copy of the kit
 * on every loaded module, so a driver cannot skip validation by exporting an unchecked object.
 */
export function defineGatekeeperDriver(def: GatekeeperDefinition): GatekeeperDefinition {
  if (!def || typeof def !== "object" || typeof def.createVendor !== "function") throw new Error("Invalid gatekeeper driver.");
  if (!/^[a-z][a-z0-9_]*$/.test(def.vendor) || def.id !== `gkos-gatekeeper-${def.vendor}` || def.apiVersion !== 1) throw new Error("Invalid gatekeeper identity.");
  if (!Array.isArray(def.resources) || !Array.isArray(def.tools)) throw new Error("Invalid gatekeeper metadata.");
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
  // Capture identity/factory now; callers cannot redirect the driver by mutating the declaration after validation.
  const { id, vendor, apiVersion, name, description, createVendor, actions } = def;
  return Object.freeze({ id, vendor, apiVersion, name, description, createVendor,
    resources: structuredClone(def.resources), tools: def.tools.map(tool => ({ ...tool })), ...(actions ? { actions: { ...actions } } : {}) });
}

/** Instantiate a validated driver for its lifecycle owner (the kernel). Revocation invalidates every retained handle. */
export function startGatekeeperDriver(def: GatekeeperDefinition, ctx: VendorContext): LiveGatekeeper {
  const instance = def.createVendor(ctx);
  if (instance.vendor !== def.vendor || instance.apiVersion !== def.apiVersion) throw new Error("Vendor identity mismatch.");
  let active = true;
  const guard = () => { if (!active) throw new Error("Gatekeeper unavailable."); };
  return { vendor: revocable(instance, guard), revoke() { active = false; } };
}

/** Guard returned objects recursively, so retaining an account, resource or session cannot bypass driver stop. */
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
