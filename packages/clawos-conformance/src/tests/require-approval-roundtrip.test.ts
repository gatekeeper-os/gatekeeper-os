import { describe, expect, it } from "vitest";
import { GITHUB_APPROVAL_REQUIRED_CHECKS, githubScenario } from "../github-scenario.js";

// Plan §8.3 requires an awaitDecision action and native approval prompt/resolution.
// A deferred os.approvals.apply call does not prove this synchronous path.
describe("require-approval-roundtrip", () => {
  for (const check of GITHUB_APPROVAL_REQUIRED_CHECKS) {
    it(check, () => { expect(githubScenario(GITHUB_APPROVAL_REQUIRED_CHECKS).checks[check]).toBe(true); });
  }
});
