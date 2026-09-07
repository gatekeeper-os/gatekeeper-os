/** Gatekeeper registry built at gateway_start from plugin manifests carrying the `clawos.gatekeeper` marker (plan §4.2). */
import type { ApprovalQueue, GatekeeperSession, GatekeeperToolDef, GatekeeperVendor, Grant } from "@clawos/shared";

export class Registry {
  toolNames(): string[] { return this.tools.map((t) => t.name); }
  vendors = new Map<string, GatekeeperVendor>();
  tools: GatekeeperToolDef[] = [];
  async build(_api: unknown) { /* TODO(phase-3): discover via api.runtime (S-1 item j) or the os/gatekeepers.json catalog; populate vendors + tools */ }
  async openSession(_grant: Grant, _queue: ApprovalQueue): Promise<GatekeeperSession> { throw new Error("TODO(phase-3)"); }
}
