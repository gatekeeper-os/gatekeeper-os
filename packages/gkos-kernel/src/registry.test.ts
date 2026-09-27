import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "./registry.js";

// Real catalog, manifests and driver modules on disk; the kernel's own kit validates and starts them.
const tool = (vendor: string) => ({ name: `gk_${vendor}_item_get`, resourceType: "item", kind: "observation", description: "Get an item.",
  parameters: { type: "object", properties: { grant: { type: "string" } }, required: ["grant"] } });
const resource = (vendor: string) => ({ type: "item", title: "Item", description: "Fixture item", urlPattern: `https://${vendor}.invalid/:id`,
  grantable: true, observerStrategy: "private-only", tools: [`gk_${vendor}_item_get`] });
let base: string, stateDir: string, logger: { debug: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "gkos-registry-"))); stateDir = join(base, "state"); mkdirSync(stateDir);
  logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
});
afterEach(() => { rmSync(base, { recursive: true, force: true }); });

/** Write one installed gatekeeper; `driver` overrides the exported definition fields, `manifestDriver` the manifest path. */
function gatekeeper(vendor: string, driver: Record<string, unknown> = {}, manifestDriver: unknown = "./driver.mjs") {
  const root = join(base, vendor); mkdirSync(root);
  writeFileSync(join(root, "openclaw.plugin.json"), JSON.stringify({ id: `gkos-gatekeeper-${vendor}`, contracts: { tools: [tool(vendor).name] },
    gkos: { gatekeeper: { vendor, apiVersion: 1, driver: manifestDriver } } }));
  const definition = { id: `gkos-gatekeeper-${vendor}`, vendor, apiVersion: 1, name: vendor, description: "Fixture driver",
    resources: [resource(vendor)], tools: [tool(vendor)], ...driver };
  // The factory echoes its lifecycle-owned inputs so the test can see exactly what the kernel handed it.
  writeFileSync(join(root, "driver.mjs"), `const definition = ${JSON.stringify(definition)};
export default { ...definition, createVendor(ctx) { return { vendor: definition.vendor, apiVersion: 1,
  describe: async () => ({ title: JSON.stringify(ctx.pluginConfig), description: ctx.stateDir }),
  connectAccount: async () => ({ url: "https://example.invalid" }), getAccount: async () => null,
  getSupportedResources: async () => definition.resources, getTools: async () => definition.tools }; } };\n`);
  return { pluginId: `gkos-gatekeeper-${vendor}`, vendor, apiVersion: 1, root, tools: [tool(vendor)], resources: [resource(vendor)] };
}
function registry(...entries: ReturnType<typeof gatekeeper>[]) {
  const path = join(base, "gatekeepers.json");
  writeFileSync(path, JSON.stringify({ version: 1, gatekeepers: entries }));
  return new Registry(path, stateDir);
}
const enabled = (...ids: string[]) => ({ plugins: { entries: Object.fromEntries(ids.map(id => [id, { enabled: true, config: { owner: id } }])) } });

describe("kernel-owned driver loading", () => {
  it("starts an enabled driver with its plugin config and the cell state dir, and revokes it on stop", async () => {
    const r = registry(gatekeeper("alpha"));
    await r.start({ config: enabled("gkos-gatekeeper-alpha"), logger });
    expect(r.health()).toEqual([{ vendor: "alpha", healthy: true, accounts: 0 }]);
    const vendor = r.connection("alpha");
    expect(await vendor.describe()).toEqual({ title: JSON.stringify({ owner: "gkos-gatekeeper-alpha" }), description: stateDir });
    r.stop();
    expect(r.health()).toEqual([{ vendor: "alpha", healthy: false, accounts: 0 }]);
    expect(() => r.connection("alpha")).toThrow("Gatekeeper unavailable.");
    expect(() => vendor.describe()).toThrow(/unavailable/);
  });
  it.each([
    ["an explicitly disabled entry", { plugins: { entries: { "gkos-gatekeeper-alpha": { enabled: false } } } }],
    ["an allow-list without it", { plugins: { allow: ["gkos-kernel"] } }],
    ["a deny-list with it", { plugins: { deny: ["gkos-gatekeeper-alpha"] } }],
    ["plugins disabled", { plugins: { enabled: false } }],
  ])("never starts a driver upstream would not load: %s", async (_label, config) => {
    const r = registry(gatekeeper("alpha"));
    await r.start({ config, logger });
    expect(r.health()).toEqual([{ vendor: "alpha", healthy: false, accounts: 0 }]);
    expect(logger.warn).toHaveBeenCalledWith("GatekeeperOS: gatekeeper alpha unavailable.");
  });
  it.each([
    ["a different plugin id", { id: "gkos-gatekeeper-other" }],
    ["a different vendor", { vendor: "other" }],
    ["an extra tool beyond the catalog", { tools: [tool("alpha"), { ...tool("alpha"), name: "gk_alpha_item_list" }], resources: [{ ...resource("alpha"), tools: ["gk_alpha_item_get", "gk_alpha_item_list"] }] }],
    ["a leaking tool description", { tools: [{ ...tool("alpha"), description: "Needs approval." }] }],
  ])("rejects a driver module exporting %s", async (_label, driver) => {
    const r = registry(gatekeeper("alpha", driver));
    await r.start({ config: enabled("gkos-gatekeeper-alpha"), logger });
    expect(r.health()[0]!.healthy).toBe(false);
  });
  it.each([null, "./../alpha-escape.mjs", "./missing.mjs"])("rejects a missing or escaping manifest driver %j", async manifestDriver => {
    const r = registry(gatekeeper("alpha", {}, manifestDriver));
    await r.start({ config: enabled("gkos-gatekeeper-alpha"), logger });
    expect(r.health()[0]!.healthy).toBe(false);
  });
  it("isolates a failing driver from a healthy one", async () => {
    const r = registry(gatekeeper("alpha", { vendor: "wrong" }), gatekeeper("beta"));
    await r.start({ config: enabled("gkos-gatekeeper-alpha", "gkos-gatekeeper-beta"), logger });
    expect(r.health()).toEqual([{ vendor: "alpha", healthy: false, accounts: 0 }, { vendor: "beta", healthy: true, accounts: 0 }]);
  });
  it("restarts with fresh vendors and revokes the previous generation", async () => {
    const r = registry(gatekeeper("alpha"));
    await r.start({ config: enabled("gkos-gatekeeper-alpha"), logger });
    const first = r.connection("alpha");
    await r.start({ config: enabled("gkos-gatekeeper-alpha"), logger });
    expect(() => first.describe()).toThrow(/unavailable/);
    await expect(r.connection("alpha").describe()).resolves.toMatchObject({ description: stateDir });
  });
});
