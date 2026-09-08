import { createHash } from "node:crypto";
import { join } from "node:path";
import type { GatekeeperAccount, GatekeeperVendor } from "@clawos/shared";
import type { VendorContext } from "@clawos/gatekeeper-kit";
import { FsAccount } from "./account.js";
import { configuredRoots, DirectoryBinding, denied } from "./paths.js";
import { fsResources } from "./resources.js";
import { fsTools } from "./tools.js";

/** No external credentials; only the kernel's trusted operator path may provision accounts. */
export class FsVendor implements GatekeeperVendor {
  vendor = "fs" as const; apiVersion = 1 as const;
  private readonly roots: string[];
  private readonly accounts = new Map<string, FsAccount>();
  constructor(private readonly ctx: VendorContext) { this.roots = configuredRoots(ctx.pluginConfig); }
  async describe() { return { title: "Filesystem", description: "Scoped host directories.", autoProvisionsAccount: true }; }
  async connectAccount(): Promise<{ url: string }> { throw denied(); }
  async createAccount(operatorId: string): Promise<GatekeeperAccount> {
    if (!operatorId || operatorId.length > 512 || /[\u0000-\u001f\u007f]/u.test(operatorId)) throw denied();
    const existing = this.accounts.get(operatorId);
    if (existing) return existing;
    const account = new FsAccount(this.roots.map(root => DirectoryBinding.capture(root)), () => {
      if (this.accounts.get(operatorId) === account) this.accounts.delete(operatorId);
    }, join(this.ctx.stateDir, "os", "gatekeepers", "fs", createHash("sha256").update(operatorId).digest("hex")), this.ctx.stateDir);
    this.accounts.set(operatorId, account); return account;
  }
  async getAccount(operatorId: string) { return this.accounts.get(operatorId) ?? null; }
  async getSupportedResources() { return structuredClone(fsResources); }
  async getTools() { return structuredClone(fsTools); }
}
