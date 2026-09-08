/** Disposable-VM-only smoke test of the real public SDK transport. No payloads are retained. */
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { connect } from "../../packages/clawos-conformance/src/harness.js";

const findings = { connected: false, parameterizedRpc: false, wrongEndpointDenied: false, rpcFailureDenied: false };
try {
  if (process.env.HOME !== "/home/tester" || process.cwd() !== "/home/tester/src" ||
      process.env.OPENCLAW_STATE_DIR !== "/home/tester/.openclaw" ||
      process.env.OPENCLAW_CONFIG_PATH !== "/home/tester/.openclaw/openclaw.json" ||
      process.env.CLAWOS_GATEWAY_URL !== "ws://127.0.0.1:18789") throw new Error();
  const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, "utf8"));
  const ref = config.gateway?.auth?.token;
  if (ref?.source !== "env" || ref?.id !== "CLAWOS_GATEWAY_TOKEN") throw new Error();
  const token = parseEnv(readFileSync("/home/tester/.openclaw/.env", "utf8"))[ref.id];
  if (!token) throw new Error();
  const client = await connect(process.env.CLAWOS_GATEWAY_URL, token);
  try {
    const health = await client.call("health");
    if (!health || typeof health !== "object" || !("ok" in health) || health.ok !== true) throw new Error();
    findings.connected = true;
    const sessions = await client.call("sessions.list", { limit: 1 });
    if (!sessions || typeof sessions !== "object" || !("sessions" in sessions) || !Array.isArray(sessions.sessions)) throw new Error();
    findings.parameterizedRpc = true;
    try { await client.call("conformance.nonexistent"); }
    catch (error) { findings.rpcFailureDenied = error instanceof Error && error.message === "CONFORMANCE_RPC_FAILED"; }
    let wrongClient;
    try { wrongClient = await connect("ws://127.0.0.1:1", token); }
    catch { findings.wrongEndpointDenied = true; }
    finally { await wrongClient?.close(); }
  } finally { await client.close(); }
  if (!Object.values(findings).every(Boolean)) throw new Error();
  console.log("PASS public-sdk-transport");
} catch {
  console.error("FAIL public-sdk-transport");
  process.exitCode = 1;
} finally {
  writeFileSync(process.argv[2]!, JSON.stringify(findings, null, 2) + "\n", { mode: 0o600 });
}
