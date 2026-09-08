import { describe, expect, it } from "vitest";
import { gatewayUrl } from "../harness.js";
import { shouldRun } from "../helpers.js";

describe("health", () => {
  const testName = "health";
  const run = async () => {
    const base = new URL(gatewayUrl(process.env.CLAWOS_GATEWAY_URL));
    base.protocol = base.protocol === "wss:" ? "https:" : "http:";
    for (const path of ["healthz", "startupz", "readyz"]) {
      const response = await fetch(new URL(path, base), { method: "GET", signal: AbortSignal.timeout(5000) });
      expect(response.ok).toBe(true);
    }
  };
  if (shouldRun(testName)) it("probes health endpoints", run);
  else it.skip("probes health endpoints", () => {});
});
