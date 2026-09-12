import { describe, expect, it } from "vitest";
import { GITHUB_DEFERRED_REQUIRED_CHECKS, githubScenario } from "../github-scenario.js";

describe("deferred-approval", () => {
  for (const check of GITHUB_DEFERRED_REQUIRED_CHECKS) {
    it(check, () => { expect(githubScenario(GITHUB_DEFERRED_REQUIRED_CHECKS).checks[check]).toBe(true); });
  }
});
