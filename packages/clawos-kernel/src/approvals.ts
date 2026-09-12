/** Kernel-owned queues enforce observer policy before any driver returns data. */
import { ActionDescriptionSchema } from "@clawos/shared";
import { Value } from "typebox/value";
import type { ApprovalQueue, Grant } from "@clawos/shared";
import type { AuditLog } from "./audit.js";
import type { Store } from "./store.js";
import { instanceId } from "./registry.js";
export class ApprovalQueueImpl {
  private readonly synchronous = new WeakMap<ApprovalQueue, Set<number>>();
  /** Record a native tool result only for actions submitted through this exact queue.
   * Uncertain intent was persisted before the effect; no driver-supplied receipt is trusted. */
  settleSynchronous(queue:ApprovalQueue,ok:boolean):void {
    const ids=this.synchronous.get(queue);
    this.synchronous.delete(queue);
    if(!ids || (ok && ids.size!==1))throw new Error("Native action receipt unavailable.");
    for(const id of ids){
      const action=this.store.getAction(id);
      if(!action||action.status!=="failed")throw new Error("Native action already settled.");
      if(ok)this.store.decideAction(id,"applied","native-approval");
      this.audit.write({ts:new Date().toISOString(),cell:this.cell,kind:ok?"action.apply":"action.decide",actionId:id,title:ok?"Native action completed":"Native action outcome unconfirmed",decision:ok?"apply":"failed",by:"native-approval",ok});
    }
  }
  constructor(private readonly store:Store,private readonly audit:AuditLog,private readonly cell:string){}
  forGrant(grant:Grant,sessionKey:string):ApprovalQueue{
    const instance=instanceId(grant);
    const authorize=()=>{if(!this.store.authorizeGrant(grant,grant.agentId,sessionKey,this.cell))throw new Error("Grant is not active.");};
    const submitted=new Set<number>();
    const queue:ApprovalQueue = {
      authorizeObservation:async d=>{authorize();const observers=this.store.observers(sessionKey);if(this.store.getInstance(instance)?.lockdown)throw new Error("Resource is locked down.");if(observers.length&&(grant.audience==="owner-only"||d.prohibitAllSharing||d.excludeObservers?.some(id=>observers.includes(id)))){if(d.prohibitAllSharing){this.store.lockdownInstance(instance);this.store.setGrantStatus(grant.handle,"lockdown");}throw new Error("Observation denied for this audience.");}this.audit.write({ts:new Date().toISOString(),cell:this.cell,agentId:grant.agentId,sessionKey,kind:"observation",vendor:grant.vendor,resourceType:grant.resourceType,handle:grant.handle,title:d.title,ok:true});},
      submitAction:async(actionId,d)=>{authorize();if(grant.audience==="owner-only"&&this.store.observers(sessionKey).length)throw new Error("Action denied for this audience.");if(this.store.getInstance(instance)?.lockdown)throw new Error("Resource is locked down.");if(!Number.isSafeInteger(actionId)||actionId<1||!Value.Check(ActionDescriptionSchema,d))throw new Error("Invalid action description.");const action=this.store.addAction(instance,actionId,d,d.awaitDecision?"failed":"pending");this.store.bindAction(action.id,grant.handle,grant.agentId,sessionKey);if(d.awaitDecision)submitted.add(action.id);this.audit.write({ts:new Date().toISOString(),cell:this.cell,agentId:grant.agentId,sessionKey,kind:"action.submit",vendor:grant.vendor,resourceType:grant.resourceType,handle:grant.handle,actionId:action.id,title:d.title,ok:true});},
    };
    this.synchronous.set(queue,submitted);
    return queue;
  }
}
