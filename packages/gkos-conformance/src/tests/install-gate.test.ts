import { describe, expect, it } from 'vitest';
import { liveScenario } from '../live-scenario.js';

describe('install-gate', () => {
  for (const id of ['primary-policy-enabled', 'real-cli-blocks-unlisted-source', 'real-cli-allows-reviewed-source', 'forged-labels', 'invalid-protocol', 'malformed-json', 'unavailable-policy-fails-closed', 'policy-restored']) {
    it(id, () => { expect(liveScenario().checks[id]).toBe(true); });
  }
});
