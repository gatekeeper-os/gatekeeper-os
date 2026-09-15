import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "./store.js";
import { instanceId } from "./registry.js";
import type { Grant } from "@gatekeeper-os/shared";

describe("Store", () => {
  it("migrates and answers isActiveHandle=false for unknown handles", () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), "st-")), "gkos.sqlite"));
    s.migrate();
    expect(s.isActiveHandle("grant:aaaaaaaa")).toBe(false);
    expect(s.countPending()).toBe(0);
  });

  it("authorizes only the current active grant in its bound cell, agent, and session", () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), "st-")), "gkos.sqlite"));
    s.migrate();
    const grant:Grant={handle:"grant:aaaaaaaa",agentId:"agent-a",cellId:"cell-a",vendor:"test",resourceType:"item",resourceKey:"one",operatorId:"operator-a",scope:"session:session-a",audience:"owner-only",status:"active",createdAt:1,createdBy:"operator",expiresAt:Date.now()+60_000};
    s.insertGrant(grant);
    expect(s.authorizeGrant(grant,"agent-a","session-a","cell-a")).toEqual(grant);
    expect(s.authorizeGrant(grant,"agent-b","session-a","cell-a")).toBeNull();
    expect(s.authorizeGrant(grant,"agent-a","session-b","cell-a")).toBeNull();
    expect(s.authorizeGrant(grant,"agent-a","session-a","cell-b")).toBeNull();
    s.setGrantStatus(grant.handle,"revoked");
    expect(s.authorizeGrant(grant,"agent-a","session-a","cell-a")).toBeNull();
  });

  it("consumes approval decisions once even when tool parameters do not match", () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), "st-")), "gkos.sqlite"));
    s.migrate();
    s.recordToolDecision("call-1","gk_test_item_set",{grant:"grant:aaaaaaaa",value:1},"allow-once");
    expect(s.consumeToolApproval("call-1","gk_test_item_set",{grant:"grant:aaaaaaaa",value:2})).toBe(false);
    expect(s.consumeToolApproval("call-1","gk_test_item_set",{grant:"grant:aaaaaaaa",value:1})).toBe(false);
  });
});

it("refuses preexisting shared grants in beta and preserves original action binding",()=>{
 const s=new Store(join(mkdtempSync(join(tmpdir(),"st-")),"gkos.sqlite"));s.migrate();
 const g:Grant={handle:"grant:bbbbbbbb",agentId:"a",cellId:"c",vendor:"test",resourceType:"item",resourceKey:"one",operatorId:"owner",scope:"agent",audience:"shared",status:"active",createdAt:1,createdBy:"operator"};s.insertGrant(g);
 expect(s.authorizeGrant(g,"a","session","c")).toBeNull();
 s.bindAction(1,"original","a","session");s.bindAction(1,"replacement","b","other");expect(s.actionBinding(1)?.handle).toBe("original");s.close();
});

it('refuses a future OS schema instead of overwriting its version during rollback startup',async()=>{
  const path=join(mkdtempSync(join(tmpdir(),'future-schema-')),'gkos.sqlite');
  const {DatabaseSync}=await import('node:sqlite');
  const database=new DatabaseSync(path);
  database.exec("CREATE TABLE meta(k TEXT PRIMARY KEY,v TEXT NOT NULL); INSERT INTO meta VALUES('schema','2');");
  database.close();
  const store=new Store(path);
  expect(()=>store.migrate()).toThrow('schema incompatible');store.close();
  const check=new DatabaseSync(path,{readOnly:true});
  expect(check.prepare("SELECT v FROM meta WHERE k='schema'").get()?.v).toBe('2');check.close();
});

// Real Node SQLite, including the pinned Node 22 runner: mocks with "fixture-instance"
// cannot reveal TEXT read truncation at the NUL separators used in production.
it("round-trips persisted instance identities without merging accounts or losing lockdown", () => {
  const path = join(mkdtempSync(join(tmpdir(), "instance-roundtrip-")), "gkos.sqlite");
  const grant:Grant = {handle:"grant:cccccccc",agentId:"a",cellId:"c",vendor:"fixture",resourceType:"record",resourceKey:"https://fixture.invalid/résumé",operatorId:"owner-a",scope:"agent",audience:"owner-only",status:"active",createdAt:1,createdBy:"operator"};
  const keys = [instanceId(grant), instanceId({...grant, operatorId:"owner-b"})];
  let store = new Store(path); store.migrate();
  try {
    for (const [index, key] of keys.entries()) {
      store.upsertInstance({id:key,vendor:grant.vendor,resourceKey:grant.resourceKey,operatorId:index ? "owner-b" : "owner-a",observerStrategy:"private-only",lockdown:0});
      const action = store.addAction(key, 1, {title:"Write",description:"",implementsRevert:false});
      expect(action.gatekeeperInstance).toBe(key);
      expect(store.getAction(action.id)?.gatekeeperInstance).toBe(key);
      expect(store.getInstance(key)?.id).toBe(key);
    }
    store.lockdownInstance(keys[0]!);
    store.close(); store = new Store(path); store.migrate();
    expect(store.listActions().map(action => action.gatekeeperInstance)).toEqual(keys);
    expect(store.listActions(false).map(action => action.gatekeeperInstance)).toEqual(keys);
    expect(store.getInstance(keys[0]!)?.lockdown).toBe(1);
    expect(store.getInstance(keys[1]!)?.lockdown).toBe(0);
    expect(store.addAction(keys[0]!, 1, {title:"Duplicate",description:"",implementsRevert:false}).id).toBe(store.listActions()[0]!.id);
    expect(store.listActions()).toHaveLength(2);
  } finally { store.close(); }
});
