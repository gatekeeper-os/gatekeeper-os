import { Type } from "typebox";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { Gatekeeper, GatekeeperAccount, GatekeeperVendor } from "@gatekeeper-os/shared";
import { defineGatekeeper, GATEKEEPER_TOOL_PLACEHOLDER } from "./define-gatekeeper.js";
import { defineGatekeeperDriver, startGatekeeperDriver } from "./driver.js";
import { gatekeeperDriverPath } from "./tool-contracts.js";

// Unit fixture only: this exercises the real builder and driver lifecycle without starting an OpenClaw Gateway.
const base = { vendor: "x", apiVersion: 1 as const, id: "gkos-gatekeeper-x" as const, name: "X", description: "d",
  resources: [{ urlPattern: "https://x/:id", type: "thing", title: "T", description: "D", grantable: true, observerStrategy: "low-stakes" as const, tools: ["gk_x_thing_get"] }],
  createVendor: () => { throw new Error("unused"); } };
const tool = { name: "gk_x_thing_get", resourceType: "thing", kind: "observation" as const, description: "Get it.", parameters: Type.Object({ grant: Type.String() }) };
const actionDescription = { title: "Write", description: "One item", implementsRevert: false };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tempDir() { const dir = mkdtempSync(join(tmpdir(), "gkos-kit-test-")); dirs.push(dir); return dir; }
function vendorFixture(account: GatekeeperAccount | null = null): GatekeeperVendor {
  return { vendor: "x", apiVersion: 1, describe: async () => ({ title: "X", description: "" }), connectAccount: async () => ({ url: "https://example.test" }), getAccount: async () => account, getSupportedResources: async () => base.resources, getTools: async () => [tool] };
}
function register(mode: OpenClawPluginApi["registrationMode"], createVendor = vi.fn(() => vendorFixture())) {
  const dir = tempDir();
  writeFileSync(join(dir, "openclaw.plugin.json"), JSON.stringify({ id: base.id, contracts: { tools: [tool.name] } }));
  const registered: Parameters<OpenClawPluginApi["registerTool"]>[0][] = [];
  const registerService = vi.fn();
  // Only fields actually read by this builder are supplied; no production authorization is mocked as accepted.
  const api: Partial<OpenClawPluginApi> = { id: base.id, registrationMode: mode, rootDir: dir, pluginConfig: {}, registerTool: t => { registered.push(t); }, registerService };
  defineGatekeeper({ ...base, tools: [tool], createVendor }).register?.(api as OpenClawPluginApi);
  return { registered, registerService, createVendor };
}

describe("driver validation", () => {
  it("rejects a tool without grant", () => {
    expect(() => defineGatekeeper({ ...base, tools: [{ ...tool, parameters: Type.Object({}) }] })).toThrow(/grant/);
  });
  it.each(["APPROVAL", "OAuth", "cache", "QUEUE", "simulation"])("rejects internal description %s", description => {
    expect(() => defineGatekeeperDriver({ ...base, tools: [{ ...tool, description }] })).toThrow(/leaks/);
  });
  it.each([Type.Object({ grant: Type.Optional(Type.String()) }), Type.Object({ grant: Type.Number() })])("requires a non-optional string grant", parameters => {
    expect(() => defineGatekeeperDriver({ ...base, tools: [{ ...tool, parameters }] })).toThrow(/grant/);
  });
  it("requires an action descriptor and rejects duplicate tools or orphan mappings", () => {
    expect(() => defineGatekeeperDriver({ ...base, tools: [{ ...tool, kind: "action" }] })).toThrow(/describe/);
    expect(() => defineGatekeeperDriver({ ...base, tools: [{ ...tool, kind: "action" }], actions: { [tool.name]: { describe: () => actionDescription } } })).not.toThrow();
    expect(() => defineGatekeeperDriver({ ...base, tools: [tool, tool] })).toThrow(/duplicate/);
    expect(() => defineGatekeeperDriver({ ...base, tools: [{ ...tool, resourceType: "other" }] })).toThrow(/mapping/);
  });
  it("rejects overlong and dotted tool names and accepts the 64-character boundary", () => {
    for (const name of ["gk_x_thing_" + "a".repeat(54), "gk_x_thing_" + "a".repeat(55), "gk_x_thing.get"]) {
      const definition = { ...base, resources: [{ ...base.resources[0]!, tools: [name] }], tools: [{ ...tool, name }] };
      if (name.length === 64) expect(() => defineGatekeeperDriver(definition)).not.toThrow();
      else expect(() => defineGatekeeperDriver(definition)).toThrow();
    }
  });
  it.each([null, 1, {}, { ...base, createVendor: "no", tools: [tool] }, { ...base, id: "gkos-gatekeeper-y", tools: [tool] }, { ...base, apiVersion: 2, tools: [tool] }])("rejects an unchecked or mismatched module export #%#", value => {
    expect(() => defineGatekeeperDriver(value as Parameters<typeof defineGatekeeperDriver>[0])).toThrow();
  });
  it("returns a frozen snapshot that later mutation of the declaration cannot redirect", () => {
    const declaration = { ...base, tools: [tool], createVendor: vi.fn(() => vendorFixture()) };
    const driver = defineGatekeeperDriver(declaration);
    Object.assign(declaration, { id: "gkos-gatekeeper-evil", createVendor: vi.fn() }); declaration.tools.push({ ...tool, name: "gk_x_thing_other" });
    expect(Object.isFrozen(driver)).toBe(true);
    expect(driver.id).toBe(base.id); expect(driver.tools.map(t => t.name)).toEqual([tool.name]);
  });
});

describe("kernel-owned driver lifecycle", () => {
  it("rejects a vendor whose identity differs from its declaration", () => {
    const driver = defineGatekeeperDriver({ ...base, tools: [tool], createVendor: () => ({ ...vendorFixture(), vendor: "y" }) });
    expect(() => startGatekeeperDriver(driver, { pluginConfig: {}, stateDir: tempDir(), logger })).toThrow(/identity/);
  });
  it("passes lifecycle-owned config and revokes retained vendors, resources and sessions", async () => {
    const call = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] }));
    const gatekeeper: Gatekeeper = {
      describe: async () => ({ resource: base.resources[0]!, title: "T", suggestedName: "T" }),
      getAutoApprovableActions: async () => [], startSession: async () => ({ call, close: async () => {} }),
      applyAction: async () => {}, rejectAction: async () => {}, addObserver: async () => {}, removeObserver: async () => {},
    };
    const account: GatekeeperAccount = {
      describe: async () => ({}), getSupportedResources: async () => base.resources,
      getGatekeeperFor: async () => ({ gatekeeper, resource: base.resources[0]!, resourceKey: "id" }),
      getVerifier: async () => ({ vendor: "x", opaque: "fixture" }), revoke: async () => {}, reconnect: async () => ({ url: "https://example.test" }),
    };
    const createVendor = vi.fn(() => vendorFixture(account)), stateDir = tempDir();
    const live = startGatekeeperDriver(defineGatekeeperDriver({ ...base, tools: [tool], createVendor }), { pluginConfig: { roots: ["/r"] }, stateDir, logger });
    expect(createVendor).toHaveBeenCalledExactlyOnceWith({ pluginConfig: { roots: ["/r"] }, stateDir, logger });
    const resources = await live.vendor.getSupportedResources(); expect(resources[0]!.type).toBe("thing");
    const bound = (await (await live.vendor.getAccount("op"))!.getGatekeeperFor("https://example.test/id")).gatekeeper;
    const queue = { authorizeObservation: async () => {}, submitAction: async () => {} };
    const session = await bound.startSession(queue);
    await session.call(tool.name, {}, { agentId: "agent", sessionKey: "session", queue }); expect(call).toHaveBeenCalledTimes(1);
    live.revoke();
    expect(() => live.vendor.describe()).toThrow(/unavailable/); expect(() => resources[0]).toThrow(/unavailable/);
    expect(() => session.call(tool.name, {}, { agentId: "agent", sessionKey: "session", queue })).toThrow(/unavailable/);
    expect(call).toHaveBeenCalledTimes(1); expect(() => bound.applyAction(1)).toThrow(/unavailable/);
  });
});

describe("plugin entry", () => {
  it.each(["setup-only", "cli-metadata"] as const)("is inert in %s mode", mode => {
    const f = register(mode); expect(f.registered).toHaveLength(0); expect(f.createVendor).not.toHaveBeenCalled();
  });
  it.each(["full", "discovery", "tool-discovery"] as const)("declares owned inert wrappers and never starts a driver in %s mode", async mode => {
    const f = register(mode);
    expect(f.registered).toHaveLength(1); expect(f.registerService).not.toHaveBeenCalled();
    const wrapper = f.registered[0];
    if (!wrapper || typeof wrapper === "function" || Array.isArray(wrapper)) throw new Error("fixture");
    expect(wrapper.catalogMode).toBe("direct-only"); // stays on the middleware path under Tool Search
    // The placeholder must not be an error status: upstream keeps that flag even after middleware replaces the result.
    expect(await wrapper.execute("call", { grant: "grant:00000000" })).toEqual({ content: [{ type: "text", text: GATEKEEPER_TOOL_PLACEHOLDER }], details: {} });
    expect(f.createVendor).not.toHaveBeenCalled();
  });
  it.each([{}, { id: base.id, contracts: { tools: [] } }, { id: "gkos-gatekeeper-other", contracts: { tools: [tool.name] } }, { id: base.id, contracts: { tools: [tool.name, tool.name] } }, { id: base.id, contracts: { tools: [tool.name, "gk_x_other_get"] } }])("rejects installed manifest mismatch before registration: %j", manifest => {
    const dir = tempDir(); writeFileSync(join(dir, "openclaw.plugin.json"), JSON.stringify(manifest));
    const registerTool = vi.fn(), entry = defineGatekeeper({ ...base, tools: [tool] });
    const api: Partial<OpenClawPluginApi> = { id: base.id, rootDir: dir, registrationMode: "tool-discovery", registerTool };
    expect(() => entry.register?.(api as OpenClawPluginApi)).toThrow(/contracts.tools/);
    expect(registerTool).not.toHaveBeenCalled();
  });
});

describe("manifest driver path", () => {
  function root(driver: unknown) {
    const dir = tempDir(); mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "driver.js"), "export default {};");
    writeFileSync(join(dir, "openclaw.plugin.json"), JSON.stringify({ id: base.id, gkos: { gatekeeper: { vendor: "x", apiVersion: 1, driver } } }));
    return dir;
  }
  it("resolves a declared module inside the root", () => {
    const dir = root("./dist/driver.js");
    expect(gatekeeperDriverPath(dir)).toBe(join(dir, "dist", "driver.js"));
  });
  it.each([undefined, 1, "dist/driver.js", "/etc/passwd.js", "./../x.js", "./dist/../../x.js", "./dist/driver.ts", "./missing.js"])("rejects a missing, absolute, traversing or non-module driver %j", driver => {
    expect(() => gatekeeperDriverPath(root(driver))).toThrow();
  });
  it("rejects a symlinked driver that resolves outside the root", () => {
    const outside = tempDir(); writeFileSync(join(outside, "evil.js"), "export default {};");
    const dir = root("./link.js"); symlinkSync(join(outside, "evil.js"), join(dir, "link.js"));
    expect(() => gatekeeperDriverPath(dir)).toThrow(/escapes/);
  });
});
