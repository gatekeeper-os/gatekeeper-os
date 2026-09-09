import { describe, expect, it } from "vitest";
import { liveScenario } from "../live-scenario.js";

describe('fs-gatekeeper', () => {
  it('operator-introduced', () => { expect(liveScenario().checks['operator-introduced']).toBe(true); });
  it('directory-list-succeeded', () => { expect(liveScenario().checks['directory-list-succeeded']).toBe(true); });
  it('file-read-succeeded', () => { expect(liveScenario().checks['file-read-succeeded']).toBe(true); });
  it('outside-introduction-denied', () => { expect(liveScenario().checks['outside-introduction-denied']).toBe(true); });
  it('path-escape-denied', () => { expect(liveScenario().checks['path-escape-denied']).toBe(true); });
  it('grant-revoked', () => { expect(liveScenario().checks['grant-revoked']).toBe(true); });
  it('revocation-audited', () => { expect(liveScenario().checks['revocation-audited']).toBe(true); });
});
