import { describe, expect, it } from "vitest";
import { liveScenario } from "../live-scenario.js";

describe('gate-blocks', () => {
  it('shared-auth-introduction-denied', () => { expect(liveScenario().checks['shared-auth-introduction-denied']).toBe(true); });
  it('forged-identity-denied', () => { expect(liveScenario().checks['forged-identity-denied']).toBe(true); });
  it('unknown-grant-denied', () => { expect(liveScenario().checks['unknown-grant-denied']).toBe(true); });
  it('unknown-policy-audited', () => { expect(liveScenario().checks['unknown-policy-audited']).toBe(true); });
  it('disabled-hooks-tools-visible', () => { expect(liveScenario().checks['disabled-hooks-tools-visible']).toBe(true); });
  it('disabled-hooks-policy-denied', () => { expect(liveScenario().checks['disabled-hooks-policy-denied']).toBe(true); });
  it('disabled-hooks-policy-audited', () => { expect(liveScenario().checks['disabled-hooks-policy-audited']).toBe(true); });
});
