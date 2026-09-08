import type { ApprovalQueue, GatekeeperSession } from "@clawos/shared";
import { KitGatekeeper, OverlayStore } from "@clawos/gatekeeper-kit";
import { DirectoryBinding, denied } from "./paths.js";
import { fsResources } from "./resources.js";

/** Constructor-bound directory resource. Deliberately no executable tools before STOP 2. */
export class FsDirectory extends KitGatekeeper {
  resource = structuredClone(fsResources[0]!);
  protected overlay = new OverlayStore();
  constructor(private readonly binding: DirectoryBinding, private readonly accountLive: () => void) { super(); }
  /** Revalidate resource identity without listing or reading any directory contents. */
  override async describe() {
    this.accountLive(); this.binding.assertCurrent();
    return { resource: structuredClone(this.resource), title: "Directory", suggestedName: "DIRECTORY" };
  }
  /** No automatic filesystem write policy is offered. */
  override async getAutoApprovableActions() { this.accountLive(); return []; }
  /** Fail closed until kernel authorization and race-confined I/O are implemented and accepted. */
  override async startSession(_queue: ApprovalQueue): Promise<GatekeeperSession> { throw denied(); }
  override async applyAction(_id: number): Promise<void> { throw denied(); }
  override async rejectAction(_id: number): Promise<void> { throw denied(); }
  override async revertAction(_id: number): Promise<void> { throw denied(); }
}
