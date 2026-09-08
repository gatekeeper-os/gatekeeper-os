import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect, gatewayUrl } from "../harness.js";
import type { GatewayClient } from "openclaw/plugin-sdk/gateway-runtime";

const fake = vi.hoisted(() => ({
  options: undefined as ConstructorParameters<typeof GatewayClient>[0] | undefined,
  mode: "ready", request: vi.fn(), stop: vi.fn(), constructed: vi.fn(),
}));
vi.mock("openclaw/plugin-sdk/gateway-runtime", () => ({ GatewayClient: class {
  constructor(options: ConstructorParameters<typeof GatewayClient>[0]) { fake.options = options; fake.constructed(); }
  start() {
    if (fake.mode === "ready") fake.options?.onHelloOk?.({} as Parameters<NonNullable<typeof fake.options.onHelloOk>>[0]);
    if (fake.mode === "error") fake.options?.onConnectError?.(new Error("private fixture payload"));
    if (fake.mode === "close") fake.options?.onClose?.(1006, "private fixture payload");
  }
  request = fake.request;
  stopAndWait = fake.stop;
} }));
beforeEach(() => {
  vi.clearAllMocks(); fake.mode = "ready";
  fake.request.mockResolvedValue({ ok: true }); fake.stop.mockResolvedValue(undefined);
  vi.stubEnv("OPENCLAW_STATE_DIR", "/tmp/conformance-fixture-state");
  vi.stubEnv("OPENCLAW_CONFIG_PATH", "/tmp/conformance-fixture-state/openclaw.json");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("public SDK transport", () => {
  it("honors the explicit endpoint and passes structured RPC parameters in memory", async () => {
    const harness = await connect("ws://127.0.0.1:19999", "fixture-auth");
    expect(fake.options?.url).toBe("ws://127.0.0.1:19999/");
    expect(fake.options?.token).toBe("fixture-auth");
    expect(harness).not.toHaveProperty("token");
    expect(fake.options?.requestTimeoutMs).toBe(30_000);
    const params = { url: "file:///tmp/test", nested: { label: "literal $(fixture)" } };
    expect(await harness.call("os.grants.introduce", params)).toEqual({ ok: true });
    expect(fake.request).toHaveBeenCalledWith("os.grants.introduce", params);
    await harness.close(); await harness.close();
    expect(fake.stop).toHaveBeenCalledTimes(1);
    await expect(harness.call("os.status")).rejects.toThrow("CONFORMANCE_CLIENT_CLOSED");
  });
  it.each([undefined, "", "http://127.0.0.1", "ws://user:password@localhost", "ws://localhost/?auth=fixture", "ws://localhost/#fixture"])("refuses invalid endpoint %#", value => {
    expect(() => gatewayUrl(value)).toThrow("CONFORMANCE_INVALID_GATEWAY_URL");
    expect(fake.constructed).not.toHaveBeenCalled();
  });
  it("refuses implicit state before constructing the SDK client", async () => {
    vi.stubEnv("OPENCLAW_CONFIG_PATH", "");
    await expect(connect("ws://127.0.0.1:19999")).rejects.toThrow("CONFORMANCE_EXPLICIT_STATE_REQUIRED");
    expect(fake.constructed).not.toHaveBeenCalled();
  });
  it.each(["error", "close"])("closes failed startup on %s and sanitizes upstream errors", async mode => {
    fake.mode = mode;
    await expect(connect("ws://127.0.0.1:19999")).rejects.toThrow("CONFORMANCE_CONNECT_FAILED");
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });
  it("times out and closes a handshake that never completes", async () => {
    vi.useFakeTimers(); fake.mode = "pending";
    const promise = connect("ws://127.0.0.1:19999");
    const assertion = expect(promise).rejects.toThrow("CONFORMANCE_CONNECT_FAILED");
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(30_000); await assertion;
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });
  it("propagates sanitized RPC failure instead of returning text as success", async () => {
    const harness = await connect("ws://127.0.0.1:19999");
    fake.request.mockRejectedValue(new Error("private fixture payload"));
    await expect(harness.call("os.status")).rejects.toThrow(/^CONFORMANCE_RPC_FAILED$/);
    await harness.close();
  });
});
