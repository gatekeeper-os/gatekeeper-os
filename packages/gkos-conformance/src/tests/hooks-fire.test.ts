import { describe, expect, it } from "vitest";
import { liveScenario } from "../live-scenario.js";

describe('hooks-fire', () => {
  it('hook-call-correlation', () => { expect(liveScenario().checks['hook-call-correlation']).toBe(true); });
  it('lifecycle-hooks-fired', () => { expect(liveScenario().checks['lifecycle-hooks-fired']).toBe(true); });
  it('successful-call-audited', () => { expect(liveScenario().checks['successful-call-audited']).toBe(true); });
  it('observation-audited', () => { expect(liveScenario().checks['observation-audited']).toBe(true); });
});
