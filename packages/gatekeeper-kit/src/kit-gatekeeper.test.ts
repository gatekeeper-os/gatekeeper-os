import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportedResource } from "@clawos/shared";
import { KitGatekeeper } from "./kit-gatekeeper.js";
import { OverlayStore } from "./overlay-store.js";
import { TestApprovalQueue } from "./testing.js";
const dirs: string[] = [];
const file = () => { const dir = mkdtempSync(join(tmpdir(), "clawos-action-test-")); dirs.push(dir); return join(dir, "actions.json"); };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
class Resource extends KitGatekeeper {
  resource: SupportedResource = { type: "item", urlPattern: "https://example.test/:id", title: "Item", description: "", grantable: true, observerStrategy: "private-only", tools: ["gk_test_item_get", "gk_test_item_put"] };
  protected overlay: OverlayStore;
  base: string[] = [];
  awaitDecision = false;
  readonly read = vi.fn(async () => this.overlay.applyTo(this.base, { append: (v, e) => [...v, String(e.payload)] }));
  readonly apply = vi.fn(async (p: Record<string, unknown>) => { this.base.push(String(p.value)); return { remoteId: "remote", value: { written: true } }; });
  readonly revert = vi.fn(async () => { this.base.pop(); });
  constructor(path?: string) { super(path); this.overlay = new OverlayStore(path ? `${path}.overlay` : undefined); }
  override observations = { gk_test_item_get: { describe: () => ({ title: "Read", description: "Item data" }), read: () => this.read() } };
  override actions = { gk_test_item_put: {
    describe: () => ({ title: "Write", description: "One item", implementsRevert: true, awaitDecision: this.awaitDecision }),
    simulate: (p: Record<string, unknown>, overlay: OverlayStore, actionId: number) => { overlay.add({ actionId, kind: "append", payload: p.value }); return { written: true }; },
    apply: (p: Record<string, unknown>) => this.apply(p), revert: () => this.revert(),
  } };
}
const get = "gk_test_item_get", put = "gk_test_item_put", params = { grant: "grant:7k3m9q2p", value: "new" };
describe("KitGatekeeper lifecycle", () => {
  it("dry passes have no read, queue, overlay or remote side effects", async () => {
    const r = new Resource(), q = new TestApprovalQueue(), s = await r.startSession(q);
    expect(await s.call(get, params, { ...q.context(), dryRun: true })).toMatchObject({ kind: "observation" });
    expect(await s.call(put, params, { ...q.context(), dryRun: true })).toMatchObject({ kind: "action" });
    expect(q.observations).toHaveLength(0); expect(q.actions).toHaveLength(0); expect(r.read).not.toHaveBeenCalled(); expect(r.apply).not.toHaveBeenCalled();
  });
  it("authorizes before reads and denies wrong queues, shared sessions, and closed handles", async () => {
    const r = new Resource(), q = new TestApprovalQueue(), s = await r.startSession(q); q.denyObservations = true;
    await expect(s.call(get, params, q.context())).rejects.toThrow(); expect(r.read).not.toHaveBeenCalled();
    q.denyObservations = false;
    await expect(s.call(get, params, { ...q.context(), queue: new TestApprovalQueue() })).rejects.toThrow();
    await expect(s.call(get, params, { ...q.context(), observers: ["other"] })).rejects.toThrow();
    await s.close(); await expect(s.call(get, params, q.context())).rejects.toThrow(); expect(r.read).not.toHaveBeenCalled();
  });
  it("queues and simulates, then applies once and can revert once", async () => {
    const r = new Resource(), q = new TestApprovalQueue(), s = await r.startSession(q);
    await s.call(put, params, q.context()); expect(q.actions[0]!.id).toBe(1); expect(r.apply).not.toHaveBeenCalled();
    expect(await s.call(get, params, q.context("read"))).toMatchObject({ details: ["new"] });
    await Promise.all([r.applyAction(1), r.applyAction(1)]); expect(r.apply).toHaveBeenCalledTimes(1);
    expect(await s.call(get, params, q.context("read2"))).toMatchObject({ details: ["new"] });
    await r.revertAction(1); await r.revertAction(1); expect(r.revert).toHaveBeenCalledTimes(1);
  });
  it("fails closed when submission outcome is unknown", async () => {
    const r = new Resource(), q = new TestApprovalQueue(), s = await r.startSession(q); q.denyActions = true;
    await expect(s.call(put, params, q.context())).rejects.toThrow();
    await expect(s.call(get, params, q.context("read"))).rejects.toThrow(); expect(r.read).not.toHaveBeenCalled();
    expect(r.apply).not.toHaveBeenCalled();
  });
  it("rejects duplicate call ids", async () => {
    const r = new Resource(), q = new TestApprovalQueue(), s = await r.startSession(q);
    await s.call(put, params, q.context()); await expect(s.call(put, params, q.context())).rejects.toThrow(); expect(q.actions).toHaveLength(1);
  });
  it("persists pending effects and actions; rejection forgets the effect, IDs never reuse", async () => {
    const path = file(), q = new TestApprovalQueue(), first = new Resource(path), s = await first.startSession(q);
    await s.call(put, params, q.context());
    const restored = new Resource(path), next = await restored.startSession(q);
    expect(await next.call(get, params, q.context("read"))).toMatchObject({ details: ["new"] });
    await restored.rejectAction(1); await restored.rejectAction(1);
    expect(await next.call(get, params, q.context("read2"))).toMatchObject({ details: [] });
    await next.call(put, params, q.context("next")); expect(q.actions.at(-1)!.id).toBe(2);
    await restored.applyAction(2); expect(restored.apply).toHaveBeenCalledTimes(1);
    const again = new Resource(path); await again.applyAction(2); expect(again.apply).not.toHaveBeenCalled();
  });
  it("requires an exact trusted approval for unsimulated actions", async () => {
    const r = new Resource(), q = new TestApprovalQueue(), s = await r.startSession(q); r.awaitDecision = true;
    await expect(s.call(put, params, q.context())).rejects.toThrow();
    const ctx = { ...q.context(), actionApproval: { toolCallId: "test-call", tool: put, params } };
    await expect(s.call(put, { ...params, value: "changed" }, ctx)).rejects.toThrow();
    await expect(s.call(put, params, { ...ctx, toolCallId: "different" })).rejects.toThrow();
    await s.call(put, params, ctx); expect(r.apply).toHaveBeenCalledTimes(1); expect(q.actions).toHaveLength(1);
  });
  it("never retries a remote action whose outcome is uncertain", async () => {
    const r = new Resource(file()), q = new TestApprovalQueue(), s = await r.startSession(q);
    r.apply.mockRejectedValue(new Error("private remote response"));
    await s.call(put, params, q.context()); await expect(r.applyAction(1)).rejects.toThrow("The operation failed.");
    await expect(r.applyAction(1)).rejects.toThrow(); expect(r.apply).toHaveBeenCalledTimes(1);
  });
  it("denies applying a journal interrupted during remote application", async () => {
    const path = file(), r = new Resource(path), q = new TestApprovalQueue(), s = await r.startSession(q);
    await s.call(put, params, q.context()); const state = JSON.parse(readFileSync(path, "utf8")); state.records[0].status = "applying"; writeFileSync(path, JSON.stringify(state));
    const restored = new Resource(path); await expect(restored.applyAction(1)).rejects.toThrow(); expect(restored.apply).not.toHaveBeenCalled();
  });
});

describe("recovery and in-flight boundaries", () => {
  it("rebuilds a missing pending overlay and drops a terminal record's stale effect", async () => {
    const path = file(), r = new Resource(path), q = new TestApprovalQueue(), s = await r.startSession(q);
    await s.call(put, params, q.context());
    rmSync(`${path}.overlay`);
    const restored = new Resource(path), next = await restored.startSession(q);
    expect(await next.call(get, params, q.context("read"))).toMatchObject({ details: ["new"] });
    const state = JSON.parse(readFileSync(path, "utf8")); state.records[0].status = "rejected"; writeFileSync(path, JSON.stringify(state));
    const terminal = new Resource(path), last = await terminal.startSession(q);
    expect(await last.call(get, params, q.context("last"))).toMatchObject({ details: [] });
  });
  it("does not return an in-flight observation after the session closes", async () => {
    const r = new Resource(), q = new TestApprovalQueue(), s = await r.startSession(q);
    let finish!: (value: string[]) => void;
    r.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const reading = s.call(get, params, q.context());
    while (!finish) await Promise.resolve();
    await s.close(); finish(["private"]); await expect(reading).rejects.toThrow();
  });
  it("requires a real simulation effect before claiming deferred success", async () => {
    const r = new Resource(), q = new TestApprovalQueue(), s = await r.startSession(q);
    r.actions.gk_test_item_put.simulate = () => ({ written: true });
    await expect(s.call(put, params, q.context())).rejects.toThrow(); expect(r.apply).not.toHaveBeenCalled();
  });
  it("preserves action order even when the operator asks to apply a later id", async () => {
    const r = new Resource(), q = new TestApprovalQueue(), s = await r.startSession(q);
    await s.call(put, params, q.context("first")); await s.call(put, { ...params, value: "second" }, q.context("second"));
    await expect(r.applyAction(2)).rejects.toThrow(); expect(r.apply).not.toHaveBeenCalled();
    await r.rejectAction(1); await r.applyAction(2); expect(r.base).toEqual(["second"]);
  });
});
