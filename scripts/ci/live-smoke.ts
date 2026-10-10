/**
 * Compatibility smoke in a fresh hosted VM; no model credentials or phase-acceptance claims.
 * A local deterministic stub model drives one granted filesystem tool call through the kernel, because
 * health checks alone stayed green on 2026.9.6 while every agent-side gatekeeper call failed closed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
// The fs gatekeeper refuses resources inside upstream state, so the fixture root sits beside it.
const resource = join(temporary, 'gkos-resource');
for (const path of [resource, join(state, 'workspace'), join(state, 'os')]) mkdirSync(path, { recursive: true, mode: 0o700 });
writeFileSync(join(resource, 'smoke-fixture.txt'), 'fixture\n', { mode: 0o600 });
writeFileSync(join(state, 'os/gatekeepers.json'), JSON.stringify({ version: 1, gatekeepers: [{
  pluginId: 'gkos-gatekeeper-fs', vendor: 'fs', apiVersion: 1, root: resolve('packages/gkos-gatekeeper-fs'),
  tools: fsTools, resources: fsResources,
}] }), { mode: 0o600 });
const token = randomBytes(32).toString('hex');
writeFileSync(configPath, JSON.stringify({
  gateway: { mode: 'local', bind: 'loopback', port: 19100, auth: { mode: 'token', token } },
  update: { auto: { enabled: false } },
  models: { providers: { smoke: { baseUrl: 'http://127.0.0.1:19101/v1', api: 'openai-completions', apiKey: randomBytes(16).toString('hex'),
    models: [{ id: 'smoke', name: 'Deterministic smoke model', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 }] } } },
  agents: { defaults: { workspace: join(state, 'workspace'), model: { primary: 'smoke/smoke' } }, list: [{ id: 'main', default: true }] },
  tools: { profile: 'full' },
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
function rpc(method: string, params: Record<string, unknown> = {}): unknown {
  const result = spawnSync(process.execPath, ['packages/gkos-cli/bin/gateway-rpc.mjs', binary.stdout.trim()], {
    env: { ...process.env, OPENCLAW_GATEWAY_PORT: '19100' },
    input: JSON.stringify({ method, params }), encoding: 'utf8', timeout: 85000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw new Error('KERNEL_RPC_FAILED');
  const reply = JSON.parse(result.stdout);
  if (reply.ok !== true || !Object.hasOwn(reply, 'result')) throw new Error('KERNEL_RPC_INVALID');
  return reply.result;
}
// One scripted tool call per turn. Tool results are inspected in memory only; nothing is logged.
type Turn = { tool: string; params: Record<string, unknown>; offered: boolean; called: boolean; results: string[] };
let current: Turn | undefined;
const model = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 4_000_000) throw new Error(); }
    const input = JSON.parse(raw), messages: Array<{ role: string; content?: unknown }> = input.messages ?? [];
    // 2026.9.9 appends an internal-context user message after tool results; it is not a new user turn.
    const lastUser = messages.findLastIndex(m => m.role === 'user' && !JSON.stringify(m.content ?? '').includes('<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>'));
    const results = messages.slice(lastUser + 1).filter(m => m.role === 'tool');
    const offered = (input.tools ?? []).some((t: { function?: { name?: string }; name?: string }) => (t.function?.name ?? t.name) === current?.tool);
    if (current && !current.called) current.offered ||= offered;
    for (const r of results) current?.results.push(typeof r.content === 'string' ? r.content : JSON.stringify(r.content));
    const call = !!current && offered && !current.called && results.length === 0;
    if (call) current!.called = true;
    const id = `smoke-${randomUUID()}`, created = Math.floor(Date.now() / 1000);
    const toolCall = { id, type: 'function', function: { name: current?.tool, arguments: JSON.stringify(current?.params ?? {}) } };
    if (input.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, ...toolCall }] } : { role: 'assistant', content: 'smoke-complete' };
      for (const part of [{ delta, finish_reason: null }, { delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }])
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'smoke', choices: [{ index: 0, ...part }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    } else {
      const message = call ? { role: 'assistant', content: null, tool_calls: [toolCall] } : { role: 'assistant', content: 'smoke-complete' };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, object: 'chat.completion', created, model: 'smoke', choices: [{ index: 0, message, finish_reason: call ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }
  } catch { res.writeHead(400); res.end('{}'); }
});
type Client = { start(): void; stopAndWait(o: { timeoutMs: number }): Promise<void>; request(method: string, params: unknown, opts?: unknown): Promise<any> };
let operator: Client | undefined;
async function connect(credentials: Record<string, string>): Promise<{ client: Client; deviceToken?: string }> {
  const require = createRequire(realpathSync(binary.stdout.trim()));
  const { GatewayClient } = await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
  let client: Client | undefined, timer: NodeJS.Timeout | undefined;
  try {
    const hello: { auth?: { deviceToken?: string } } = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error()), 30000);
      client = new GatewayClient({ url: 'ws://127.0.0.1:19100', ...credentials, env: process.env, clientName: 'cli', mode: 'cli', role: 'operator',
        scopes: ['operator.admin'], requestTimeoutMs: 120000, hostDeps: { logDebug() {}, logError() {} }, onHelloOk: resolve, onConnectError: () => reject(new Error()) });
      client!.start();
    });
    return { client: client!, deviceToken: hello.auth?.deviceToken };
  } catch (error) { await client?.stopAndWait({ timeoutMs: 5000 }).catch(() => {}); throw error; } finally { clearTimeout(timer); }
}
async function turn(id: string, tool: string, params: Record<string, unknown>): Promise<Turn> {
  current = { tool, params, offered: false, called: false, results: [] };
  const accepted = await operator!.request('agent', { agentId: 'main', sessionKey: `agent:main:smoke-${id}`, message: 'Run the smoke operation once.',
    idempotencyKey: randomUUID() }, { expectFinal: true, timeoutMs: 120000 });
  // 2026.9.9 acknowledges `agent` before the run settles; earlier releases return a cached snapshot here.
  if (accepted?.runId && (await operator!.request('agent.wait', { runId: accepted.runId, timeoutMs: 115000 }, { timeoutMs: 120000 }))?.status === 'timeout') throw new Error();
  const done = current; current = undefined;
  return done;
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
  stage = 'operator-grant';
  const grant = rpc('os.grants.introduce', { agentId: 'main', url: pathToFileURL(resource + '/').href }) as { handle?: string; status?: string };
  check(stage, grant.status === 'active' && /^grant:[a-z0-9]{8}$/.test(grant.handle ?? ''));
  stage = 'stub-model-listening';
  await new Promise<void>((resolve, reject) => { model.once('error', reject); model.listen(19101, '127.0.0.1', resolve); });
  check(stage, true);
  stage = 'paired-operator-client';
  const shared = await connect({ token });
  await shared.client.stopAndWait({ timeoutMs: 5000 });
  if (!shared.deviceToken) throw new Error(stage);
  operator = (await connect({ deviceToken: shared.deviceToken })).client;
  check(stage, true);
  stage = 'granted-tool-offered-directly';
  const listed = await turn('list', 'gk_fs_dir_list', { grant: grant.handle });
  check(stage, listed.offered && listed.called);
  stage = 'granted-tool-executed-by-kernel';
  check(stage, listed.results.length === 1 && listed.results[0].includes('smoke-fixture.txt'));
  stage = 'granted-tool-audited';
  const audit = rpc('os.audit.query', { limit: 50 }) as Array<{ kind?: string; handle?: string; ok?: boolean; title?: string }>;
  check(stage, audit.filter(row => row.kind === 'tool' && row.handle === grant.handle && row.ok === true && row.title === 'gk_fs_dir_list').length === 1);
  stage = 'unknown-grant-denied';
  const bogus = await turn('bogus', 'gk_fs_dir_list', { grant: 'grant:zzzzzzzz' });
  check(stage, bogus.called && bogus.results.length === 1 && !bogus.results[0].includes('smoke-fixture.txt'));
  writeFileSync('verdict-smoke.json', JSON.stringify({ ok: true, checks, fullConformance: false }) + '\n');
} catch {
  writeFileSync('verdict-smoke.json', JSON.stringify({ ok: false, checks, failedStage: stage, fullConformance: false }) + '\n');
  console.error(`COMPATIBILITY_SMOKE_FAILED: ${stage}`);
  process.exitCode = 1;
} finally {
  await operator?.stopAndWait({ timeoutMs: 5000 }).catch(() => {});
  model.close();
  if (gateway?.pid && gateway.exitCode === null && gateway.signalCode === null) {
    const stopped = new Promise<void>(resolve => gateway!.once('exit', () => resolve()));
    gateway.kill('SIGTERM');
    const timer = setTimeout(() => gateway!.kill('SIGKILL'), 10000);
    await stopped;
    clearTimeout(timer);
  }
}
