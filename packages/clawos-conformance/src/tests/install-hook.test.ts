import { describe, expect, it } from 'vitest';
import { liveScenario } from '../live-scenario.js';

describe('install-hook', () => {
  for (const id of ['deny-kernel-healthy', 'upload-opt-in-isolated', 'read-scope-cannot-upload', 'archive-committed-not-installed', 'primary-denies-before-hook', 'primary-allows-before-secondary', 'secondary-sees-typed-material', 'secondary-denies-unlisted-upload', 'secondary-block-terminal', 'allow-kernel-healthy', 'secondary-exact-operator-rule', 'both-boundaries-allow', 'installed-fixture-exact', 'install-mints-no-grants', 'consumed-upload-cannot-replay']) {
    it(id, () => { expect(liveScenario().checks[id]).toBe(true); });
  }
});
