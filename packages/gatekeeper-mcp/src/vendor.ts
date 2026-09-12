import { constants, closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TokenStore, type VendorContext } from "@clawkeepers/gatekeeper-kit";
import type { GatekeeperAccount, GatekeeperVendor } from "@clawkeepers/shared";
import { McpAccount, type CredentialRecord } from "./account.js";
import { bindingKey, boundaryResource, checkInventory, configuredServers, denied, type ServerBinding } from "./manifest.js";
import { mcpTools } from "./tools.js";
import { inspectServer } from "./transport.js";

/** Load only the installer-created cell key. No key generation or production-state fallback. */
function cellKey(stateDir: string): Buffer {
  let fd: number | undefined;
  try {
    fd = openSync(join(stateDir, "os", "cell.key"), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size !== 45 || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw denied();
    const encoded = readFileSync(fd, "utf8");
    if (!/^[A-Za-z0-9+/]{43}=\n$/.test(encoded)) throw denied();
    const key = Buffer.from(encoded.trim(), "base64");
    if (key.length !== 32 || key.toString("base64") + "\n" !== encoded) throw denied();
    return key;
  } catch { throw denied(); } finally { if (fd !== undefined) closeSync(fd); }
}
/** Static per-operator credentials only; generic MCP OAuth discovery is deliberately unavailable. */
export class McpVendor implements GatekeeperVendor {
  vendor = "mcp" as const; apiVersion = 1 as const;
  private readonly bindings: ServerBinding[];
  private readonly accounts = new Map<string, McpAccount>();
  private readonly pending = new Map<string, Promise<GatekeeperAccount>>();
  private store: TokenStore | undefined;
  constructor(private readonly ctx: VendorContext, private readonly inspect: typeof inspectServer = inspectServer) { this.bindings = configuredServers(ctx.pluginConfig); }
  private tokens(): TokenStore { return this.store ??= new TokenStore(join(this.ctx.stateDir, "os", "gatekeepers", "mcp", "accounts"), cellKey(this.ctx.stateDir)); }
  async describe() { return { title: "MCP", description: "Explicitly configured credential accounts.", autoProvisionsAccount: true }; }
  async connectAccount(): Promise<{url: string}> { throw denied(); }
  async getSupportedResources() { return this.bindings.map(binding => boundaryResource(binding.id)); }
  async getTools() { return structuredClone(mcpTools); }
  async getAccount(operatorId: string) { return this.accounts.get(operatorId) ?? null; }
  async createAccount(operatorId: string): Promise<GatekeeperAccount> {
    const existing = this.accounts.get(operatorId); if (existing) return existing;
    const pending = this.pending.get(operatorId); if (pending) return pending;
    const operation = this.provision(operatorId).catch(() => { throw denied(); });
    this.pending.set(operatorId, operation);
    try { return await operation; } finally { this.pending.delete(operatorId); }
  }
  private async provision(operatorId: string): Promise<GatekeeperAccount> {
    const bindings = this.bindings.filter(binding => binding.operatorId === operatorId);
    if (!bindings.length) throw denied();
    const store = this.tokens();
    for (const binding of bindings) {
      const key = bindingKey(binding), previous = store.get<CredentialRecord>(key);
      if (previous && (previous.version !== 1 || previous.binding !== key || typeof previous.bearer !== "string")) throw denied();
      const bearer = previous?.bearer ?? process.env[binding.credentialEnv];
      if (!bearer || bearer.length > 8192 || /[\s\u0000-\u001f\u007f]/u.test(bearer)) throw denied();
      checkInventory((await this.inspect(binding.endpoint, bearer)).tools);
      if (!previous) store.put(key, { version: 1, binding: key, bearer });
    }
    const account = new McpAccount(bindings, store, () => { this.accounts.delete(operatorId); }, this.inspect, join(this.ctx.stateDir, "os", "gatekeepers", "mcp"));
    this.accounts.set(operatorId, account); return account;
  }
}
