import { mkdtempSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatekeeperAccount, GatekeeperVendor } from "@clawos/shared";
import type { GatekeeperRuntime } from "@clawos/gatekeeper-kit";
import { Registry } from "./registry.js";
import { OAuthRouter } from "./oauth.js";

const runtime = vi.hoisted(() => new Map<string, GatekeeperRuntime>());
vi.mock("@clawos/gatekeeper-kit", async importOriginal => ({
  ...await importOriginal<typeof import("@clawos/gatekeeper-kit")>(),
  gatekeeperRuntimeSlot: (id: string) => ({ tryGetRuntime: () => runtime.get(id) }),
}));

const noResource = async (): Promise<never> => { throw new Error("Not a resource fixture."); };
function vendorFixture(name = "example") {
  const accounts = new Map<string, GatekeeperAccount>();
  const account: GatekeeperAccount = { describe: async () => ({}), getSupportedResources: async () => [], getGatekeeperFor: noResource,
    getVerifier: noResource, revoke: async () => {}, reconnect: noResource };
  const connect = vi.fn<GatekeeperVendor["connectAccount"]>(async (_operator, opts) => ({ url: `https://provider.invalid/authorize?state=${opts!.state}&client_id=public-fixture` }));
  const complete = vi.fn<NonNullable<GatekeeperVendor["completeConnection"]>>(async operator => { accounts.set(operator, account); });
  const vendor: GatekeeperVendor = { vendor: name, apiVersion: 1, describe: async () => ({ title: "Fixture", description: "" }),
    connectAccount: connect, completeConnection: complete, getAccount: async operator => accounts.get(operator) ?? null,
    getSupportedResources: async () => [], getTools: async () => [] };
  return { vendor, connect, complete, account, accounts };
}
let router: OAuthRouter, registry: Registry, fixture: ReturnType<typeof vendorFixture>, clock: number;
function install(vendor: GatekeeperVendor) {
  const entry = registry.entries.get(vendor.vendor)!;
  runtime.set(entry.pluginId, { pluginId: entry.pluginId, vendor: vendor.vendor, apiVersion: 1, root: entry.root, stateDir: registry.stateDir, getVendor: () => vendor, revoke() {} });
}
async function request(url: string, method = "GET") {
  const req = new IncomingMessage(new Socket()); req.method = method; req.url = url;
  const res = new ServerResponse(req), end = vi.spyOn(res, "end").mockReturnValue(res);
  expect(await router.handle(req, res)).toBe(true);
  return { status: res.statusCode, body: String(end.mock.calls[0]?.[0]), location: res.getHeader("Location"), headers: res.getHeaders() };
}
async function begin(operator = "operator-a", resourceTypes?: string[]) {
  const start = await router.connect("example", operator, resourceTypes), response = await request(start.url);
  expect(response.status).toBe(303);
  const state = new URL(String(response.location)).searchParams.get("state")!;
  return { start: start.url, state, callback: `/os/gatekeeper/example/oauth/callback?state=${state}&code=fixture-code`, response };
}
beforeEach(() => {
  runtime.clear(); clock = 0;
  const root = mkdtempSync(join(tmpdir(), "clawos-oauth-")), path = join(root, "gatekeepers.json");
  writeFileSync(path, JSON.stringify({ version: 1, gatekeepers: ["example", "other"].map(vendor => ({
    pluginId: `gatekeeper-${vendor}`, vendor, apiVersion: 1, root, tools: [],
    resources: [{ type: "item", title: "Item", description: "Fixture item", urlPattern: "https://example.invalid/:id", grantable: true, observerStrategy: "private-only", tools: [] }],
  })) }));
  registry = new Registry(path, root); fixture = vendorFixture(); install(fixture.vendor); install(vendorFixture("other").vendor);
  router = new OAuthRouter(registry, () => clock);
});

describe("kernel account routing with real registry and kit nonce state", () => {
  it("accepts the provider's exact issuer callback and still rejects replay", async () => {
    fixture.vendor = { ...fixture.vendor, oauthIssuer: "https://github.com/login/oauth" }; install(fixture.vendor);
    const { state } = await begin();
    const callback = `/os/gatekeeper/example/oauth/callback?code=fixture-code&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth&state=${state}`;
    expect((await request(callback)).status).toBe(200);
    expect(fixture.complete).toHaveBeenCalledWith("operator-a", { code: "fixture-code", state });
    expect((await request(callback)).status).toBe(400);
    expect(fixture.complete).toHaveBeenCalledTimes(1);
  });
  it.each(["", "https://evil.invalid", "https://github.com/login/oauth/", "https://github.com/login/oauth?x=1", "https://github.com/login/oauth#x", "https://github.com/login/oauth\n"])("rejects mismatched issuer before exchange and consumes the callback: %j", async issuer => {
    fixture.vendor = { ...fixture.vendor, oauthIssuer: "https://github.com/login/oauth" }; install(fixture.vendor);
    const { callback } = await begin();
    expect((await request(callback + "&iss=" + encodeURIComponent(issuer))).status).toBe(400);
    expect((await request(callback)).status).toBe(400);
    expect(fixture.complete).not.toHaveBeenCalled();
  });
  it("rejects undeclared, duplicate, or start-route issuers without exchanging", async () => {
    const a = await begin();
    expect((await request(a.callback + "&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth")).status).toBe(400);
    fixture.vendor = { ...fixture.vendor, oauthIssuer: "https://github.com/login/oauth" }; install(fixture.vendor);
    const b = await begin();
    expect((await request(b.callback + "&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth")).status).toBe(400);
    const start = await router.connect("example", "operator-a");
    expect((await request(start.url + "&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth")).status).toBe(400);
    expect(fixture.complete).not.toHaveBeenCalled();
  });
  it("reports only numeric callback stages and retains denial if diagnostics fail", async () => {
    const report = vi.fn(); router = new OAuthRouter(registry, () => clock, report);
    const a = await begin();
    fixture.complete.mockRejectedValueOnce(new Error("private-provider-payload"));
    const failed = await request(a.callback);
    expect(failed.status).toBe(400); expect(failed.body).not.toContain("private-provider");
    expect(report.mock.calls).toEqual([[5]]);
    report.mockImplementation(() => { throw new Error("private-logger-payload"); });
    expect((await request(a.callback)).status).toBe(400);
    expect(report.mock.calls).toEqual([[5], [3]]);
  });
  it("binds start and callback to the authenticated operator and catalog resource request", async () => {
    const { state, callback, response } = await begin("operator-a", ["item"]);
    expect(fixture.connect).toHaveBeenCalledWith("operator-a", { state, callbackPath: "/os/gatekeeper/example/oauth/callback", resourceTypes: ["item"] });
    expect((await request(callback)).status).toBe(200);
    expect(fixture.complete).toHaveBeenCalledWith("operator-a", { code: "fixture-code", state, resourceTypes: ["item"] });
    expect(fixture.accounts.has("operator-a")).toBe(true);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.body).not.toContain(state);
  });
  it("rejects replay at both stages and interleaves distinct operator accounts", async () => {
    const a = await begin("operator-a"), b = await begin("operator-b");
    expect((await request(a.start)).status).toBe(400);
    expect((await request(b.callback)).status).toBe(200);
    expect((await request(a.callback)).status).toBe(200);
    expect((await request(a.callback)).status).toBe(400);
    expect(fixture.complete.mock.calls.map(args => args[0])).toEqual(["operator-b", "operator-a"]);
  });
  it("does not accept a stage-one value at callback", async () => {
    const { url } = await router.connect("example", "operator-a");
    expect((await request(url.replace("/start?", "/callback?") + "&code=fixture-code")).status).toBe(400);
    expect(fixture.complete).not.toHaveBeenCalled();
    expect((await request(url)).status).toBe(400);
  });
  it("expires both stages at ten minutes without extending expiry on advance", async () => {
    const first = await router.connect("example", "operator-a"); clock = 599_999;
    const redirect = await request(first.url), state = new URL(String(redirect.location)).searchParams.get("state");
    clock = 600_000;
    expect((await request(`/os/gatekeeper/example/oauth/callback?state=${state}&code=fixture`)).status).toBe(400);
    const expired = await router.connect("example", "operator-a"); clock += 600_000;
    expect((await request(expired.url)).status).toBe(400);
    expect(fixture.complete).not.toHaveBeenCalled();
  });
  it("rejects cross-vendor routing without consuming the original vendor nonce", async () => {
    const a = await begin();
    expect((await request(a.callback.replace("/example/", "/other/"))).status).toBe(400);
    expect((await request(a.callback)).status).toBe(200);
  });
  it("invalidates callbacks after driver replacement or kernel shutdown", async () => {
    const a = await begin(), replacement = vendorFixture(); install(replacement.vendor);
    expect((await request(a.callback)).status).toBe(400); expect(replacement.complete).not.toHaveBeenCalled();
    const b = await begin(); router.clear();
    expect((await request(b.callback)).status).toBe(400);
  });
  it("checks catalog root/cell and refuses unavailable runtimes before issuing a URL", async () => {
    const record = runtime.get("gatekeeper-example")!;
    runtime.set("gatekeeper-example", { ...record, stateDir: tmpdir() });
    await expect(router.connect("example", "operator-a")).rejects.toThrow("Account connection unavailable.");
    runtime.set("gatekeeper-example", { ...record, root: tmpdir() });
    await expect(router.connect("example", "operator-a")).rejects.toThrow("Account connection unavailable.");
    runtime.delete("gatekeeper-example");
    await expect(router.connect("example", "operator-a")).rejects.toThrow("Account connection unavailable.");
  });
  it("refuses bounded malformed/unsupported operator connection requests", async () => {
    for (const [vendor, operator, types] of [["missing", "a", undefined], ["../example", "a", undefined], ["example", "", undefined], ["example", "x".repeat(513), undefined], ["example", "a\n", undefined], ["example", "a", ["unknown"]], ["example", "a", ["item", "item"]], ["example", "a", Array(33).fill("item")]] as const) {
      await expect(router.connect(vendor, operator, types ? [...types] : undefined)).rejects.toThrow("Account connection unavailable.");
    }
    expect(fixture.connect).not.toHaveBeenCalled();
  });
  it("supports explicitly static accounts without a fake OAuth redirect or grants", async () => {
    delete fixture.vendor.completeConnection;
    fixture.vendor.describe = async () => ({ title: "Local", description: "", autoProvisionsAccount: true });
    fixture.vendor.createAccount = vi.fn(async operator => { fixture.accounts.set(operator, fixture.account); return fixture.account; });
    const { url } = await router.connect("example", "static-operator");
    expect(fixture.vendor.createAccount).not.toHaveBeenCalled();
    expect((await request(url)).status).toBe(200);
    expect(fixture.vendor.createAccount).toHaveBeenCalledWith("static-operator");
    expect(fixture.connect).not.toHaveBeenCalled();
    expect((await request(url)).status).toBe(400);
  });
  it("refuses vendors with neither callback nor explicit static provisioning", async () => {
    delete fixture.vendor.completeConnection;
    await expect(router.connect("example", "operator-a")).rejects.toThrow("Account connection unavailable.");
  });
  it.each(["javascript:alert(1)", "http://provider.invalid/?state=STATE", "https://user:pass@provider.invalid/?state=STATE", "https://provider.invalid/?state=STATE#fragment", "https://provider.invalid/?state=wrong", "https://provider.invalid/?state=STATE&state=STATE", "https://provider.invalid/?state=STATE&access_token=private-marker", "https://provider.invalid/?state=STATE&client_secret=private-marker"])("rejects unsafe authorization URLs: %s", async value => {
    fixture.connect.mockImplementation(async (_operator, opts) => ({ url: value.replaceAll("STATE", opts!.state!) }));
    const { url } = await router.connect("example", "operator-a");
    const response = await request(url);
    expect(response.status).toBe(400); expect(response.location).toBeUndefined();
    expect(response.body).not.toContain("private-marker");
    const state = fixture.connect.mock.calls[0]![1]!.state;
    expect((await request(`/os/gatekeeper/example/oauth/callback?state=${state}&code=fixture`)).status).toBe(400);
  });
  it("consumes denied/failed callbacks and sanitizes all vendor errors", async () => {
    const a = await begin();
    expect((await request(a.callback.replace("code=fixture-code", "error=private-vendor-error"))).status).toBe(400);
    expect((await request(a.callback)).status).toBe(400); expect(fixture.complete).not.toHaveBeenCalled();
    fixture.complete.mockRejectedValue(new Error("private-token-marker"));
    const b = await begin(), failed = await request(b.callback);
    expect(failed.status).toBe(400); expect(failed.body).not.toContain("private-token-marker");
    expect((await request(b.callback)).status).toBe(400); expect(fixture.complete).toHaveBeenCalledTimes(1);
  });
  it("does not claim success when the vendor did not store the bound account", async () => {
    fixture.complete.mockResolvedValue(undefined);
    expect((await request((await begin()).callback)).status).toBe(400);
  });
  it("does not route request body, forged identity fields, duplicate params or path aliases", async () => {
    const { url } = await router.connect("example", "operator-a");
    expect((await request(url, "POST")).status).toBe(405);
    expect((await request(url + "&operatorId=operator-b")).status).toBe(400);
    expect((await request(url + "&state=another")).status).toBe(400);
    expect((await request(url.replace("/example/", "/%65xample/"))).status).toBe(404);
    expect((await request("/os/gatekeeper/other/../" + url)).status).toBe(404);
    expect((await request(url + "&large=" + "x".repeat(8192))).status).toBe(400);
    expect(fixture.connect).not.toHaveBeenCalled();
    expect((await request(url)).status).toBe(303);
  });
});


describe("credential-free account registry metadata",()=>{
  it("returns only the authenticated operator's schema-checked account description",async()=>{
    expect(await registry.accountDescription("example","operator-a")).toBeNull();
    fixture.account.describe=async()=>({displayName:"Fixture",accountId:"99"});
    fixture.accounts.set("operator-a",fixture.account);
    expect(await registry.accountDescription("example","operator-a")).toEqual({displayName:"Fixture",accountId:"99"});
    expect(await registry.accountDescription("example","operator-b")).toBeNull();
  });
  it("unwraps the kit runtime membrane before returning credential-free primitives",async()=>{
    fixture.account.describe=async()=>new Proxy({displayName:"Fixture",accountId:"99"},{});
    fixture.accounts.set("operator-a",fixture.account);
    expect(await registry.accountDescription("example","operator-a")).toEqual({displayName:"Fixture",accountId:"99"});
  });
  it("rejects credential-bearing extra fields instead of returning them",async()=>{
    fixture.account.describe=async()=>({displayName:"Fixture",token:"private-fixture-value"});
    fixture.accounts.set("operator-a",fixture.account);
    await expect(registry.accountDescription("example","operator-a")).rejects.toThrow("Invalid account description.");
  });
});
