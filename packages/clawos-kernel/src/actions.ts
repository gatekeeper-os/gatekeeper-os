/** Serialized approval decisions and conservative, ordered automatic draining. */
import type { ActionDescription, Gatekeeper, PendingAction } from "@clawkeepers/shared";
import { ActionDescriptionSchema } from "@clawkeepers/shared";
import { Value } from "typebox/value";
import type { Store } from "./store.js";
import type { AuditLog } from "./audit.js";

/** The resolver must enforce the originating grant and session at decision time. */
export interface ActionAuthority {
  /** Resource reached through Kernel.resolveGrant. */
  gatekeeper: Gatekeeper;
  /** Synchronous final check after asynchronous account/session resolution, immediately before an effect. */
  authorize(): void;
  /** Release the retained session on every outcome. */
  close(): Promise<void>;
}
/** One coordinator lives in the kernel runtime, not in discovery facades. */
export class ActionCoordinator {
  private readonly flights = new Map<string, Promise<unknown>>();
  private stopped = false;
  constructor(private readonly store: Store, private readonly audit: AuditLog,
    private readonly cell: string, private readonly resolve: (action: PendingAction) => Promise<ActionAuthority>,
    private readonly restart: (action: PendingAction) => Promise<void>) {}

  /** Explicit decisions are ordered and share the drainer's per-instance mutex. */
  async decide(ids: number[] | "all", verb: "apply" | "reject" | "revert", operator: string): Promise<{ids:number[]}> {
    const selected = ids === "all" ? this.store.listActions(false).filter(a => a.status === (verb === "revert" ? "applied" : "pending")).map(a => a.id) : [...ids].sort((a,b) => a-b);
    for (const id of selected) {
      const action = this.store.getAction(id);
      if (!action) throw new Error("No such action.");
      await this.serial(action.gatekeeperInstance, () => this.perform(id, verb, operator));
    }
    return {ids:selected};
  }

  /** Drain independent instances; never skip an ineligible or uncertain action. */
  async drain(tags: readonly string[]): Promise<void> {
    if (this.stopped) return;
    const instances = new Set(this.store.listActions().map(a => a.gatekeeperInstance));
    await Promise.allSettled([...instances].map(instance => this.serial(instance, async () => {
      for (const action of this.store.listActions(false).filter(a => a.gatekeeperInstance === instance)) {
        if (this.stopped || action.status === "failed") break;
        if (action.status !== "pending") continue;
        const d = description(action);
        if (!d || d.autoApprovable !== true || d.awaitDecision || !d.actionKind || !tags.includes(d.actionKind.tag)) break;
        try { await this.perform(action.id, "apply", "auto-approval"); } catch { break; }
      }
    })));
  }

  /** Outstanding serialized approval effects, used by the update admission barrier. */
  get activeEffects():number{return this.flights.size;}

  /** Stop new work and wait for existing effects before SQLite is closed. */
  async stop(): Promise<void> { this.stopped = true; await Promise.allSettled([...this.flights.values()]); }

  private serial<T>(instance:string, task:()=>Promise<T>):Promise<T> {
    if (this.stopped) return Promise.reject(new Error("Approvals unavailable."));
    const result = (this.flights.get(instance) ?? Promise.resolve()).catch(()=>{}).then(task);
    this.flights.set(instance,result);
    void result.finally(()=>{if(this.flights.get(instance)===result)this.flights.delete(instance);}).catch(()=>{});
    return result;
  }

  private async perform(id:number, verb:"apply"|"reject"|"revert", operator:string):Promise<void> {
    const action = this.store.getAction(id), expected = verb === "revert" ? "applied" : "pending";
    if (!action || action.status !== expected) throw new Error("Action is not eligible.");
    if (verb === "apply" && this.store.listActions(false).some(a=>a.gatekeeperInstance===action.gatekeeperInstance&&a.id<id&&(a.status==="pending"||a.status==="failed")))throw new Error("Earlier actions require a decision or reconciliation.");
    const d = description(action);
    if (!d || (verb === "revert" && !d.implementsRevert)) throw new Error("Action is not eligible.");
    const authority = await this.resolve(action);
    try {
      if (verb === "revert" && !authority.gatekeeper.revertAction) throw new Error("Revert unavailable.");
      authority.authorize();
      // Persist fail-closed intent BEFORE external effects. A crash/throw never causes an automatic retry.
      if (!this.store.claimAction(id, expected, operator)) throw new Error("Action already decided.");
      this.audit.write({ts:new Date().toISOString(),cell:this.cell,kind:"action.decide",actionId:id,title:"Action decision",decision:verb,by:operator,ok:true});
      let restart = false;
      try {
        if (verb === "apply") await authority.gatekeeper.applyAction(action.actionId);
        else if (verb === "reject") restart = (await authority.gatekeeper.rejectAction(action.actionId))?.restart === true;
        else await authority.gatekeeper.revertAction!(action.actionId);
        this.store.decideAction(id, verb === "apply" ? "applied" : verb === "reject" ? "rejected" : "reverted", operator);
        this.audit.write({ts:new Date().toISOString(),cell:this.cell,kind:verb==="revert"?"action.revert":verb==="apply"?"action.apply":"action.decide",actionId:id,title:"Action completed",decision:verb,by:operator,ok:true});
      } catch {
        this.audit.write({ts:new Date().toISOString(),cell:this.cell,kind:"action.decide",actionId:id,title:"Action outcome unconfirmed; automatic retry disabled",decision:"failed",by:operator,ok:false});
        throw new Error("Action outcome unconfirmed; reconciliation required.");
      }
      // Notification failure must never reclassify an already confirmed resource effect.
      if (restart) await this.restart(action).catch(()=>{});
    } finally { await authority.close().catch(()=>{}); }
  }
}

function description(action:PendingAction):ActionDescription|null {
  try { const d:unknown=JSON.parse(action.descriptionJson); return Value.Check(ActionDescriptionSchema,d)?d as ActionDescription:null; } catch { return null; }
}
