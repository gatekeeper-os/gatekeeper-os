// Run in a child so SDK state lookup inherits only the isolated cell environment.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resourceUrl, toolName } from './packed-fixture/metadata.mjs';
const require = createRequire(process.argv[2]);
const { GatewayClient } = await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
const clients = [];
const result = { modelTurns: 0, providerRequests: 0, noGrantTools: false, grantedTools: false, fixtureApprovalApply: false, fixtureApprovalReject: false, revokedTools: false, nativeDenied: true, registrantIndependentBackstop: false, turns: [] };
result.toolsPolicy = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8')).tools;
let current, stage = 'model-listen';
const model = createServer(async (req, res) => {
  try {
    if (req.method !== 'POST' || !current) throw new Error('unexpected-request');
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 2000000) throw new Error('request-too-large'); }
    const input = JSON.parse(raw), names = (input.tools ?? []).map(tool => tool.function?.name ?? tool.name);
    current.names.push(names); result.providerRequests++;
    // Only tool identities and booleans leave this loop; no prompts or result bodies.
    const toolMessages = (input.messages ?? []).filter(message => message.role === 'tool');
    current.toolResult ||= toolMessages.length > 0;
    current.denial ||= toolMessages.some(message => /not found|denied|unavailable/i.test(JSON.stringify(message.content)));
    const call = current.names.length === 1;
    const toolCall = { id: 'packed-call-' + current.id, type: 'function', function: { name: current.tool, arguments: JSON.stringify(current.params) } };
    const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, ...toolCall }] } : { role: 'assistant', content: 'packed-check-complete' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const part of [{ delta, finish_reason: null }, { delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }]) {
      res.write('data: ' + JSON.stringify({ id: 'packed-check', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'spike', choices: [{ index: 0, ...part }] }) + '\n\n');
    }
    res.end('data: [DONE]\n\n');
  } catch { res.writeHead(400); res.end('{}'); }
});
function assert(condition, code) { if (!condition) throw new Error('Packed model gate: ' + code); }
async function turn(client, id, tool = 'os_list_grants', params = {}) {
  stage = 'turn-' + id;
  current = { id, names: [], toolResult: false, denial: false, tool, params };
  await client.request('agent', { agentId: 'main', sessionKey: 'agent:main:packed-' + id, message: 'Run the test operation once.', idempotencyKey: randomUUID() }, { expectFinal: true, timeoutMs: 120000 });
  result.modelTurns++;
  const { params: _privateParams, ...row } = current; current = undefined; result.turns.push(row);
  assert(row.names.length > 0, 'model-not-used');
  const denied = ['exec', 'process', 'code_execution', 'read', 'write', 'edit', 'apply_patch', 'browser', 'cron', 'gateway', 'terminal'];
  result.nativeDenied &&= row.names.every(names => !names.some(name => denied.includes(name)));
  assert(result.nativeDenied, 'native-tools-exposed');
  return row;
}
const effects = () => {
  const path = join(process.env.OPENCLAW_STATE_DIR, 'packed-fixture-effects.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
};
async function connect(auth) {
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Packed probe connection timeout')), 30000);
      const client = new GatewayClient({ url: process.argv[3], ...auth, env: process.env,
        clientName: 'cli', mode: 'cli', role: 'operator', scopes: ['operator.admin'], requestTimeoutMs: 30000,
        hostDeps: { logDebug() {}, logError() {} },
        onHelloOk: hello => resolve({ client, deviceToken: hello.auth?.deviceToken }),
        onConnectError: () => reject(new Error('Packed probe connection failed')) });
      clients.push(client); client.start();
    });
  } finally { clearTimeout(timer); }
}
try {
  await new Promise((done, fail) => { model.once('error', fail); model.listen(Number(process.argv[4]), '127.0.0.1', done); });
  stage = 'shared-connect';
  const shared = await connect({ token: process.env.OPENCLAW_GATEWAY_TOKEN });
  if (!shared.deviceToken) throw new Error('Packed probe did not receive device authentication');
  stage = 'paired-connect';
  const paired = await connect({ deviceToken: shared.deviceToken });
  stage = 'status';
  const status = await paired.client.request('os.status', {});
  assert(status.gatekeepers.some(item => item.vendor === 'fs' && item.healthy), 'filesystem-not-ready');
  assert(status.gatekeepers.some(item => item.vendor === 'fixture' && item.healthy), 'fixture-not-ready');
  stage = 'initial-grants';
  assert((await paired.client.request('os.grants.list', { agentId: 'main' })).length === 0, 'initial-grant-present');
  stage = 'registrant-independent-backstop';
  const beforePolicy = (await paired.client.request('os.audit.query', {limit:1000})).filter(item => item.title === 'Capability policy denied call').length;
  const backstop = await paired.client.request('packed.backstop', {});
  const afterPolicy = (await paired.client.request('os.audit.query', {limit:1000})).filter(item => item.title === 'Capability policy denied call').length;
  result.registrantIndependentBackstop = backstop.registeredBy === 'gkos-gatekeeper-fixture' && backstop.normalDenied && backstop.bypassDenied && backstop.controlExecutions === 1 && backstop.unsafeExecutions === 0 && afterPolicy - beforePolicy === 2;
  assert(result.registrantIndependentBackstop, 'registrant-independent-backstop');
  const empty = await turn(paired.client, 'no-grant');
  result.noGrantTools = empty.names.every(names => ['os_list_grants', 'os_request_access'].every(name => names.includes(name)) && !names.some(name => name.startsWith('gk_')));
  assert(result.noGrantTools, 'no-grant-os-tools');
  assert(empty.toolResult, 'no-grant-tool-result');
  stage = 'introduce-grant';
  const grant = await paired.client.request('os.grants.introduce', { agentId: 'main', url: pathToFileURL(process.argv[5] + '/').href });
  assert(grant.status === 'active' && grant.audience === 'owner-only', 'grant-not-active');
  const granted = await turn(paired.client, 'granted');
  result.grantedTools = granted.names.every(names => ['os_list_grants', 'os_request_access', 'gk_fs_dir_list', 'gk_fs_file_read', 'gk_fs_file_write'].every(name => names.includes(name)));
  assert(result.grantedTools, 'granted-filesystem-tools');
  assert(granted.toolResult, 'granted-tool-result');
  assert(granted.names.every(names => !names.includes(toolName)), 'ungranted-fixture-exposed');
  stage = 'introduce-fixture';
  const fixtureGrant = await paired.client.request('os.grants.introduce', { agentId: 'main', url: resourceUrl });
  assert(fixtureGrant.status === 'active' && fixtureGrant.audience === 'owner-only', 'fixture-grant-not-active');
  for (const decision of ['apply', 'reject']) {
    const row = await turn(paired.client, 'fixture-' + decision, toolName, { grant: fixtureGrant.handle });
    assert(row.names.every(names => names.includes(toolName) && names.includes('os_list_grants')), 'fixture-tool-not-visible');
    assert(row.toolResult && !row.denial, 'fixture-tool-execution');
    stage = 'fixture-' + decision;
    const pending = (await paired.client.request('os.approvals.list', {})).actions;
    assert(pending.length === 1 && pending[0].status === 'pending', 'fixture-pending-action');
    const before = effects();
    assert(before.filter(item => item.kind === decision).length === 0, 'fixture-premature-effect');
    const response = await paired.client.request('os.approvals.' + decision, { ids: [pending[0].id] });
    assert(response.ids[0] === pending[0].id, 'fixture-decision-response');
    assert(effects().filter(item => item.kind === decision).length === 1, 'fixture-decision-effect');
    assert((await paired.client.request('os.approvals.list', {})).actions.length === 0, 'fixture-pending-not-cleared');
    assert((await paired.client.request('os.audit.query', { limit: 1000 })).some(item => item.kind === 'action.decide' && item.actionId === pending[0].id && item.decision === decision && item.ok), 'fixture-decision-audit');
    result[decision === 'apply' ? 'fixtureApprovalApply' : 'fixtureApprovalReject'] = true;
  }
  stage = 'revoke-fixture';
  await paired.client.request('os.grants.revoke', { handle: fixtureGrant.handle });
  const revoked = await turn(paired.client, 'fixture-revoked');
  result.revokedTools = revoked.names.every(names => !names.includes(toolName) && names.includes('gk_fs_file_read') && names.includes('os_list_grants'));
  assert(result.revokedTools, 'revoked-fixture-exposed');
  assert(revoked.toolResult && !revoked.denial, 'revoked-turn-result');
  // Only structural evidence leaves the probe. Never print tokens or RPC payloads.
  Object.assign(result, { healthy: status.healthy === true, kernelVersion: status.kernelVersion });
  console.log(JSON.stringify(result));
} catch (error) {
  result.failure = /^Packed model gate: [a-z-]+$/.test(error.message) ? error.message : 'Packed model gate: ' + stage;
  result.failureStage = stage;
  if (/^[A-Z_]+$/.test(String(error.code))) result.rpcErrorCode = error.code;
  console.error(result.failure); process.exitCode = 1;
} finally {
  writeFileSync(join(process.env.OPENCLAW_STATE_DIR, 'packed-model-verdict.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  for (const client of clients) await client.stopAndWait({ timeoutMs: 5000 });
  await new Promise(done => model.close(done));
}
