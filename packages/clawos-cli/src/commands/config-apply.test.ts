import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { digest } from "../util/lockfile.js";
import { canonicalize } from "../util/merge.js";
import type { Json } from "../util/json5.js";
import { detectConflicts, digestOwned, mergeFragments } from "./config-apply.js";

/** Build a live owned-path map the way `ownedSlice` would. */
function live(entries: Record<string, Json | undefined>): Map<string, Json | undefined> {
  return new Map(Object.entries(entries));
}

// The ownership guard is the replacement for `config patch --expect-current-json`, which does not exist upstream.
// It is the only thing standing between a `clawos config apply` and clobbering an operator's concurrent edit, so
// it is tested for both directions: it must fire on a real conflict and must not fire on an unchanged cell.
describe("detectConflicts", () => {
  const recorded = digestOwned(live({ "gateway.bind": "loopback", "tools.exec": { mode: "deny" } }));

  it("adopts the current state on the first reconciliation, when nothing was recorded", () => {
    expect(detectConflicts(live({ "gateway.bind": "loopback" }), undefined)).toEqual({ conflicts: [], adopted: true });
    expect(detectConflicts(live({ "gateway.bind": "loopback" }), {})).toEqual({ conflicts: [], adopted: true });
  });

  it("reports no conflict when every owned path still matches what the OS wrote", () => {
    const result = detectConflicts(live({ "gateway.bind": "loopback", "tools.exec": { mode: "deny" } }), recorded);
    expect(result).toEqual({ conflicts: [], adopted: false });
  });

  it("detects a concurrent edit to an owned path", () => {
    const result = detectConflicts(live({ "gateway.bind": "lan", "tools.exec": { mode: "deny" } }), recorded);
    expect(result.conflicts).toEqual(["gateway.bind"]);
  });

  it("detects an owned path that was deleted outside the OS", () => {
    const result = detectConflicts(live({ "gateway.bind": undefined, "tools.exec": { mode: "deny" } }), recorded);
    expect(result.conflicts).toEqual(["gateway.bind"]);
  });

  it("is insensitive to key order but sensitive to value changes", () => {
    const reordered = live({ "gateway.bind": "loopback", "tools.exec": { mode: "deny" } });
    expect(detectConflicts(reordered, recorded).conflicts).toEqual([]);
    const changed = live({ "gateway.bind": "loopback", "tools.exec": { mode: "allow" } });
    expect(detectConflicts(changed, recorded).conflicts).toEqual(["tools.exec"]);
  });

  it("ignores a path that was not OS-owned at the last apply, rather than failing closed on a new path", () => {
    const withNewPath = live({ "gateway.bind": "loopback", "tools.exec": { mode: "deny" }, "update.channel": "beta" });
    expect(detectConflicts(withNewPath, recorded).conflicts).toEqual([]);
  });

  it("stores a digest, never the value, so the lockfile cannot leak an owned setting", () => {
    const digests = digestOwned(live({ "gateway.auth": { token: "${CLAWOS_GATEWAY_TOKEN}" } }));
    expect(JSON.stringify(digests)).not.toContain("CLAWOS_GATEWAY_TOKEN");
    expect(digests["gateway.auth"]).toBe(digest(canonicalize({ token: "${CLAWOS_GATEWAY_TOKEN}" })));
  });
});

describe("mergeFragments", () => {
  it("merges fragments in filename order, so 90-local wins over the baseline", () => {
    const dir = mkdtempSync(join(tmpdir(), "clawos-fragments-"));
    writeFileSync(join(dir, "00-baseline.json5"), '{ tools: { exec: { mode: "deny" } }, gateway: { bind: "loopback" } }');
    writeFileSync(join(dir, "90-local.json5"), '{ tools: { exec: { mode: "allow" } } }');
    expect(mergeFragments(dir)).toEqual({ tools: { exec: { mode: "allow" } }, gateway: { bind: "loopback" } });
  });

  it("refuses an empty fragment directory rather than generating an empty config", () => {
    // An empty merge would patch nothing, which would silently un-harden a cell.
    const dir = mkdtempSync(join(tmpdir(), "clawos-fragments-empty-"));
    expect(() => mergeFragments(dir)).toThrow(/no config fragments/);
  });

  it("refuses a missing fragment directory", () => {
    expect(() => mergeFragments(join(tmpdir(), "clawos-does-not-exist-xyz"))).toThrow(/missing fragment directory/);
  });
});
