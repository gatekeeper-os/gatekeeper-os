import { describe, expect, it, expectTypeOf } from "vitest";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import * as S from "./schemas.js";
import type { ActionDescription, ActionKind, DryRunResult, ObservationDescription, SupportedResource, ToolResult, ObserverVerifier } from "./gatekeeper.js";
import type { AuditRecord, Grant, PendingAction } from "./grant.js";

const action = { title: "Create item", description: "One item", implementsRevert: true };
const resource = { urlPattern: "https://example.test/:id", type: "item", title: "Item", description: "", grantable: true, observerStrategy: "private-only", tools: ["gk_test_item_get"] };
const grant = { handle: "grant:7k3m9q2p", agentId: "agent", cellId: "cell", vendor: "test", resourceType: "item", resourceKey: "private/item", operatorId: "operator", scope: "agent", audience: "owner-only", status: "active", createdAt: 1, createdBy: "operator" };

// Compile-time coverage complements runtime parsing; wire schemas must remain usable as the contracts.
expectTypeOf<Static<typeof S.ActionDescriptionSchema>>().toExtend<ActionDescription>();
expectTypeOf<Static<typeof S.ActionKindSchema>>().toEqualTypeOf<ActionKind>();
expectTypeOf<Static<typeof S.ObservationDescriptionSchema>>().toEqualTypeOf<ObservationDescription>();
expectTypeOf<Static<typeof S.SupportedResourceSchema>>().toEqualTypeOf<SupportedResource>();
expectTypeOf<Static<typeof S.DryRunResultSchema>>().toExtend<DryRunResult>();
expectTypeOf<Static<typeof S.ToolResultSchema>>().toExtend<ToolResult>();
expectTypeOf<Static<typeof S.ObserverVerifierSchema>>().toExtend<ObserverVerifier>();
expectTypeOf<Static<typeof S.GrantSchema>>().toEqualTypeOf<Grant>();
expectTypeOf<Static<typeof S.PendingActionSchema>>().toEqualTypeOf<PendingAction>();
expectTypeOf<Static<typeof S.AuditRecordSchema>>().toEqualTypeOf<AuditRecord>();

describe("wire contracts", () => {
  it.each([
    [S.SupportedResourceSchema, resource], [S.ActionDescriptionSchema, action],
    [S.ActionKindSchema, { tag: "item.create", label: "Create" }],
    [S.ObservationDescriptionSchema, { title: "Read", description: "", excludeObservers: ["other"] }],
    [S.DryRunResultSchema, { kind: "action", description: action }],
    [S.ToolResultSchema, { content: [{ type: "text", text: "result" }], details: { items: [1, null, true] } }],
    [S.ObserverVerifierSchema, { vendor: "test", opaque: "test-verifier" }],
    [S.GatekeeperToolDefSchema, { name: "gk_test_item_get", resourceType: "item", kind: "observation", description: "Read item.", parameters: Type.Object({ grant: Type.String() }) }],
    [S.AccountDescriptionSchema, { displayName: "Operator", expiresAt: 1 }],
    [S.VendorDescriptionSchema, { title: "Test", description: "" }],
    [S.GatekeeperDescriptionSchema, { resource, title: "Item", suggestedName: "ITEM" }],
    [S.ConnectionResultSchema, { url: "https://example.test/connect" }],
    [S.RejectActionResultSchema, { restart: true }], [S.RevertActionResultSchema, { canRetry: false }],
    [S.GrantSchema, grant],
    [S.PendingActionSchema, { id: 1, gatekeeperInstance: "instance", actionId: 1, descriptionJson: JSON.stringify(action), status: "pending", submittedAt: 1 }],
    [S.AuditRecordSchema, { ts: "2026-09-07T00:00:00Z", cell: "cell", kind: "grant", title: "Introduced" }],
    [S.OsStatus, { cell: "cell", upstreamVersion: "2026.9.2", kernelVersion: "0.1.0", healthy: true, maintenance: false, gatekeepers: [], pendingApprovals: 0, pendingRequests: 0 }],
    [S.IntroduceParams, { agentId: "agent", url: "https://example.test/item" }],
    [S.ApprovalDecisionParams, { ids: [1, 2] }], [S.ApprovalDecisionParams, { ids: "all" }],
    [S.RevokeGrantParams, { handle: grant.handle }], [S.RequestAccessParams, { url: "https://example.test/item", reason: "Read item" }],
    [S.ListGrantsParams, {}], [S.ConnectGatekeeperParams, { vendor: "test" }],
  ])("accepts a JSON-round-tripped valid contract %#", (schema, value) => {
    expect(Value.Check(schema, JSON.parse(JSON.stringify(value)))).toBe(true);
    expect(Value.Check(schema, { ...value, unexpected: true })).toBe(false);
  });

  it("rejects client-controlled authorization labels", () => {
    for (const field of ["operatorId", "senderIsOwner", "reportedUserId", "queue", "active"]) {
      expect(Value.Check(S.IntroduceParams, { agentId: "agent", url: "https://example.test", [field]: "operator" })).toBe(false);
    }
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"])("rejects invalid action id %s", id => {
    expect(Value.Check(S.ApprovalDecisionParams, { ids: [id] })).toBe(false);
  });
  it("rejects empty and repeated decisions", () => {
    expect(Value.Check(S.ApprovalDecisionParams, { ids: [] })).toBe(false);
    expect(Value.Check(S.ApprovalDecisionParams, { ids: [1, 1] })).toBe(false);
  });
  it("requires an explicit revert declaration and valid dry-pass discriminator", () => {
    expect(Value.Check(S.ActionDescriptionSchema, { title: "Write", description: "" })).toBe(false);
    expect(Value.Check(S.DryRunResultSchema, { kind: "action", description: { title: "Read", description: "" } })).toBe(false);
  });
  it("rejects invalid grants and resource observer strategies", () => {
    for (const change of [{ status: "admin" }, { scope: "session:" }, { expiresAt: -1 }, { audience: "public" }, { handle: "grant:owner/repo" }, { handle: "grant:iiiiiiii" }]) {
      expect(Value.Check(S.GrantSchema, { ...grant, ...change })).toBe(false);
    }
    expect(Value.Check(S.SupportedResourceSchema, { ...resource, observerStrategy: "allow" })).toBe(false);
  });
  it("keeps tool names in the provider-portable boundary", () => {
    const name = "gk_x_item_" + "a".repeat(54);
    expect(Value.Check(S.ToolNameSchema, name)).toBe(true);
    for (const bad of [name + "a", "gk_x_item.Get", "gk_x_item_", "gk_x", "gk_X_item_get"]) expect(Value.Check(S.ToolNameSchema, bad)).toBe(false);
  });
  it("accepts nested JSON but rejects runtime values and nonfinite numbers", () => {
    expect(Value.Check(S.JsonValueSchema, { a: [{ b: [null, 1, "x", true] }] })).toBe(true);
    for (const value of [undefined, () => {}, 1n, NaN, Infinity]) expect(Value.Check(S.JsonValueSchema, value)).toBe(false);
  });
  it("does not allow raw payload fields in audit records", () => {
    const audit = { ts: "2026-09-07T00:00:00Z", cell: "cell", kind: "tool", title: "Tool call" };
    for (const field of ["headers", "body", "token", "prompt", "error"]) expect(Value.Check(S.AuditRecordSchema, { ...audit, [field]: "private" })).toBe(false);
  });
});
