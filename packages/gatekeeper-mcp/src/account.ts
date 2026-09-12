import { type TokenStore } from "@clawkeepers/gatekeeper-kit";
import type { GatekeeperAccount, ObserverVerifier } from "@clawkeepers/shared";
import { bindingKey, boundaryResource, checkInventory, denied, type ServerBinding } from "./manifest.js";
import { parseProposedResourceUrl } from "./resources.js";
import { join } from "node:path";
import { McpServer } from "./server.js";
import { inspectServer, readServerNote } from "./transport.js";

/** Encrypted record contains no remotely claimed identity or discovered authorization policy. */
export interface CredentialRecord { version: 1; binding: string; bearer: string; }
/** Revocable operator account with exact endpoint/credential/inventory validation on each introduction. */
export class McpAccount implements GatekeeperAccount {
  private active = true;
  constructor(private readonly bindings: readonly ServerBinding[], private readonly store: TokenStore,
    private readonly onRevoke: () => void, private readonly inspect: typeof inspectServer = inspectServer, private readonly statePath?: string) {}
  private live = (): void => { if (!this.active) throw denied(); };
  private credential(binding: ServerBinding): CredentialRecord {
    this.live();
    const record = this.store.get<CredentialRecord>(bindingKey(binding));
    if (!record || record.version !== 1 || record.binding !== bindingKey(binding) || typeof record.bearer !== "string" || !record.bearer || /[\s\u0000-\u001f\u007f]/u.test(record.bearer)) throw denied();
    return record;
  }
  async describe() { this.live(); return { displayName: "Configured MCP credential account" }; }
  async getSupportedResources() { this.live(); return this.bindings.map(binding => boundaryResource(binding.id)); }
  async getGatekeeperFor(url: string) {
    try {
      this.live();
      const id = parseProposedResourceUrl(url, this.bindings.map(binding => binding.id));
      const binding = this.bindings.find(candidate => candidate.id === id)!;
      const before = this.credential(binding);
      checkInventory((await this.inspect(binding.endpoint, before.bearer)).tools);
      // Recheck after I/O; revocation or rotation cannot revive a stale introduction.
      if (this.credential(binding).bearer !== before.bearer) throw denied();
      const live = () => { if (this.credential(binding).bearer !== before.bearer) throw denied(); };
      const gatekeeper = new McpServer(live, async noteId => {
        live();
        const result = await readServerNote(binding.endpoint, before.bearer, noteId);
        live(); return result;
      }, this.statePath ? join(this.statePath, "resources", bindingKey(binding)) : undefined);
      return { gatekeeper, resource: boundaryResource(id), resourceKey: url };
    } catch { throw denied(); }
  }
  async getVerifier(): Promise<ObserverVerifier> { throw denied(); }
  async reconnect(): Promise<{url: string}> { throw denied(); }
  async revoke(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    // Persistent tombstone prevents automatic reprovisioning from a still-present environment secret.
    for (const binding of this.bindings) this.store.put(bindingKey(binding), { version: 1, revoked: true });
    this.onRevoke();
  }
}
