// Live Gateway/production kernel and GitHub driver; provider transport is synthetic.
// No real accounts, network effects, source credentials or native approval claims.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
if (process.env.CLAWOS_KERNEL_VM !== '1' || process.env.CLAWOS_TEST_MODE !== 'gateway-integration' ||
    process.env.OPENCLAW_STATE_DIR !== '/home/tester/.openclaw-kernel-test' ||
    process.env.OPENCLAW_CONFIG_PATH !== '/home/tester/.openclaw-kernel-test/openclaw.json' ||
    process.cwd() !== '/home/tester/src') throw new Error('VM required');
if (process.env.CLAWOS_TEST_UPSTREAM_ROOT && process.env.CLAWOS_TEST_UPSTREAM_ROOT !== '/home/tester/phase4-upstream/node_modules/openclaw') throw new Error('VM upstream root required');
const require = createRequire(process.env.CLAWOS_TEST_UPSTREAM_ROOT ? resolve(process.env.CLAWOS_TEST_UPSTREAM_ROOT, 'package.json') : resolve('packages/clawos-conformance/package.json'));
const { GatewayClient } = await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
const phase = process.argv[2] ?? 'deferred';
const report = phase === 'native' ? JSON.parse(readFileSync(process.env.CLAWOS_SCENARIO_REPORT, 'utf8')) : { runId: process.env.CLAWOS_SCENARIO_RUN, mode: 'gateway-integration',
  provider: 'in-memory-fixture', realProvider: false, checks: {}, turns: [] };
const save = () => writeFileSync(process.env.CLAWOS_SCENARIO_REPORT, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
function check(id, value) {
  report.checks[id] = value === true; save();
  if (value !== true) throw new Error(id);
  console.log('PASS ' + id);
}
let shared, paired, restricted, current;
const requests = [], resolutions = [];
const scenarioAgent = phase === 'native' ? 'stranger' : 'main';
const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'POST' || !current) throw new Error();
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 2_000_000) throw new Error(); }
    const input = JSON.parse(raw);
    current.names.push((input.tools ?? []).map(t => t.function?.name ?? t.name));
    const messages = input.messages ?? [];
    const results = messages.slice(messages.findLastIndex(m => m.role === 'user') + 1).filter(m => m.role === 'tool');
    current.resultShapes.push(results.map(result => ({ keys: Object.keys(result), callMatches: current.callIds.includes(result.tool_call_id),
      callId: typeof result.tool_call_id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(result.tool_call_id) ? result.tool_call_id : 'absent-or-other' })));
    for (const result of results) {
      const index = current.callIds.indexOf(result.tool_call_id);
      if (index < 0) continue;
      const body = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      current.results[index] = {
        first: body.includes('phase-four-first-comment'), rejected: body.includes('phase-four-rejected-comment'),
        routeFailure: body.includes('phase-four-private-route-failure'),
        providerResponseStatus: Number(body.match(/Provider response status: ([1-5][0-9]{2})\./)?.[1]) || undefined,
        approvalUnavailable: /Plugin approval unavailable/i.test(body),
        denied: /denied|no such grant|not active|blocked|not found|unavailable|not available/i.test(body),
      };
    }
    const operation = current.operations[current.calls];
    // Provider adapters normalize punctuation in call IDs. Emit an already
    // normalized ID so the evidence matcher follows the actual roundtrip.
    const callId = 'githubprobe' + current.calls;
    let message, finish;
    if (operation) {
      current.callIds.push(callId); current.calls++;
      message = { role: 'assistant', content: null, tool_calls: [{ id: callId, type: 'function', function: {
        name: operation.tool, arguments: JSON.stringify(operation.params),
      } }] }; finish = 'tool_calls';
    } else { message = { role: 'assistant', content: 'scenario-complete' }; finish = 'stop'; }
    const id = 'github-model-probe';
    if (input.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const delta = operation ? { role: 'assistant', tool_calls: message.tool_calls.map(t => ({ index: 0, ...t })) } : message;
      for (const part of [{ delta, finish_reason: null }, { delta: {}, finish_reason: finish }])
        res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: 'spike', choices: [{ index: 0, ...part }] }) + '\n\n');
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, object: 'chat.completion', model: 'spike', choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
    }
  } catch { res.writeHead(400); res.end('{}'); }
});
async function connect(auth, scopes = ['operator.admin'], observe = false) {
  let client, timer;
  try {
    const hello = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('connection-timeout')), 30000);
      client = new GatewayClient({ url: 'ws://127.0.0.1:19100', ...auth, env: process.env,
        clientName: 'cli', mode: 'cli', role: 'operator', scopes, caps: observe ? ['plugin-approvals'] : [], requestTimeoutMs: 120000,
        hostDeps: { logDebug() {}, logError() {} }, onEvent: event => {
          if (!observe) return;
          if (event.event === 'plugin.approval.requested') requests.push(event.payload);
          if (event.event === 'plugin.approval.resolved') resolutions.push(event.payload);
        }, onHelloOk: resolve, onConnectError: () => reject(new Error('connection-failed')) });
      client.start();
    });
    return { client, deviceToken: hello.auth?.deviceToken };
  } catch (e) { await client?.stopAndWait({ timeoutMs: 5000 }); throw e; }
  finally { clearTimeout(timer); }
}
async function denied(client, method, params) { try { await client.request(method, params); return false; } catch { return true; } }
const rpc = (method, params = {}) => paired.client.request(method, params);
const provider = () => rpc('vm.github.provider-status');
function cli(args) {
  const r = spawnSync('clawos', [...args, '--cell', 'kernel-test', '--json'], { env: process.env, encoding: 'utf8', timeout: 90000, maxBuffer: 4*1024*1024 });
  if (r.status !== 0 || r.error) return { ok: false };
  try { return { ok: true, value: JSON.parse(r.stdout) }; } catch { return { ok: false }; }
}
async function runTurn(id, operations) {
  current = { names: [], calls: 0, callIds: [], results: [], resultShapes: [], operations };
  await paired.client.request('agent', { agentId: scenarioAgent, sessionKey: `agent:${scenarioAgent}:github-${id}`, message: 'Perform the requested fixture operation and inspect the result.', idempotencyKey: randomUUID() }, { expectFinal: true, timeoutMs: 120000 });
  const row = { id, modelRequests: current.names.length, toolCalls: current.calls, results: current.results, names: current.names, resultShapes: current.resultShapes };
  report.turns.push(row); current = undefined; save();
  check(id + '-model-used', row.modelRequests > 0);
  check(id + '-tool-results', row.toolCalls === operations.length && row.results.filter(Boolean).length === operations.length);
  return row;
}
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []); }
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(19101, '127.0.0.1', resolve); });
  shared = await connect({ token: config.gateway.auth.token });
  check(phase + '-paired-device-issued', typeof shared.deviceToken === 'string' && shared.deviceToken.length > 0);
  paired = await connect({ deviceToken: shared.deviceToken }, ['operator.admin'], true);
  const status = await rpc('os.status');
  check(phase + '-github-driver-live', status.healthy === true && status.gatekeepers.some(g => g.vendor === 'github' && g.healthy));
  check(phase + '-provider-explicitly-synthetic', (await provider()).realProvider === false);
  if (phase === 'native') {
    restricted = await connect({ deviceToken: shared.deviceToken }, ['operator.read']);
    const added = cli(['grant', 'add', '--agent', scenarioAgent, 'https://github.com/org/repo/issues/12']);
    check('native-grant-introduced', added.ok && added.value?.status === 'active');
    const grant = added.value.handle;
    const read = { tool: 'gk_github_issue_get', params: { grant } };
    const write = body => ({ tool: 'gk_github_issue_comment', params: { grant, body } });
    async function nativeTurn(id, decision, body, beforeMutations = decision === 'allow-once' ? 0 : 1) {
      const offset = requests.length;
      let done = false;
      const pending = runTurn(id, [write(body ?? (decision === 'allow-once' ? 'phase-four-first-comment' : 'phase-four-rejected-comment')), read]);
      void pending.then(() => { done = true; }, () => { done = true; });
      const deadline = Date.now() + 45000;
      while (requests.length === offset && !done && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      const request = requests[offset];
      check(id + '-native-prompt', !done && typeof request?.id === 'string' && request.request?.pluginId === 'clawos-kernel' && request.request?.toolName === 'gk_github_issue_comment');
      check(id + '-no-effect-before-decision', (await provider()).mutations === beforeMutations);
      check(id + '-unauthorized-decision-denied', await denied(restricted.client, 'plugin.approval.resolve', { id: request.id, decision }));
      check(id + '-still-paused', !done && (await provider()).mutations === beforeMutations);
      await rpc('plugin.approval.resolve', { id: request.id, decision });
      const row = await pending;
      check(id + '-native-resolved', resolutions.some(r => r.id === request.id && r.decision === decision));
      // Durable upstream resolution is first-answer-wins; replay may return the
      // canonical result, but must never resume a second provider mutation.
      try { await rpc('plugin.approval.resolve', { id: request.id, decision: 'allow-once' }); } catch {}
      return row;
    }
    const allowed = await nativeTurn('native-allow', 'allow-once');
    check('native-apply-readback', allowed.results[1]?.first === true && !allowed.results[0]?.denied);
    check('native-applied-once', (await provider()).comments === 1 && (await provider()).mutations === 1);
    check('native-no-pending-after-apply', (await rpc('os.approvals.list')).actions.length === 0);
    check('native-application-audited', (await rpc('os.audit.query', { limit: 1000 })).some(r => r.kind === 'action.apply' && r.by === 'native-approval' && r.ok));
    const refused = await nativeTurn('native-deny', 'deny');
    check('native-deny-no-effect', (await provider()).comments === 1 && !(await provider()).rejectedPresent && (await provider()).mutations === 1);
    check('native-deny-no-overlay', refused.results[1]?.rejected === false && refused.results[1]?.first === true);
    check('native-no-pending-after-deny', (await rpc('os.approvals.list')).actions.length === 0);
    // Close the only approval receiver before reconnecting without that cap.
    // Ordinary operator RPC access is not an approval delivery route.
    await paired.client.stopAndWait({ timeoutMs: 5000 });
    paired = await connect({ deviceToken: shared.deviceToken });
    const beforeRoute = await provider();
    const missingRoute = await runTurn('native-route-failure', [write('phase-four-private-route-failure'), read]);
    check('native-route-failure-reported', missingRoute.results[0]?.approvalUnavailable === true);
    const afterRoute = await provider();
    check('native-route-failure-no-effect', afterRoute.mutations === beforeRoute.mutations && afterRoute.comments === beforeRoute.comments && afterRoute.failedWrites === beforeRoute.failedWrites);
    check('native-route-failure-no-overlay', missingRoute.results[1]?.routeFailure === false && !missingRoute.results[1]?.denied);
    check('native-route-failure-not-pending', (await rpc('os.approvals.list')).actions.length === 0);
    report.nativeApprovalRouteFailure = true;
    await paired.client.stopAndWait({ timeoutMs: 5000 });
    paired = await connect({ deviceToken: shared.deviceToken }, ['operator.admin'], true);
    const failed = await nativeTurn('native-provider-failure', 'allow-once', 'phase-four-private-failure\n"quoted" private-tail-marker', 1);
    check('native-provider-failure-reported', failed.results[0]?.denied === true);
    check('native-provider-http-provenance', failed.results[0]?.providerResponseStatus === 503);
    check('native-provider-failure-once', (await provider()).failedWrites === 1 && (await provider()).mutations === 1 && (await provider()).comments === 1);
    check('native-provider-failure-not-pending', (await rpc('os.approvals.list')).actions.length === 0);
    const failureAudit = await rpc('os.audit.query', { limit: 1000 });
    check('native-provider-failure-audited', failureAudit.some(r => r.kind === 'tool' && r.title === 'gk_github_issue_comment' && r.sessionKey?.endsWith('github-native-provider-failure') && r.ok === false));
    report.nativeApprovalRoundtrip = true;
  } else {
  const noGrant = await runTurn('no-grant', []);
  check('no-ambient-github-tools', noGrant.names.every(names => !names.some(n => n.startsWith('gk_github_'))));
  const issueUrl = 'https://github.com/org/repo/issues/12';
  check('unconnected-account-metadata-empty', await rpc('os.gatekeepers.account', { vendor: 'github' }) === null);
  check('unpaired-account-metadata-denied', await denied(shared.client, 'os.gatekeepers.account', { vendor: 'github' }));
  check('unconnected-grant-denied', await denied(paired.client, 'os.grants.introduce', { agentId: 'main', url: issueUrl }));
  check('unpaired-connect-denied', await denied(shared.client, 'os.gatekeepers.connect', { vendor: 'github' }));
  const connected = cli(['gatekeeper', 'connect', 'github']);
  check('cli-connect-start', connected.ok && /^http:\/\/127\.0\.0\.1:19100\/os\/gatekeeper\/github\/oauth\/start\?state=[A-Za-z0-9_-]{32}$/.test(connected.value?.url));
  const start = await fetch(connected.value.url, { redirect: 'manual' });
  check('oauth-private-redirect', start.status === 303 && start.headers.get('cache-control') === 'no-store' && start.headers.get('referrer-policy') === 'no-referrer');
  const redirect = new URL(start.headers.get('location'));
  check('oauth-provider-and-pkce', redirect.origin === 'https://github.com' && redirect.pathname === '/login/oauth/authorize' && redirect.searchParams.get('code_challenge_method') === 'S256');
  check('oauth-start-replay-denied', (await fetch(connected.value.url, { redirect: 'manual' })).status === 400);
  const callback = new URL(redirect.searchParams.get('redirect_uri'));
  check('oauth-exact-callback', callback.href === 'http://127.0.0.1:19100/os/gatekeeper/github/oauth/callback');
  callback.searchParams.set('state', redirect.searchParams.get('state')); callback.searchParams.set('code', 'fixture-short-code');
  check('oauth-fixture-connected', (await fetch(callback)).status === 200);
  const accountMetadata = await rpc('os.gatekeepers.account', { vendor: 'github' });
  check('oauth-account-numeric-identity', accountMetadata?.accountId === '99' && accountMetadata?.displayName === 'fixture');
  const exchange = await provider();
  check('oauth-exchange-bound', exchange.exchanges === 1 && exchange.exchangeBound && exchange.verifierHash === redirect.searchParams.get('code_challenge'));
  check('oauth-callback-replay-denied', (await fetch(callback)).status === 400 && (await provider()).exchanges === 1);
  const added = cli(['grant', 'add', '--agent', 'main', issueUrl]);
  check('cli-issue-grant', added.ok && added.value?.status === 'active');
  const grant = added.value.handle;
  const read = { tool: 'gk_github_issue_get', params: { grant } };
  const write = body => ({ tool: 'gk_github_issue_comment', params: { grant, body } });
  const pending = await runTurn('comment-and-read', [write('phase-four-first-comment'), read]);
  check('issue-only-tools', pending.names.every(names => names.includes('gk_github_issue_get') && names.includes('gk_github_issue_comment') && !names.includes('gk_github_issue_create') && !names.includes('gk_github_pull_review')));
  check('pending-overlay-visible-same-turn', pending.results[1]?.first === true && !pending.results[1]?.denied);
  const actions = (await rpc('os.approvals.list')).actions;
  check('action-pending', actions.length === 1 && actions[0].status === 'pending');
  check('provider-unchanged-before-approval', (await provider()).comments === 0 && (await provider()).mutations === 0);
  check('unauthorized-decision-denied', await denied(shared.client, 'os.approvals.apply', { ids: [actions[0].id] }));
  const apply = cli(['approvals', 'apply', String(actions[0].id)]);
  check('cli-apply-confirmed', apply.ok && apply.value.ids[0] === actions[0].id);
  check('provider-apply-once', (await provider()).comments === 1 && (await provider()).firstPresent && (await provider()).mutations === 1);
  check('apply-replay-denied', await denied(paired.client, 'os.approvals.apply', { ids: [actions[0].id] }));
  check('apply-replay-no-duplicate', (await provider()).mutations === 1);
  const applied = await runTurn('applied-read', [read]);
  check('applied-read-visible', applied.results[0]?.first === true && !applied.results[0]?.denied);
  const rejected = await runTurn('reject-pending', [write('phase-four-rejected-comment'), read]);
  check('second-overlay-visible', rejected.results[1]?.rejected === true);
  const rejectionQueue = (await rpc('os.approvals.list')).actions;
  check('second-action-pending', rejectionQueue.length === 1 && rejectionQueue[0].status === 'pending');
  const rejection = cli(['approvals', 'reject', String(rejectionQueue[0].id)]);
  check('cli-reject-confirmed', rejection.ok && rejection.value.ids[0] === rejectionQueue[0].id);
  const afterReject = await runTurn('rejected-read', [read]);
  check('rejected-overlay-removed', afterReject.results[0]?.rejected === false && afterReject.results[0]?.first === true);
  check('reject-provider-unchanged', (await provider()).comments === 1 && !(await provider()).rejectedPresent && (await provider()).mutations === 1);
  const revert = cli(['approvals', 'revert', String(actions[0].id)]);
  check('cli-revert-confirmed', revert.ok && revert.value.ids[0] === actions[0].id);
  check('revert-provider-confirmed', (await provider()).comments === 0 && (await provider()).mutations === 2);
  const afterRevert = await runTurn('reverted-read', [read]);
  check('reverted-read-absent', afterRevert.results[0]?.first === false && afterRevert.results[0]?.rejected === false && !afterRevert.results[0]?.denied);
  const audit = await rpc('os.audit.query', { limit: 1000 });
  check('actions-audited', audit.some(r => r.kind === 'action.apply' && r.actionId === actions[0].id && r.ok) &&
    audit.some(r => r.kind === 'action.revert' && r.actionId === actions[0].id && r.ok) &&
    audit.some(r => r.kind === 'action.decide' && r.actionId === rejectionQueue[0].id && r.decision === 'reject' && r.ok));
  check('audit-no-api-bodies', !JSON.stringify(audit).includes('phase-four-first-comment') && !JSON.stringify(audit).includes('phase-four-rejected-comment'));
  const revoked = cli(['grant', 'revoke', grant]);
  check('cli-grant-revoked', revoked.ok && revoked.value.revoked === true);
  const afterRevoke = await runTurn('revoked', []);
  check('revoked-tools-absent', afterRevoke.names.every(names => !names.some(n => n.startsWith('gk_github_'))));
  }
  const protectedFiles = [...files(join(process.env.OPENCLAW_STATE_DIR, 'os')), '/home/tester/github-gateway.log', ...(phase === 'native' ? ['/home/tester/github-native-gateway.log'] : [])];
  const sensitive = ['offline-app-secret-marker', 'offline-access-token-marker', 'fixture-short-code'];
  check(phase + '-fixture-secrets-not-persisted-plaintext', protectedFiles.every(path => {
    const content = readFileSync(path); return sensitive.every(value => !content.includes(Buffer.from(value)));
  }));
  check(phase + '-scenario-artifact-secret-clean', sensitive.every(value => !JSON.stringify(report).includes(value)));
} catch (error) {
  report.failure = /^[a-z0-9-]+$/.test(error.message) ? error.message : 'scenario-error';
  console.log('FAIL ' + report.failure); process.exitCode = 1;
} finally {
  save(); await restricted?.client.stopAndWait({ timeoutMs: 5000 }); await paired?.client.stopAndWait({ timeoutMs: 5000 }); await shared?.client.stopAndWait({ timeoutMs: 5000 });
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
