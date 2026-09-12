// VM-only configuration: production GitHub plugin and its unmodified native fetch.
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tools } from '../../packages/gatekeeper-github/src/tools.ts';
import { validateInput } from './github-real-evidence.mjs';
import { resources } from '../../packages/gatekeeper-github/src/resources.ts';
const state = '/home/tester/.openclaw-kernel-test';
if (process.env.CLAWOS_KERNEL_VM !== '1' || process.env.CLAWOS_TEST_MODE !== 'full' || process.cwd() !== '/home/tester/src' ||
  process.env.OPENCLAW_STATE_DIR !== state || process.env.OPENCLAW_CONFIG_PATH !== state + '/openclaw.json') throw new Error('VM required');
const fd = openSync('/run/user/1000/clawos-phase4-input.json', constants.O_RDONLY | constants.O_NOFOLLOW);
let input;
try {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 16384) throw new Error('Private input required');
  input = JSON.parse(readFileSync(fd, 'utf8'));
} finally { closeSync(fd); }
if (!validateInput(input, process.env.CLAWOS_SCENARIO_RUN)) throw new Error('Invalid real-provider input');
if (!process.env.CLAWOS_TEST_APP_SECRET || /[\r\n]/.test(process.env.CLAWOS_TEST_APP_SECRET)) throw new Error('Private app secret required');
if (process.argv[2] === 'native') {
  const cfg = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
  cfg.logging.file = join(state, 'logs/github-real-native.jsonl');
  cfg.plugins.entries['gatekeeper-github'].config.synchronousActions = ['gk_github_issue_comment'];
  writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(cfg), { mode: 0o600 });
} else {
  await import('./kernel-config.mjs');
  const cfg = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
  mkdirSync(join(state, 'logs'), { recursive: true, mode: 0o700 });
  cfg.logging = { file: join(state, 'logs/github-real-deferred.jsonl'), level: 'info', consoleLevel: 'info' };
  writeFileSync(join(state, 'os/cell.key'), randomBytes(32).toString('base64') + '\n', { flag: 'wx', mode: 0o600 });
  const root = resolve('packages/gatekeeper-github');
  cfg.plugins.allow = ['clawos-kernel', 'gatekeeper-github'];
  cfg.plugins.load.paths = [resolve('packages/clawos-kernel'), root];
  delete cfg.plugins.entries['gatekeeper-fs']; delete cfg.plugins.entries['clawos-kernel-monitor'];
  cfg.plugins.entries['gatekeeper-github'] = { enabled: true, config: {
    clientId: input.oauthClientId, publicOrigin: 'http://127.0.0.1:19100',
    clientSecret: { source: 'env', provider: 'default', id: 'CLAWOS_TEST_APP_SECRET' },
  } };
  writeFileSync(join(state, 'os/gatekeepers.json'), JSON.stringify({ version: 1, gatekeepers: [{ pluginId: 'gatekeeper-github', vendor: 'github', apiVersion: 1, root, tools, resources }] }), { mode: 0o600 });
  writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(cfg), { mode: 0o600 });
}
