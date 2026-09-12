import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OverlayStore } from "./overlay-store.js";
import { CacheMutationStore } from "./cache-mutation-store.js";
import { ActionSequencer } from "./action-sequencer.js";
import { sanitizeError, sanitizedFailure, providerResponseStatus } from "./sanitize.js";
const dirs: string[] = [];
const file = () => { const d = mkdtempSync(join(tmpdir(), "clawos-store-test-")); dirs.push(d); return join(d, "state.json"); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const reducers = { append: (v: number[], e: { payload: unknown }) => { v.push(e.payload as number); return v; } };
describe("persistent simulation", () => {
  it("restores overlay and temporary ids, isolates reducers, rejects duplicates and unknown kinds", () => {
    const path = file(), o = new OverlayStore(path), base = [0];
    o.add({ actionId: 2, kind: "append", payload: 2 }); o.add({ actionId: 1, kind: "append", payload: 1 });
    expect(o.nextTempId()).toBe(-1);
    const restored = new OverlayStore(path); expect(restored.nextTempId()).toBe(-2); expect(restored.applyTo(base, reducers)).toEqual([0, 1, 2]); expect(base).toEqual([0]);
    expect(() => restored.add({ actionId: 1, kind: "append", payload: 3 })).toThrow();
    const exposed = restored.list(); exposed[0]!.payload = 100; expect(restored.list()[0]!.payload).toBe(1);
    restored.remove(1); expect(restored.applyTo(base, reducers)).toEqual([0, 2]);
    expect(() => restored.applyTo(base, {})).toThrow(/Unknown/);
  });
  it("refreshes/replays mutated cache and forgets rejected effects across restart", () => {
    const path = file(), cache = new CacheMutationStore([0], reducers, path);
    cache.add({ actionId: 1, kind: "append", payload: 1 }); cache.add({ actionId: 2, kind: "append", payload: 2 });
    expect(cache.read()).toEqual([0, 1, 2]); cache.refresh([10]); expect(cache.read()).toEqual([10, 1, 2]);
    cache.remove(1); expect(new CacheMutationStore([], reducers, path).read()).toEqual([10, 2]);
    cache.commit(2, [10, 2]); expect(cache.read()).toEqual([10, 2]);
    cache.read().push(100); expect(cache.read()).toEqual([10, 2]);
  });
  it("rejects corrupt state instead of resetting it", () => {
    const path = file(); writeFileSync(path, '{"version":1,"entries":[{}]}');
    expect(() => new OverlayStore(path)).toThrow(); expect(() => new CacheMutationStore([], reducers, path)).toThrow();
    writeFileSync(path, '{"version":1,"next":0}'); expect(() => new ActionSequencer(path)).toThrow();
  });
  it("reserves monotonically across reload and serializes even after rejection", async () => {
    const path = file(), a = new ActionSequencer(path); expect(a.next()).toBe(1); expect(new ActionSequencer(path).next()).toBe(2); expect(a.next()).toBe(3);
    const order: number[] = [];
    const first = a.run(async () => { order.push(1); throw new Error(); });
    const second = a.run(async () => { order.push(2); });
    await expect(first).rejects.toThrow(); await second; expect(order).toEqual([1, 2]);
  });
  it("never reproduces raw error text, including innocuous-looking bodies or throwing getters", () => {
    for (const value of [new Error("private body"), "private 503 data", { message: "private", status: "503" }, { get status() { throw new Error(); } }]) expect(sanitizeError(value)).toBe("The operation failed.");
    expect(sanitizeError({ status: 503, message: "private" })).toBe("The operation failed. (status 503)");
  });
});

it('preserves only numeric HTTP provenance through repeated sanitization', () => {
  const raw = Object.assign(new Error('private response'), { providerResponseStatus: 422, status: 422, body: 'private body', token: 'secret' });
  const safe = sanitizedFailure(sanitizedFailure(raw));
  expect(safe.providerResponseStatus).toBe(422);
  expect(safe.cause).toBeUndefined();
  expect(JSON.stringify(safe)).not.toMatch(/private|secret|token|body/);
  for (const value of [undefined, '422', 99, 600, 422.5, NaN]) expect(providerResponseStatus({ providerResponseStatus: value })).toBeUndefined();
  expect(providerResponseStatus({ status: 422 })).toBeUndefined();
  expect(providerResponseStatus({ get providerResponseStatus() { throw new Error('private'); } })).toBeUndefined();
});
