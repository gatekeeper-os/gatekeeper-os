// Source plugins and an in-memory provider only; never a production cell.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tools } from '../../packages/gatekeeper-github/src/tools.ts';
import { resources } from '../../packages/gatekeeper-github/src/resources.ts';
if (process.env.CLAWOS_TEST_MODE !== 'gateway-integration') throw new Error('Fixture mode required');
if (process.argv[2] !== 'native') await import('./kernel-config.mjs');
const path = process.env.OPENCLAW_CONFIG_PATH, state = process.env.OPENCLAW_STATE_DIR;
if (process.env.CLAWOS_KERNEL_VM !== '1' || state !== '/home/tester/.openclaw-kernel-test' || path !== state + '/openclaw.json' || process.cwd() !== '/home/tester/src') throw new Error('VM required');
if (process.argv[2] === 'native') {
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  cfg.plugins.entries['gatekeeper-github'].config.synchronousActions = ['gk_github_issue_comment'];
  writeFileSync(path, JSON.stringify(cfg), { mode: 0o600 });
  process.exit(0);
}
const cfg = JSON.parse(readFileSync(path, 'utf8'));
const root = resolve('test/fixtures/github-gateway');
// Retain the production schema; the alternate entry is local test material only.
writeFileSync(join(root, 'openclaw.plugin.json'), readFileSync('packages/gatekeeper-github/openclaw.plugin.json'), { mode: 0o600 });
writeFileSync(join(state, 'os/cell.key'), randomBytes(32).toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
cfg.plugins.allow = ['clawos-kernel', 'gatekeeper-github', 'clawos-kernel-monitor'];
cfg.plugins.load.paths = [resolve('packages/clawos-kernel'), root, resolve('test/fixtures/kernel-monitor')];
delete cfg.plugins.entries['gatekeeper-fs'];
cfg.plugins.entries['gatekeeper-github'] = { enabled: true, config: {
  clientId: 'fixture-client', publicOrigin: 'http://127.0.0.1:19100',
  clientSecret: { source: 'env', provider: 'default', id: 'CLAWOS_TEST_APP_SECRET' },
}};
writeFileSync(join(state, 'os/gatekeepers.json'), JSON.stringify({ version: 1, gatekeepers: [{
  pluginId: 'gatekeeper-github', vendor: 'github', apiVersion: 1, root, tools, resources,
}] }), { mode: 0o600 });
writeFileSync(path, JSON.stringify(cfg), { mode: 0o600 });
