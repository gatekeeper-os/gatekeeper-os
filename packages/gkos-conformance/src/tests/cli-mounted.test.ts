import { describe, expect, it } from 'vitest';
import { liveScenario } from '../live-scenario.js';

describe('cli-mounted', () => {
  for (const id of ['cli-kernel-status', 'cli-upstream-mounted', 'cli-grant-add', 'cli-grant-list', 'cli-grant-revoke', 'cli-audit-tail', 'cli-wrong-cell-denied', 'cli-invalid-input-denied']) {
    it(id, () => { expect(liveScenario().checks[id]).toBe(true); });
  }
});
