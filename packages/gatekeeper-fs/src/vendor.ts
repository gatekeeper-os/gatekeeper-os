import type { GatekeeperAccount, GatekeeperToolDef, GatekeeperVendor, SupportedResource } from "@clawos/shared";
import type { VendorContext } from "@clawos/gatekeeper-kit";

/** No user auth: createAccount() returns a singleton account scoped to config.roots (plan §4.3 autoProvisionsAccount). */
export class FsVendor implements GatekeeperVendor {
  vendor = "fs" as const; apiVersion = 1 as const;
  constructor(private ctx: VendorContext) {}
  async describe() { return { title: "Filesystem", description: "Scoped host directories.", autoProvisionsAccount: true }; }
  async connectAccount(): Promise<{ url: string }> { throw new Error("fs needs no account connection"); }
  async createAccount(_operatorId: string): Promise<GatekeeperAccount> { throw new Error("TODO(phase-3): FsAccount with getGatekeeperFor(file:// url) → path must be under one of config.roots (realpath, no symlink escape)"); }
  async getAccount() { return null; }
  async getSupportedResources(): Promise<SupportedResource[]> { return []; }
  async getTools(): Promise<GatekeeperToolDef[]> { return []; }
}
