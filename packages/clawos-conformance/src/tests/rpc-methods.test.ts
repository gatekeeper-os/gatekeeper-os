import { describe, expect, it } from 'vitest';
import { liveScenario } from '../live-scenario.js';

describe('rpc-methods', () => {
  for (const id of ['rpc-status', 'rpc-gatekeepers', 'rpc-grants', 'rpc-approvals', 'rpc-audit']) {
    it(id, () => { expect(liveScenario().checks[id]).toBe(true); });
  }
});
