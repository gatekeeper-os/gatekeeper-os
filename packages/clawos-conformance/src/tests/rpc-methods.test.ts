import { describe, expect, it } from "vitest";
import { connect } from "../harness.js";
import { shouldRun } from "../helpers.js";

describe("rpc-methods", () => {
  const testName = "rpc-methods";
  const run = async () => {
    const harness = await connect(process.env.CLAWOS_GATEWAY_URL, process.env.OPENCLAW_GATEWAY_TOKEN ?? "");
    try {
      const methods = ["os.status", "os.gatekeepers.list", "os.grants.list", "os.approvals.list", "os.audit.query"] as const;
      for (const method of methods) {
        const response = await harness.call(method);
        expect(response).toBeDefined();
      }
    } finally {
      await harness.close();
    }
  };
  if (shouldRun(testName)) it("answers os.* methods over the gateway call path", run);
  else it.skip("answers os.* methods over the gateway call path", () => {});
});
