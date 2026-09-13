import { describe, expect, it } from 'vitest';
import { liveScenario } from '../live-scenario.js';

describe('plugin-loads', () => {
  for (const id of ['plugin-loaded-gkos-kernel', 'plugin-loaded-gkos-gatekeeper-fs']) {
    it(id, () => { expect(liveScenario().checks[id]).toBe(true); });
  }
});
