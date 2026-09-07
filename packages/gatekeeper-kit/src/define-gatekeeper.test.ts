import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { defineGatekeeper } from "./define-gatekeeper.js";

const base = { vendor: "x", apiVersion: 1 as const, id: "gatekeeper-x" as const, name: "X", description: "d",
  resources: [{ urlPattern: "https://x/:id", type: "thing", title: "T", description: "D", grantable: true, observerStrategy: "low-stakes" as const, tools: ["gk_x_thing_get"] }],
  createVendor: () => { throw new Error("unused"); } };

describe("defineGatekeeper", () => {
  it("rejects a tool without grant", () => {
    expect(() => defineGatekeeper({ ...base, tools: [{ name: "gk_x_thing_get", resourceType: "thing", kind: "observation", description: "Get it.", parameters: Type.Object({}) }] })).toThrow(/grant/);
  });
  it("rejects a leaking description", () => {
    expect(() => defineGatekeeper({ ...base, tools: [{ name: "gk_x_thing_get", resourceType: "thing", kind: "observation", description: "Get it after approval.", parameters: Type.Object({ grant: Type.String() }) }] })).toThrow(/leaks/);
  });
  it("accepts a valid tool", () => {
    expect(() => defineGatekeeper({ ...base, tools: [{ name: "gk_x_thing_get", resourceType: "thing", kind: "observation", description: "Get it.", parameters: Type.Object({ grant: Type.String() }) }] })).not.toThrow();
  });
});

// Unit fixture only: this exercises the real builder/SDK slot without starting an OpenClaw Gateway.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk/plugin-entry";
import type { GatekeeperVendor } from "@clawos/shared";
import { gatekeeperRuntimeSlot } from "./define-gatekeeper.js";
const dirs: string[] = [];
afterEach(() => { gatekeeperRuntimeSlot("gatekeeper-x").tryGetRuntime()?.revoke(); gatekeeperRuntimeSlot("gatekeeper-x").clearRuntime(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tool = { name: "gk_x_thing_get", resourceType: "thing", kind: "observation" as const, description: "Get it.", parameters: Type.Object({ grant: Type.String() }) };
const actionDescription = { title: "Write", description: "One item", implementsRevert: false };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
function fixture(mode: OpenClawPluginApi["registrationMode"] = "full", vendor?: GatekeeperVendor) {
  const dir = mkdtempSync(join(tmpdir(), "clawos-runtime-test-")); dirs.push(dir);
  const createVendor = vi.fn((): GatekeeperVendor => vendor ?? { vendor: "x", apiVersion: 1, describe: async () => ({ title: "X", description: "" }), connectAccount: async () => ({ url: "https://example.test" }), getAccount: async () => null, getSupportedResources: async () => base.resources, getTools: async () => [tool] });
  const entry = defineGatekeeper({ ...base, tools: [tool], createVendor });
  const services: OpenClawPluginService[] = [];
  // Only fields actually read by this builder are supplied; no production authorization is mocked as accepted.
  entry.register?.({ id: "gatekeeper-x", registrationMode: mode, rootDir: dir, pluginConfig: {}, registerService: service => { services.push(service); } } as OpenClawPluginApi);
  return { services, createVendor, ctx: { stateDir: dir, config: {}, logger } };
}
describe("builder validation and lifecycle", () => {
  it.each(["APPROVAL", "OAuth", "cache", "QUEUE", "simulation"])("rejects internal description %s", description => {
    expect(() => defineGatekeeper({ ...base, tools: [{ ...tool, description }] })).toThrow(/leaks/);
  });
  it.each([Type.Object({ grant: Type.Optional(Type.String()) }), Type.Object({ grant: Type.Number() })])("requires a non-optional string grant", parameters => {
    expect(() => defineGatekeeper({ ...base, tools: [{ ...tool, parameters }] })).toThrow(/grant/);
  });
  it("requires an action descriptor and rejects duplicate tools or orphan mappings", () => {
    expect(() => defineGatekeeper({ ...base, tools: [{ ...tool, kind: "action" }] })).toThrow(/describe/);
    expect(() => defineGatekeeper({ ...base, tools: [{ ...tool, kind: "action" }], actions: { [tool.name]: { describe: () => actionDescription } } })).not.toThrow();
    expect(() => defineGatekeeper({ ...base, tools: [tool, tool] })).toThrow(/duplicate/);
    expect(() => defineGatekeeper({ ...base, tools: [{ ...tool, resourceType: "other" }] })).toThrow(/mapping/);
  });
  it("rejects overlong and dotted tool names and accepts the 64-character boundary", () => {
    for (const name of ["gk_x_thing_" + "a".repeat(54), "gk_x_thing_" + "a".repeat(55), "gk_x_thing.get"]) {
      const definition = { ...base, resources: [{ ...base.resources[0]!, tools: [name] }], tools: [{ ...tool, name }] };
      if (name.length === 64) expect(() => defineGatekeeper(definition)).not.toThrow();
      else expect(() => defineGatekeeper(definition)).toThrow();
    }
  });
  it.each(["discovery", "tool-discovery", "setup-only", "cli-metadata"] as const)("is inert in %s mode", mode => {
    const f = fixture(mode); expect(f.services).toHaveLength(0); expect(f.createVendor).not.toHaveBeenCalled(); expect(gatekeeperRuntimeSlot("gatekeeper-x").tryGetRuntime()).toBeNull();
  });
  it("publishes only at start and revokes retained vendors and nested objects on replacement/stop", async () => {
    const a = fixture(); expect(a.createVendor).not.toHaveBeenCalled(); expect(gatekeeperRuntimeSlot("gatekeeper-x").tryGetRuntime()).toBeNull();
    await a.services[0]!.start(a.ctx);
    const old = gatekeeperRuntimeSlot("gatekeeper-x").getRuntime(), retained = old.getVendor();
    const resources = await retained.getSupportedResources(); expect(resources[0]!.type).toBe("thing");
    expect(old.root).toBe(a.ctx.stateDir); expect(old.stateDir).toBe(a.ctx.stateDir);
    const b = fixture(); await b.services[0]!.start(b.ctx);
    expect(() => retained.describe()).toThrow(/unavailable/); expect(() => resources[0]).toThrow(/unavailable/);
    await a.services[0]!.stop?.(a.ctx); expect(gatekeeperRuntimeSlot("gatekeeper-x").getRuntime().stateDir).toBe(b.ctx.stateDir);
    const current = gatekeeperRuntimeSlot("gatekeeper-x").getRuntime().getVendor();
    await b.services[0]!.stop?.(b.ctx); expect(() => current.describe()).toThrow(/unavailable/); expect(gatekeeperRuntimeSlot("gatekeeper-x").tryGetRuntime()).toBeNull();
  });
});

describe("retained nested runtime handles", () => {
  it("revokes retained resource sessions as well as the top-level vendor", async () => {
    const call = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] }));
    const gatekeeper: import("@clawos/shared").Gatekeeper = {
      describe: async () => ({ resource: base.resources[0]!, title: "T", suggestedName: "T" }),
      getAutoApprovableActions: async () => [], startSession: async () => ({ call, close: async () => {} }),
      applyAction: async () => {}, rejectAction: async () => {}, addObserver: async () => {}, removeObserver: async () => {},
    };
    const account: import("@clawos/shared").GatekeeperAccount = {
      describe: async () => ({}), getSupportedResources: async () => base.resources,
      getGatekeeperFor: async () => ({ gatekeeper, resource: base.resources[0]!, resourceKey: "id" }),
      getVerifier: async () => ({ vendor: "x", opaque: "fixture" }), revoke: async () => {}, reconnect: async () => ({ url: "https://example.test" }),
    };
    const vendor: GatekeeperVendor = { vendor: "x", apiVersion: 1, describe: async () => ({ title: "X", description: "" }), connectAccount: async () => ({ url: "https://example.test" }), getAccount: async () => account, getSupportedResources: async () => base.resources, getTools: async () => [tool] };
    const f = fixture("full", vendor); await f.services[0]!.start(f.ctx);
    const liveAccount = (await gatekeeperRuntimeSlot("gatekeeper-x").getRuntime().getVendor().getAccount("op"))!;
    const bound = (await liveAccount.getGatekeeperFor("https://example.test/id")).gatekeeper;
    const queue = { authorizeObservation: async () => {}, submitAction: async () => {} };
    const session = await bound.startSession(queue);
    await session.call(tool.name, {}, { agentId: "agent", sessionKey: "session", queue }); expect(call).toHaveBeenCalledTimes(1);
    await f.services[0]!.stop?.(f.ctx);
    expect(() => session.call(tool.name, {}, { agentId: "agent", sessionKey: "session", queue })).toThrow(/unavailable/);
    expect(call).toHaveBeenCalledTimes(1); expect(() => bound.applyAction(1)).toThrow(/unavailable/);
  });
});
