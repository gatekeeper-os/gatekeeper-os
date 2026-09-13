import { createHash } from "node:crypto";
import type { SupportedResource } from "@gatekeeper-os/shared";
import { proposedResourceUrl } from "./resources.js";
import { proposedTools, mcpTools } from "./tools.js";

/** Sanitized fixed failure; never attach provider responses or credential-bearing causes. */
export const denied = (): Error => new Error("MCP boundary unavailable.");
/** One operator-owned static credential binding; not a remote-discovered identity. */
export interface ServerBinding { id: "demo"; endpoint: string; operatorId: string; credentialEnv: string; }
/** Reviewed, compiled upstream schemas. Adding a different server surface needs a new code review. */
export const reviewedInventory = proposedTools.map(tool => ({ name: tool.upstreamName, inputSchema: {
  type: "object", additionalProperties: false,
  properties: Object.fromEntries(Object.entries(tool.parameters.properties).filter(([name]) => name !== "grant")),
  required: tool.parameters.required.filter(name => name !== "grant"),
} }));
/** Canonical JSON for schema drift, independent of object key order, bounded before recursion. */
export function canonical(value: unknown): string {
  let count = 0;
  function visit(v: unknown, depth: number): unknown {
    if (++count > 4096 || depth > 16) throw denied();
    if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(item => visit(item, depth + 1));
    if (typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype) throw denied();
    return Object.fromEntries(Object.keys(v).sort().map(key => [key, visit((v as Record<string, unknown>)[key], depth + 1)]));
  }
  const text = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(text) > 65536) throw denied();
  return text;
}
/** Exact schema and inventory comparison: extra/missing tools or output-schema drift deny. */
export function checkInventory(tools: Array<{name: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>}>): void {
  if (tools.length !== reviewedInventory.length || new Set(tools.map(tool => tool.name)).size !== tools.length) throw denied();
  for (const expected of reviewedInventory) {
    const actual = tools.find(tool => tool.name === expected.name);
    if (!actual || actual.outputSchema !== undefined || canonical(actual.inputSchema) !== canonical(expected.inputSchema)) throw denied();
  }
}
/** Copy and close configuration; endpoint values never come from a model or grant URL. */
export function configuredServers(config: Record<string, unknown>): ServerBinding[] {
  if (Object.keys(config).some(key => key !== "servers")) throw denied();
  const raw = config.servers ?? [];
  if (!Array.isArray(raw) || raw.length > 16) throw denied();
  const seen = new Set<string>();
  return raw.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw denied();
    const v = value as Record<string, unknown>;
    if (Object.keys(v).sort().join() !== "credentialEnv,endpoint,id,operatorId" || v.id !== "demo" || seen.has(v.id)) throw denied();
    if (typeof v.operatorId !== "string" || !v.operatorId || v.operatorId.length > 512 || /[\u0000-\u001f\u007f]/u.test(v.operatorId)) throw denied();
    if (typeof v.credentialEnv !== "string" || !/^GKOS_MCP_[A-Z][A-Z0-9_]{0,63}$/.test(v.credentialEnv)) throw denied();
    if (typeof v.endpoint !== "string" || v.endpoint.length > 2048 || /[\s\\]/u.test(v.endpoint)) throw denied();
    let endpoint: URL;
    try { endpoint = new URL(v.endpoint); } catch { throw denied(); }
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.href !== v.endpoint) throw denied();
    seen.add(v.id);
    return { id: v.id, endpoint: v.endpoint, operatorId: v.operatorId, credentialEnv: v.credentialEnv };
  });
}
/** Binds encrypted credentials to endpoint, operator and exact reviewed schema. */
export function bindingKey(binding: ServerBinding): string {
  return createHash("sha256").update(canonical({binding, reviewedInventory})).digest("hex");
}
/** Read-only runtime resource; generic native append is not registered. */
export function boundaryResource(id: string): SupportedResource {
  return { type: `server_${id}`, urlPattern: proposedResourceUrl(id), title: "MCP server", description: "One configured server.", grantable: true, observerStrategy: "private-only", tools: mcpTools.filter(tool => tool.resourceType === `server_${id}`).map(tool => tool.name) };
}
