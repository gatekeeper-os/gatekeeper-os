import { describe, expect, it } from 'vitest';
import { operatorCell } from './cli.js';
describe('mounted CLI cell selection', () => {
  it('honors an upstream named profile when no OS service environment exists', () => {
    expect(operatorCell({ OPENCLAW_PROFILE: 'firma', OPENCLAW_STATE_DIR: '/fixture/.openclaw-firma', OPENCLAW_CONFIG_PATH: '/fixture/.openclaw-firma/openclaw.json' }, '/fixture')).toBe('firma');
  });
  it.each([
    { GKOS_CELL: 'firma', OPENCLAW_PROFILE: 'firmb' },
    { OPENCLAW_STATE_DIR: '/fixture/custom-cell' },
    { GKOS_CELL: 'firma', OPENCLAW_CONFIG_PATH: '/fixture/.openclaw/openclaw.json' },
    { GKOS_CELL: '../other' },
  ])('refuses selector disagreement rather than silently querying a different cell', env => {
    expect(() => operatorCell(env, '/fixture')).toThrow();
  });
});
