import { describe, expect, it } from "vitest";
import { liveScenario } from "../live-scenario.js";

describe('tool-narrowing', () => {
  it('no-grant-narrowing', () => { expect(liveScenario().checks['no-grant-narrowing']).toBe(true); });
  it('valid-grant-narrowing', () => { expect(liveScenario().checks['valid-grant-narrowing']).toBe(true); });
  it('untrusted-url-no-grant', () => { expect(liveScenario().checks['untrusted-url-no-grant']).toBe(true); });
  it('untrusted-url-narrowing', () => { expect(liveScenario().checks['untrusted-url-narrowing']).toBe(true); });
  it('revoked-tool-absent', () => { expect(liveScenario().checks['revoked-tool-absent']).toBe(true); });
});
