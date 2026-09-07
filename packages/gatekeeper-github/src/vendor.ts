import type { GatekeeperAccount, GatekeeperVendor } from "@clawos/shared";
import type { VendorContext } from "@clawos/gatekeeper-kit";
import { resources } from "./resources.js";
import { tools } from "./tools.js";

export class GitHubVendor implements GatekeeperVendor {
  vendor = "github" as const; apiVersion = 1 as const;
  constructor(private ctx: VendorContext) {}
  async describe() { return { title: "GitHub", description: "Repositories, issues, and pull requests." }; }
  async connectAccount(_operatorId: string): Promise<{ url: string }> { throw new Error("TODO(phase-4): device flow (preferred) or web OAuth via OAuthNonceMachine"); }
  async getAccount(_operatorId: string): Promise<GatekeeperAccount | null> { return null; /* TODO(phase-4): TokenStore lookup → GitHubAccount */ }
  async getSupportedResources() { return resources; }
  async getTools() { return tools; }
}
