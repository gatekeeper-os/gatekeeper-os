import { describe, expect, it } from "vitest";
import { canonicalize, diffPaths, getPath, mergeAll, mergeConfig } from "./merge.js";

// These semantics must match `openclaw config patch` exactly (objects merge, arrays and scalars replace, null
// deletes). If they drift, `os/config.generated.json` stops being a faithful preview of the patch and the diff we
// show the operator becomes a lie.
describe("mergeConfig", () => {
  it("merges objects recursively", () => {
    expect(mergeConfig({ a: { x: 1, y: 2 } }, { a: { y: 3, z: 4 } })).toEqual({ a: { x: 1, y: 3, z: 4 } });
  });

  it("replaces arrays rather than concatenating them", () => {
    expect(mergeConfig({ deny: ["a", "b"] }, { deny: ["c"] })).toEqual({ deny: ["c"] });
  });

  it("deletes a key when the patch value is null", () => {
    const merged = mergeConfig({ a: 1, b: 2 }, { b: null }) as Record<string, unknown>;
    expect("b" in merged).toBe(false);
    expect(merged).toEqual({ a: 1 });
  });

  it("replaces a scalar with an object and vice versa", () => {
    expect(mergeConfig({ a: 1 }, { a: { b: 2 } })).toEqual({ a: { b: 2 } });
    expect(mergeConfig({ a: { b: 2 } }, { a: 1 })).toEqual({ a: 1 });
  });

  it("does not mutate its inputs", () => {
    const base = { a: { x: 1 } };
    mergeConfig(base, { a: { x: 9 } });
    expect(base).toEqual({ a: { x: 1 } });
  });
});

describe("mergeAll", () => {
  it("applies fragments in order so the last one wins", () => {
    const fragments = [{ tools: { exec: { mode: "deny" } } }, { tools: { exec: { mode: "allow" } } }];
    expect(mergeAll(fragments)).toEqual({ tools: { exec: { mode: "allow" } } });
  });
});

describe("diffPaths", () => {
  it("reports added, removed and changed leaves by path", () => {
    const before = { a: 1, b: { c: 2 }, d: 3 };
    const after = { a: 1, b: { c: 9 }, e: 4 };
    expect(diffPaths(before, after)).toEqual([
      { path: "b.c", kind: "changed" },
      { path: "d", kind: "removed" },
      { path: "e", kind: "added" },
    ]);
  });

  it("expands an added subtree into one entry per leaf", () => {
    expect(diffPaths({}, { a: { b: { c: 1 } } })).toEqual([{ path: "a.b.c", kind: "added" }]);
  });

  it("reports nothing for identical trees", () => {
    expect(diffPaths({ a: [1, 2], b: "x" }, { a: [1, 2], b: "x" })).toEqual([]);
  });

  it("never includes a value, only a path", () => {
    const changes = diffPaths({ gateway: { auth: { token: "old-secret" } } }, { gateway: { auth: { token: "new-secret" } } });
    expect(JSON.stringify(changes)).not.toContain("secret");
  });
});

describe("canonicalize", () => {
  it("is independent of key order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("distinguishes an absent path from an authored null", () => {
    // Upstream's rule: "null is an authored value, so it does not satisfy --expect-current-absent".
    expect(canonicalize(undefined)).not.toBe(canonicalize(null));
  });

  it("is order-sensitive for arrays", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });
});

describe("getPath", () => {
  it("reads a nested path and returns undefined for a missing one", () => {
    const config = { plugins: { entries: { "gkos-kernel": { enabled: true } } } };
    expect(getPath(config, "plugins.entries.gkos-kernel")).toEqual({ enabled: true });
    expect(getPath(config, "plugins.entries.gkos-gatekeeper-fs")).toBeUndefined();
    expect(getPath(config, "plugins.entries.gkos-kernel.enabled.deeper")).toBeUndefined();
  });
});
