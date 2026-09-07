// Spins a throwaway cell for local development: OPENCLAW_PROFILE=clawos-dev, port 19100, token auth.
// Uses `openclaw gateway run` (VERIFIED foreground form). Phase 0 deliverable (plan §9 Phase 0 step 2).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const port = Number(process.env.CLAWOS_DEV_PORT ?? 19100);
const token = process.env.OPENCLAW_GATEWAY_TOKEN ?? randomBytes(24).toString("hex");
const env = {
  ...process.env,
  OPENCLAW_PROFILE: "clawos-dev",
  OPENCLAW_GATEWAY_PORT: String(port),
  OPENCLAW_GATEWAY_TOKEN: token,
  OPENCLAW_NO_AUTO_UPDATE: "1",
  CLAWOS_CELL: "dev",
};
console.log(`[dev-gateway] profile=clawos-dev port=${port}`);
const child = spawn("openclaw", ["gateway", "run"], { env, stdio: "inherit" });
const stop = () => { child.kill("SIGTERM"); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
// TODO(phase-0): wait for http://127.0.0.1:${port}/readyz before returning control; print the dashboard URL.
