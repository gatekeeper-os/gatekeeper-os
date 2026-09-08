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
