import { describe, expect, it } from 'vitest';
import { liveScenario } from '../live-scenario.js';

describe('plugin-install-hook', () => {
  for (const id of ['plugin-kernel-healthy', 'plugin-secondary-deny-all', 'plugin-catalog-mutation-allowed', 'plugin-initially-not-installed', 'plugin-primary-denial', 'plugin-primary-no-config-mutation', 'plugin-primary-allows', 'plugin-typed-before-install', 'plugin-exact-staged-material', 'plugin-secondary-denies', 'plugin-block-terminal', 'plugin-secondary-no-config-mutation', 'plugin-not-installed', 'plugin-mints-no-grants']) {
    it(id, () => { expect(liveScenario().checks[id]).toBe(true); });
  }
});
