import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActionDescription, Gatekeeper } from "@clawkeepers/shared";
import { Store } from "./store.js";
import { AuditLog } from "./audit.js";
import { ActionCoordinator } from "./actions.js";

let store:Store, audit:AuditLog, actions:ActionCoordinator;
const apply=vi.fn(),reject=vi.fn(),revert=vi.fn(),restart=vi.fn(),resolve=vi.fn(),close=vi.fn(),authorize=vi.fn();
const d:ActionDescription={title:"Fixture",description:"Fixture action",implementsRevert:true,autoApprovable:true,actionKind:{tag:"test.write",label:"Test"}};
const add=(id:number,description=d,instance="one")=>store.addAction(instance,id,description).id;
beforeEach(()=>{
  vi.resetAllMocks();const root=mkdtempSync(join(tmpdir(),"clawos-actions-"));
  store=new Store(join(root,"os.sqlite"));store.migrate();audit=new AuditLog(join(root,"audit"));
  apply.mockResolvedValue(undefined);reject.mockResolvedValue(undefined);revert.mockResolvedValue(undefined);close.mockResolvedValue(undefined);restart.mockResolvedValue(undefined);
  resolve.mockResolvedValue({gatekeeper:{applyAction:apply,rejectAction:reject,revertAction:revert} as Partial<Gatekeeper>,close,authorize});
  actions=new ActionCoordinator(store,audit,"test",resolve,restart);
});
afterEach(async()=>{await actions.stop();await audit.flush();store.close();});
it("requires both a configured tag and per-action eligibility",async()=>{
  add(1);await actions.drain([]);expect(apply).not.toHaveBeenCalled();
  await actions.drain(["test.write"]);expect(apply).toHaveBeenCalledWith(1);expect(store.getAction(1)?.status).toBe("applied");
});
it.each([{autoApprovable:false},{awaitDecision:true},{actionKind:{tag:"not-allowed",label:"Other"}}])("stops at ineligible head %j without skipping it",async override=>{
  add(1,{...d,...override});add(2);await actions.drain(["test.write"]);expect(apply).not.toHaveBeenCalled();
});
it("advances independent resources while preserving order within each",async()=>{
  add(1,{...d,autoApprovable:false});add(2,d,"two");add(3,d,"two");
  await actions.drain(["test.write"]);expect(apply.mock.calls.map(c=>c[0])).toEqual([2,3]);
});
it("serializes overlapping manual and timer decisions without duplicate effects",async()=>{
  add(1);let release!:()=>void;apply.mockImplementationOnce(()=>new Promise<void>(r=>{release=r;}));
  const first=actions.decide([1],"apply","operator");
  await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  const second=actions.decide([1],"apply","operator").catch(e=>e);
  const drain=actions.drain(["test.write"]);release();await Promise.all([first,second,drain]);
  expect(apply).toHaveBeenCalledOnce();expect(store.getAction(1)?.status).toBe("applied");
});
it("persists uncertain intent before effect and never retries or skips it",async()=>{
  add(1);add(2);apply.mockImplementationOnce(()=>{expect(store.getAction(1)?.status).toBe("failed");throw new Error("vendor secret");});
  await expect(actions.decide([1],"apply","operator")).rejects.toThrow("unconfirmed");
  await actions.drain(["test.write"]);expect(apply).toHaveBeenCalledOnce();
  expect(store.getAction(1)?.error).not.toContain("vendor secret");
});
it("rechecks authority before any resource effect or decision",async()=>{
  add(1);resolve.mockRejectedValue(new Error("revoked"));
  await expect(actions.decide([1],"apply","operator")).rejects.toThrow();
  expect(apply).not.toHaveBeenCalled();expect(store.getAction(1)?.status).toBe("pending");
});
it("reverts applied actions, not pending ones, and sorts explicit IDs",async()=>{
  add(1);add(2);await actions.decide([2,1],"apply","operator");
  expect(apply.mock.calls.map(c=>c[0])).toEqual([1,2]);
  await actions.decide("all","revert","operator");expect(revert.mock.calls.map(c=>c[0])).toEqual([1,2]);
  expect(store.getAction(1)?.status).toBe("reverted");
});
it("reject restart notification failure does not lose a confirmed decision",async()=>{
  add(1);reject.mockResolvedValue({restart:true});restart.mockRejectedValue(new Error("delivery failed"));
  await actions.decide([1],"reject","operator");expect(restart).toHaveBeenCalledOnce();expect(store.getAction(1)?.status).toBe("rejected");
});
it("stops and awaits active effects before teardown",async()=>{
  add(1);await actions.stop();await actions.drain(["test.write"]);
  await expect(actions.decide([1],"apply","operator")).rejects.toThrow("unavailable");expect(apply).not.toHaveBeenCalled();
});

it("rechecks authority after asynchronous resolution without claiming or performing the action",async()=>{
  add(1);authorize.mockImplementation(()=>{throw new Error("revoked during resolution");});
  await expect(actions.decide([1],"apply","operator")).rejects.toThrow("revoked");
  expect(apply).not.toHaveBeenCalled();expect(store.getAction(1)?.status).toBe("pending");expect(close).toHaveBeenCalledOnce();
});
