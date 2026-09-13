/** Public SDK transport for conformance; credentials and RPC bodies never enter argv or logs. */

/** A connected test client. Credentials intentionally are not exposed on this object. */
export interface Harness {
  readonly url: string;
  call(method: string, params?: unknown): Promise<unknown>;
  close(): Promise<void>;
}

/** Reject implicit destinations and credential-bearing URLs before constructing an SDK client. */
export function gatewayUrl(value: string | undefined): string {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href;
  } catch {
    throw new Error("CONFORMANCE_INVALID_GATEWAY_URL");
  }
}

/** Connect through the SDK-owned device handshake, with bounded startup and sanitized failures. */
export async function connect(
  url = process.env.GKOS_GATEWAY_URL,
  token = process.env.OPENCLAW_GATEWAY_TOKEN,
): Promise<Harness> {
  const destination = gatewayUrl(url);
  // The SDK may persist device identity: require explicit selectors before importing it.
  if (!process.env.OPENCLAW_STATE_DIR || !process.env.OPENCLAW_CONFIG_PATH) {
    throw new Error("CONFORMANCE_EXPLICIT_STATE_REQUIRED");
  }
  const { GatewayClient } = await import("openclaw/plugin-sdk/gateway-runtime");
  let closed = false;
  let client: InstanceType<typeof GatewayClient> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("CONFORMANCE_CONNECT_TIMEOUT")), 30_000);
      client = new GatewayClient({
        url: destination,
        ...(token ? { token } : {}),
        env: process.env,
        clientName: "cli", mode: "cli", role: "operator", scopes: ["operator.admin"],
        requestTimeoutMs: 30_000,
        hostDeps: { logDebug() {}, logError() {} },
        onHelloOk: () => resolve(),
        onConnectError: () => reject(new Error("CONFORMANCE_CONNECT_FAILED")),
        onClose: () => reject(new Error("CONFORMANCE_CONNECT_CLOSED")),
      });
      client.start();
    });
  } catch {
    try { await client?.stopAndWait({ timeoutMs: 5_000 }); } catch { /* original failure remains fatal */ }
    throw new Error("CONFORMANCE_CONNECT_FAILED");
  } finally {
    clearTimeout(timer);
  }
  const connected = client!;
  return {
    url: destination,
    async call(method, params = {}) {
      if (closed) throw new Error("CONFORMANCE_CLIENT_CLOSED");
      if (!/^[a-z][a-zA-Z0-9_.-]*$/.test(method)) throw new Error("CONFORMANCE_INVALID_METHOD");
      try { return await connected.request<unknown>(method, params); }
      catch { throw new Error("CONFORMANCE_RPC_FAILED"); }
    },
    async close() {
      if (closed) return;
      closed = true;
      try { await connected.stopAndWait({ timeoutMs: 5_000 }); }
      catch { throw new Error("CONFORMANCE_CLOSE_FAILED"); }
    },
  };
}
