import { describe, expect, it } from "vitest";
import { runCliJson, shouldRun } from "../helpers.js";

describe("plugin-loads", () => {
  const testName = "plugin-loads";
  const run = () => {
    const plugins = runCliJson(["plugins", "list", "--json"]);
    expect(Array.isArray(plugins)).toBe(true);
    const list = plugins as Array<{ id?: string; enabled?: boolean }>;
    const byId = Object.fromEntries(list.map((entry) => [entry.id, !!entry.enabled]));
    expect(byId["clawos-kernel"]).toBe(true);
    expect(byId["gatekeeper-fs"]).toBe(true);
  };
  if (shouldRun(testName)) it("verifies kernel and reference gatekeeper are enabled", run);
  else it.skip("verifies kernel and reference gatekeeper are enabled", () => {});
});
