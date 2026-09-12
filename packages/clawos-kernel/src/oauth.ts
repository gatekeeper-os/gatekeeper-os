/** Kernel-owned account routing. Only authenticated operator RPC may issue a browser entry nonce. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatekeeperVendor } from "@clawkeepers/shared";
import { OAuthNonceMachine } from "@clawkeepers/gatekeeper-kit";
import type { Registry } from "./registry.js";

type Binding = { operatorId: string; resourceTypes?: string[] };
type Flow = { vendor: GatekeeperVendor; nonces: OAuthNonceMachine };
const namespace = /^[a-z][a-z0-9_]{0,63}$/;
const noncePattern = /^[A-Za-z0-9_-]{32}$/;
const denied = () => new Error("Account connection unavailable.");

/** Routes fixed catalog vendors through the kit's single-use, ten-minute, operator-bound nonce machine.
 * Vendor adapters own configured provider origins, PKCE/account checks, token exchange and encrypted storage. */
export class OAuthRouter {
  private readonly flows = new Map<string, Flow>();
  constructor(private readonly registry: Pick<Registry, "connection" | "entries">, private readonly now: () => number = Date.now) {}

  /** Issue a private local browser URL; callers must supply operator identity from authenticated RPC, not request data. */
  async connect(vendorName: string, operatorId: string, resourceTypes?: string[]): Promise<{ url: string }> {
    try {
      if (!namespace.test(vendorName) || !operatorId || operatorId.length > 512 || /[\u0000-\u001f\u007f]/u.test(operatorId)) throw denied();
      const entry = this.registry.entries.get(vendorName);
      if (!entry || (resourceTypes !== undefined && (!Array.isArray(resourceTypes) || resourceTypes.length > 32 ||
        new Set(resourceTypes).size !== resourceTypes.length || resourceTypes.some(type => typeof type !== "string" || !namespace.test(type) || !entry.resources.some(resource => resource.type === type))))) throw denied();
      const flow = this.flow(vendorName);
      if (!flow.vendor.completeConnection && !await this.staticAccount(flow.vendor)) throw denied();
      const binding: Binding = { operatorId, ...(resourceTypes ? { resourceTypes: [...resourceTypes] } : {}) };
      const state = flow.nonces.issue(JSON.stringify(binding));
      return { url: `/os/gatekeeper/${vendorName}/oauth/start?state=${state}` };
    } catch { throw denied(); }
  }

  /** Handle GET start/callback only; malformed, replayed, expired and cross-vendor nonces fail without vendor details. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    const finish = (status: number, body: string) => { res.statusCode = status; res.end(body); return true; };
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return finish(405, "Method not allowed."); }
    try {
      const raw = req.url ?? "";
      if (raw.length > 8192) throw denied();
      // Match the raw path, not a URL-normalized path; traversal and encoded aliases are never routed.
      const match = /^\/os\/gatekeeper\/([a-z][a-z0-9_]{0,63})\/oauth\/(start|callback)(?:\?([^#]*))?$/.exec(raw);
      if (!match) return finish(404, "Not found.");
      const vendorName = match[1]!, stage = match[2]!, query = new URLSearchParams(match[3] ?? "");
      const allowed = stage === "start" ? ["state"] : ["state", "code", "error"];
      for (const key of query.keys()) if (!allowed.includes(key) || query.getAll(key).length !== 1) throw denied();
      const state = query.get("state") ?? "";
      if (!noncePattern.test(state)) throw denied();
      const flow = this.flow(vendorName);
      if (stage === "start") {
        const advanced = flow.nonces.advanceBound(state);
        if (!advanced) throw denied();
        const binding = JSON.parse(advanced.operatorId) as Binding;
        try {
          if (!flow.vendor.completeConnection && await this.staticAccount(flow.vendor)) {
            if (!flow.nonces.consume(advanced.nonce)) throw denied();
            const account = await flow.vendor.getAccount(binding.operatorId) ?? await flow.vendor.createAccount!(binding.operatorId);
            if (!account) throw denied();
            return finish(200, "Account connected. You may close this window.");
          }
          const result = await flow.vendor.connectAccount(binding.operatorId, {
            ...(binding.resourceTypes ? { resourceTypes: binding.resourceTypes } : {}),
            state: advanced.nonce, callbackPath: `/os/gatekeeper/${vendorName}/oauth/callback`,
          });
          const location = authorizationUrl(result.url, advanced.nonce);
          res.setHeader("Location", location);
          return finish(303, "Continue account connection in your browser.");
        } catch { flow.nonces.consume(advanced.nonce); throw denied(); }
      }
      const bound = flow.nonces.consume(state); // Consume before any exchange; failures are not replayable.
      if (!bound || !flow.vendor.completeConnection) throw denied();
      const code = query.get("code");
      if (query.has("error") || !code || code.length > 4096 || /[\u0000-\u0020\u007f]/u.test(code)) throw denied();
      const binding = JSON.parse(bound) as Binding;
      await flow.vendor.completeConnection(binding.operatorId, { code, state, ...(binding.resourceTypes ? { resourceTypes: binding.resourceTypes } : {}) });
      if (!await flow.vendor.getAccount(binding.operatorId)) throw denied();
      return finish(200, "Account connected. You may close this window.");
    } catch { return finish(400, "Account connection unavailable. Start a new connection from your operator client."); }
  }

  /** Revoke every outstanding connection on kernel shutdown. */
  clear(): void { this.flows.clear(); }

  private flow(vendorName: string): Flow {
    const vendor = this.registry.connection(vendorName);
    let flow = this.flows.get(vendorName);
    // Restart/replacement of a vendor invalidates every old callback, even in the same cell.
    if (!flow || flow.vendor !== vendor) { flow = { vendor, nonces: new OAuthNonceMachine(600_000, this.now) }; this.flows.set(vendorName, flow); }
    return flow;
  }
  private async staticAccount(vendor: GatekeeperVendor): Promise<boolean> {
    return !!vendor.createAccount && (await vendor.describe()).autoProvisionsAccount === true;
  }
}

function authorizationUrl(value: string, state: string): string {
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u0020\u007f]/u.test(value)) throw denied();
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state) throw denied();
  for (const key of url.searchParams.keys()) if (/^(?:access_token|refresh_token|id_token|client_secret|password|authorization|code)$/i.test(key)) throw denied();
  return url.href;
}
