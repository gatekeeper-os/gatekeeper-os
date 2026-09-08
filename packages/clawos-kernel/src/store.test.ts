import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "./store.js";
import type { Grant } from "@clawos/shared";

describe("Store", () => {
  it("migrates and answers isActiveHandle=false for unknown handles", () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), "st-")), "clawos.sqlite"));
    s.migrate();
    expect(s.isActiveHandle("grant:aaaaaaaa")).toBe(false);
    expect(s.countPending()).toBe(0);
  });

  it("authorizes only the current active grant in its bound cell, agent, and session", () => {
    const s = new Store(join(mkdtempSync(join(tmpdir(), "st-")), "clawos.sqlite"));
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
    const s = new Store(join(mkdtempSync(join(tmpdir(), "st-")), "clawos.sqlite"));
    s.migrate();
    s.recordToolDecision("call-1","gk_test_item_set",{grant:"grant:aaaaaaaa",value:1},"allow-once");
    expect(s.consumeToolApproval("call-1","gk_test_item_set",{grant:"grant:aaaaaaaa",value:2})).toBe(false);
    expect(s.consumeToolApproval("call-1","gk_test_item_set",{grant:"grant:aaaaaaaa",value:1})).toBe(false);
  });
});
