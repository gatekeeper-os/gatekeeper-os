/** Read-only compatibility smoke in a fresh hosted VM; no model credentials or phase-acceptance claims. */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fsResources } from '../../packages/gkos-gatekeeper-fs/src/resources.js';
import { fsTools } from '../../packages/gkos-gatekeeper-fs/src/tools.js';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    process.env.RUNNER_OS !== 'Linux' || !process.env.RUNNER_TEMP) throw new Error('DISPOSABLE_HOSTED_VM_REQUIRED');
const state = realpathSync(process.env.OPENCLAW_STATE_DIR!);
const configPath = resolve(process.env.OPENCLAW_CONFIG_PATH!);
const temporary = realpathSync(process.env.RUNNER_TEMP);
if (!state.startsWith(temporary + '/') || configPath !== join(state, 'openclaw.json')) throw new Error('EXPLICIT_TEMP_STATE_REQUIRED');
for (const root of ['.openclaw', '.openclaw-prod'].map(name => resolve(homedir(), name))) {
  if (state === root || state.startsWith(root + '/')) throw new Error('PRODUCTION_STATE_PROHIBITED');
}
for (const key of ['OPENCLAW_PROFILE', 'OPENCLAW_GATEWAY_TOKEN', 'OPENCLAW_GATEWAY_PASSWORD', 'OPENCLAW_GATEWAY_URL']) delete process.env[key];
const checks: string[] = [];
function check(name: string, ok: boolean) { if (!ok) throw new Error(name); checks.push(name); }
const resource = join(state, 'resource');
for (const path of [resource, join(state, 'workspace'), join(state, 'os')]) mkdirSync(path, { recursive: true, mode: 0o700 });
writeFileSync(join(state, 'os/gatekeepers.json'), JSON.stringify({ version: 1, gatekeepers: [{
  pluginId: 'gkos-gatekeeper-fs', vendor: 'fs', apiVersion: 1, root: resolve('packages/gkos-gatekeeper-fs'),
  tools: fsTools, resources: fsResources,
}] }), { mode: 0o600 });
const token = randomBytes(32).toString('hex');
writeFileSync(configPath, JSON.stringify({
  gateway: { mode: 'local', bind: 'loopback', port: 19100, auth: { mode: 'token', token } },
  update: { auto: { enabled: false } }, agents: { defaults: { workspace: join(state, 'workspace') } },
  plugins: { allow: ['gkos-kernel', 'gkos-gatekeeper-fs'],
    load: { paths: ['packages/gkos-kernel', 'packages/gkos-gatekeeper-fs'].map(path => resolve(path)) },
    entries: {
      'gkos-kernel': { enabled: true, hooks: { allowConversationAccess: true }, config: { operators: [], install: { allowSources: [] } } },
      'gkos-gatekeeper-fs': { enabled: true, config: { roots: [resource] } },
    },
  },
}), { mode: 0o600 });
let gateway: ReturnType<typeof spawn> | undefined;
// Reuse the operator client's existing two-stage device pairing and target-installed SDK.
// The shared bootstrap token alone intentionally cannot authorize kernel RPCs.
const binary = spawnSync('sh', ['-c', 'command -v openclaw'], { encoding: 'utf8' });
if (binary.status !== 0) throw new Error('UPSTREAM_BINARY_REQUIRED');
function rpc(method: string): unknown {
  const result = spawnSync(process.execPath, ['packages/gkos-cli/bin/gateway-rpc.mjs', binary.stdout.trim()], {
    env: { ...process.env, OPENCLAW_GATEWAY_PORT: '19100' },
    input: JSON.stringify({ method, params: {} }), encoding: 'utf8', timeout: 85000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw new Error('KERNEL_RPC_FAILED');
  const reply = JSON.parse(result.stdout);
  if (reply.ok !== true || !Object.hasOwn(reply, 'result')) throw new Error('KERNEL_RPC_INVALID');
  return reply.result;
}
let stage = 'config-validation';
try {
  const validated = spawnSync('openclaw', ['config', 'validate'], { stdio: 'ignore', timeout: 120000 });
  check(stage, validated.status === 0);
  stage = 'gateway-startup';
  gateway = spawn('openclaw', ['gateway', 'run'], { stdio: 'ignore' });
  let spawnFailed = false;
  gateway.on('error', () => { spawnFailed = true; });
  const deadline = Date.now() + 120000;
  while (true) {
    if (spawnFailed || gateway.exitCode !== null || gateway.signalCode !== null) throw new Error(stage);
    try {
      const response = await fetch('http://127.0.0.1:19100/readyz', { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch { /* bounded startup retry */ }
    if (Date.now() >= deadline) throw new Error(stage);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  for (const endpoint of ['healthz', 'startupz', 'readyz']) {
    stage = endpoint;
    check(stage, (await fetch(`http://127.0.0.1:19100/${endpoint}`, { signal: AbortSignal.timeout(5000) })).ok);
  }
  stage = 'authenticated-kernel-rpc';
  const status = rpc('os.status') as { healthy?: boolean; gatekeepers?: Array<{ vendor: string; healthy: boolean }> };
  check(stage, status.healthy === true);
  stage = 'filesystem-driver-healthy';
  check(stage, status.gatekeepers?.some(row => row.vendor === 'fs' && row.healthy) === true);
  stage = 'zero-initial-grants';
  const grants = rpc('os.grants.list');
  check(stage, Array.isArray(grants) && grants.length === 0);
  stage = 'empty-approval-queues';
  const approvals = rpc('os.approvals.list') as { actions?: unknown[]; requests?: unknown[] };
  check(stage, approvals.actions?.length === 0 && approvals.requests?.length === 0);
  writeFileSync('verdict-smoke.json', JSON.stringify({ ok: true, checks, fullConformance: false }) + '\n');
} catch {
  writeFileSync('verdict-smoke.json', JSON.stringify({ ok: false, checks, failedStage: stage, fullConformance: false }) + '\n');
  console.error(`COMPATIBILITY_SMOKE_FAILED: ${stage}`);
  process.exitCode = 1;
} finally {
  if (gateway?.pid && gateway.exitCode === null && gateway.signalCode === null) {
    const stopped = new Promise<void>(resolve => gateway!.once('exit', () => resolve()));
    gateway.kill('SIGTERM');
    const timer = setTimeout(() => gateway!.kill('SIGKILL'), 10000);
    await stopped;
    clearTimeout(timer);
  }
}
