import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Grant } from "@clawos/shared";
import { describe, expect, it } from "vitest";
import { ApprovalQueueImpl } from "./approvals.js";
import { AuditLog } from "./audit.js";
import { instanceId } from "./registry.js";
import { Store } from "./store.js";

describe("ApprovalQueueImpl", () => {
  it("persists native uncertainty before effects and settles only the originating queue once", async () => {
    const root=mkdtempSync(join(tmpdir(),"approval-native-")),store=new Store(join(root,"clawos.sqlite"));store.migrate();
    const grant:Grant={handle:"grant:cccccccc",agentId:"agent-a",cellId:"cell-a",vendor:"test",resourceType:"item",resourceKey:"one",operatorId:"operator-a",scope:"agent",audience:"owner-only",status:"active",createdAt:1,createdBy:"operator"};
    store.insertGrant(grant);
    const audit=new AuditLog(join(root,"audit")),manager=new ApprovalQueueImpl(store,audit,"cell-a");
    const queue=manager.forGrant(grant,"session-a"),other=manager.forGrant(grant,"session-b");
    await queue.submitAction(1,{title:"Native write",description:"",implementsRevert:true,awaitDecision:true});
    expect(store.countPending()).toBe(0);expect(store.getAction(1)?.status).toBe("failed");
    expect(()=>manager.settleSynchronous(other,true)).toThrow();
    manager.settleSynchronous(queue,true);expect(store.getAction(1)?.status).toBe("applied");
    expect(()=>manager.settleSynchronous(queue,true)).toThrow();
    expect(audit.query(10).some(r=>r.kind==="action.apply"&&r.actionId===1&&r.ok)).toBe(true);
    const failed=manager.forGrant(grant,"session-c");
    await failed.submitAction(2,{title:"Native write",description:"",implementsRevert:true,awaitDecision:true});
    manager.settleSynchronous(failed,false);expect(store.getAction(2)?.status).toBe("failed");
    expect(store.countPending()).toBe(0);
    const deferred=manager.forGrant(grant,"session-d");
    await deferred.submitAction(3,{title:"Deferred write",description:"",implementsRevert:true});
    expect(()=>manager.settleSynchronous(deferred,true)).toThrow();expect(store.getAction(3)?.status).toBe("pending");
    await audit.flush();store.close();
  });
  it("rejects retained sessions after their grant is revoked", async () => {
    const root=mkdtempSync(join(tmpdir(),"approval-")),store=new Store(join(root,"clawos.sqlite"));
    store.migrate();
    const grant:Grant={handle:"grant:aaaaaaaa",agentId:"agent-a",cellId:"cell-a",vendor:"test",resourceType:"item",resourceKey:"one",operatorId:"operator-a",scope:"session:session-a",audience:"owner-only",status:"active",createdAt:1,createdBy:"operator"};
    store.insertGrant(grant);
    store.upsertInstance({id:instanceId(grant),vendor:grant.vendor,resourceKey:grant.resourceKey,operatorId:grant.operatorId,observerStrategy:"private-only",lockdown:0});
    const queue=new ApprovalQueueImpl(store,new AuditLog(join(root,"audit")),"cell-a").forGrant(grant,"session-a");
    store.setGrantStatus(grant.handle,"revoked");
    await expect(queue.authorizeObservation({title:"Read",description:""})).rejects.toThrow("Grant is not active.");
    await expect(queue.submitAction(1,{title:"Write",description:"",implementsRevert:false})).rejects.toThrow("Grant is not active.");
    expect(store.countPending()).toBe(0);
  });

  it("preserves instance lockdown across later registration", () => {
    const root=mkdtempSync(join(tmpdir(),"approval-")),store=new Store(join(root,"clawos.sqlite"));
    store.migrate();
    const record={id:"instance",vendor:"test",resourceKey:"one",operatorId:"operator-a",observerStrategy:"private-only",lockdown:1};
    store.upsertInstance(record);
    store.upsertInstance({...record,lockdown:0});
    expect(store.getInstance(record.id)?.lockdown).toBe(1);
    store.close();
  });

  it("denies submission if an observer joins after an owner-only session opens", async () => {
    const root=mkdtempSync(join(tmpdir(),"approval-")),store=new Store(join(root,"clawos.sqlite"));
    store.migrate();
    const grant:Grant={handle:"grant:bbbbbbbb",agentId:"agent-a",cellId:"cell-a",vendor:"test",resourceType:"item",resourceKey:"one",operatorId:"operator-a",scope:"agent",audience:"owner-only",status:"active",createdAt:1,createdBy:"operator"};
    store.insertGrant(grant);
    const queue=new ApprovalQueueImpl(store,new AuditLog(join(root,"audit")),"cell-a").forGrant(grant,"session-a");
    store.setObservers("session-a",["observer"]);
    await expect(queue.submitAction(1,{title:"Write",description:"",implementsRevert:false})).rejects.toThrow("Action denied for this audience.");
    expect(store.countPending()).toBe(0);
    store.close();
  });
});
