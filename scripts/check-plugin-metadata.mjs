// Validate ordinary-plugin metadata using the public snapshot inspector, without loading entries.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const inVm = userInfo().username === 'tester' && /ID=ubuntu\b/.test(readFileSync('/etc/os-release', 'utf8'));
if (!inVm && process.env.GITHUB_ACTIONS !== 'true') throw new Error('Plugin CLI validation runs only in the test VM or GitHub Actions');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = process.argv.length > 2 ? process.argv.slice(2).map(root => resolve(root)) :
  readdirSync(join(repo, 'packages')).map(name => join(repo, 'packages', name)).filter(root => existsSync(join(root, 'openclaw.plugin.json')));
const packages = roots.map(root => {
  const manifest = JSON.parse(readFileSync(join(root, 'openclaw.plugin.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof manifest.id !== 'string' || !manifest.id || !pkg.openclaw?.extensions?.length) throw new Error('Missing plugin id or extension declaration');
  for (const entry of pkg.openclaw.extensions) {
    const local = relative(realpathSync(root), realpathSync(resolve(root, entry)));
    if (isAbsolute(local) || local === '..' || local.startsWith('../')) throw new Error('Plugin entry escapes package root');
  }
  return { root: realpathSync(root), id: manifest.id };
});
if (!packages.length || new Set(packages.map(item => item.id)).size !== packages.length) throw new Error('Empty or duplicate plugin ids');
const state = realpathSync(mkdtempSync(join(tmpdir(), 'gkos-metadata-')));
const configPath = join(state, 'openclaw.json');
for (const protectedRoot of ['.openclaw', '.openclaw-prod'].map(name => resolve(homedir(), name))) {
  if ([state, configPath].some(path => path === protectedRoot || path.startsWith(protectedRoot + '/'))) throw new Error('Production state prohibited');
}
mkdirSync(join(state, 'workspace'), { mode: 0o700 });
writeFileSync(configPath, JSON.stringify({
  gateway: { mode: 'local' }, update: { auto: { enabled: false } },
  agents: { defaults: { workspace: join(state, 'workspace') } },
  plugins: { allow: packages.map(item => item.id), load: { paths: packages.map(item => item.root) },
    entries: Object.fromEntries(packages.map(item => [item.id, { enabled: false }])) },
}), { mode: 0o600 });
const env = { ...process.env, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_NO_AUTO_UPDATE: '1' };
for (const name of ['OPENCLAW_PROFILE', 'OPENCLAW_GATEWAY_TOKEN', 'OPENCLAW_GATEWAY_PASSWORD', 'OPENCLAW_GATEWAY_URL']) delete env[name];
const run = spawnSync('openclaw', ['plugins', 'inspect', '--all', '--json'], { env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
if (run.status !== 0) throw new Error(`Plugin snapshot inspection failed (exit=${run.status}, error=${run.error?.code ?? 'none'}; raw output withheld)`);
const reports = JSON.parse(run.stdout);
const summary = packages.map(item => {
  const report = reports.find(row => row.plugin.id === item.id && realpathSync(row.plugin.rootDir) === item.root);
  const ok = Boolean(report && report.plugin.status === 'disabled' && report.plugin.configSchema &&
    !report.diagnostics.some(row => row.level === 'error') && report.typedHooks.length === 0 && report.tools.length === 0);
  return { id: item.id, ok, scope: 'manifest-only; runtime conformance is a separate gate' };
});
console.log(JSON.stringify(summary, null, 2));
if (summary.some(row => !row.ok)) process.exitCode = 1;
