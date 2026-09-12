// Real GitHub OAuth/effect acceptance. Never read credential journals or inject a provider.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { GitHubObserver } from '../../packages/clawos-conformance/src/github-observer.ts';
import { oauthStartUrl } from './github-real-evidence.mjs';
const state = '/home/tester/.openclaw-kernel-test';
if (process.env.CLAWOS_KERNEL_VM !== '1' || process.env.CLAWOS_TEST_MODE !== 'full' || process.cwd() !== '/home/tester/src' ||
    process.env.OPENCLAW_STATE_DIR !== state || process.env.OPENCLAW_CONFIG_PATH !== state + '/openclaw.json') throw new Error('VM required');
const input = JSON.parse(readFileSync('/run/user/1000/clawos-phase4-input.json', 'utf8'));
if (input.runId !== process.env.CLAWOS_SCENARIO_RUN) throw new Error('Current input required');
const require = createRequire(resolve('packages/clawos-conformance/package.json'));
const { GatewayClient } = await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
const phase = process.argv[2] ?? 'deferred';
const report = phase === 'native' ? JSON.parse(readFileSync(process.env.CLAWOS_SCENARIO_REPORT, 'utf8')) : {
  runId: input.runId, provider: 'github.com', mode: 'full', realProvider: true, checks: {}, turns: [], comments: [],
};
if (report.runId !== input.runId || report.provider !== 'github.com' || report.realProvider !== true) throw new Error('Current report required');
const privatePath = '/run/user/1000/clawos-phase4-canaries.json';
const markers = phase === 'native' ? JSON.parse(readFileSync(privatePath, 'utf8')) : {
  prompt: 'clawos-real-prompt-' + randomUUID(), completion: 'clawos-real-completion-' + randomUUID(),
  first: 'clawos-real-first-' + randomUUID(), rejected: 'clawos-real-reject-' + randomUUID(),
  native: 'clawos-real-native-' + randomUUID(), denied: 'clawos-real-deny-' + randomUUID(), route: 'clawos-real-route-' + randomUUID(),
  // Whitespace is valid tool input but should be rejected as blank by real GitHub.
  // Do not count a generic kernel failure as proof of an HTTP request or status.
  failure: Array.from(randomBytes(96), byte => [' ', '\t', '\n'][byte % 3]).join(''),
};
if (phase !== 'native') writeFileSync(privatePath, JSON.stringify(markers), { mode: 0o600, flag: 'wx' });
const runTag = input.runId.replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
const save = () => writeFileSync(process.env.CLAWOS_SCENARIO_REPORT, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
function check(id, value) {
  report.checks[id] = value === true; save();
  if (value !== true) throw new Error(id);
  console.log('PASS ' + id);
}
let shared, paired, restricted, current;
const requests = [], resolutions = [];
const scenarioAgent = phase === 'native' ? 'stranger' : 'main';
const observer = new GitHubObserver({ owner: input.owner, repo: input.repo, repositoryId: input.repositoryId,
  issueNumber: input.issueNumber, issueId: input.issueId, accountId: input.expectedAccountId },
  { token: process.env.CLAWOS_TEST_OBSERVER_TOKEN });
const issueUrl = `https://github.com/${input.owner}/${input.repo}/issues/${input.issueNumber}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
        first: body.includes(markers.first), rejected: body.includes(markers.rejected), native: body.includes(markers.native),
        nativeDenied: body.includes(markers.denied), routeFailure: body.includes(markers.route), providerFailure: /Operation denied or failed/.test(body),
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
    } else { message = { role: 'assistant', content: markers.completion }; finish = 'stop'; }
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
async function runTurn(id, operations) {
  current = { names: [], calls: 0, callIds: [], results: [], resultShapes: [], operations };
  await paired.client.request('agent', { agentId: scenarioAgent, sessionKey: `agent:${scenarioAgent}:github-${runTag}-${id}`, message: markers.prompt, idempotencyKey: randomUUID() }, { expectFinal: true, timeoutMs: 120000 });
  const row = { id, modelRequests: current.names.length, toolCalls: current.calls, results: current.results, names: current.names, resultShapes: current.resultShapes };
  report.turns.push(row); current = undefined; save();
  check(id + '-model-used', row.modelRequests > 0);
  check(id + '-tool-results', row.toolCalls === operations.length && row.results.filter(Boolean).length === operations.length);
  return row;
}
// Only exact successful independent deltas create cleanup receipts.
function effect(id, before, after, expected) {
  const verified = observer.verify(before, after, expected);
  check(id, verified.ok && verified.realProvider && verified.provider === 'github.com');
  if (verified.commentId) { report.comments.push({ phase, commentId: verified.commentId }); save(); }
  return verified;
}
async function unchanged(id, before) { const after = await observer.capture(); effect(id, before, after, { kind: 'unchanged' }); return after; }
async function account() { return rpc('os.gatekeepers.account', { vendor: 'github' }); }
let cleanupAction;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(19101, '127.0.0.1', resolve); });
  shared = await connect({ token: config.gateway.auth.token });
  check(phase + '-paired-device-issued', typeof shared.deviceToken === 'string' && shared.deviceToken.length > 0);
  paired = await connect({ deviceToken: shared.deviceToken }, ['operator.admin'], true);
  restricted = await connect({ deviceToken: shared.deviceToken }, ['operator.read']);
  const status = await rpc('os.status');
  check(phase + '-production-driver-live', status.healthy === true && status.gatekeepers.some(g => g.vendor === 'github' && g.healthy));
  check(phase + '-production-entry-configured', config.plugins.load.paths.includes(resolve('packages/gatekeeper-github')) &&
    config.plugins.load.paths.every(path => !path.includes('fixtures')) && config.plugins.entries['gatekeeper-github'].config.apiBase === undefined);
  if (phase === 'deferred') {
    const empty = await runTurn('no-grant', []);
    check('no-ambient-github-tools', empty.names.every(names => !names.some(name => name.startsWith('gk_github_'))));
    check('unconnected-grant-denied', await denied(paired.client, 'os.grants.introduce', { agentId: scenarioAgent, url: issueUrl }));
    check('unpaired-connect-denied', await denied(shared.client, 'os.gatekeepers.connect', { vendor: 'github' }));
    const connected = await rpc('os.gatekeepers.connect', { vendor: 'github', resourceTypes: ['issue'] });
    const startUrl = oauthStartUrl(connected.url);
    check('oauth-start-url-private', typeof startUrl === 'string');
    const start = await fetch(startUrl, { redirect: 'manual' });
    check('oauth-private-redirect', start.status === 303 && start.headers.get('cache-control') === 'no-store' && start.headers.get('referrer-policy') === 'no-referrer');
    const authorization = new URL(start.headers.get('location'));
    check('oauth-provider-pkce', authorization.origin === 'https://github.com' && authorization.pathname === '/login/oauth/authorize' &&
      authorization.searchParams.get('client_id') === input.oauthClientId && authorization.searchParams.get('code_challenge_method') === 'S256' &&
      /^[A-Za-z0-9_-]{43}$/.test(authorization.searchParams.get('code_challenge')) &&
      authorization.searchParams.get('redirect_uri') === 'http://127.0.0.1:19100/os/gatekeeper/github/oauth/callback');
    check('oauth-start-replay-denied', (await fetch(startUrl, { redirect: 'manual' })).status === 400);
    markers.oauthState = authorization.searchParams.get('state');
    markers.oauthChallenge = authorization.searchParams.get('code_challenge');
    writeFileSync(privatePath, JSON.stringify(markers), { mode: 0o600 });
    const pendingPath = '/run/user/1000/clawos-phase4-oauth-pending.json';
    writeFileSync(pendingPath, JSON.stringify({ runId: input.runId, authorizationUrl: authorization.href, expiresAt: Date.now() + 540000 }), { mode: 0o600, flag: 'wx' });
    console.log('WAIT real OAuth authorization (guest-private pending file; no URL in logs)');
    let identity;
    const deadline = Date.now() + 540000;
    try {
      while (Date.now() < deadline) {
        try { identity = await account(); } catch {}
        if (identity?.accountId) break;
        await sleep(1000);
      }
    } finally { unlinkSync(pendingPath); }
    check('account-connected', identity?.accountId === String(input.expectedAccountId));
    // The successful callback consumed the provider state; a replay with a dummy
    // code must be rejected before contacting GitHub. Never capture the real code.
    const replay = new URL(authorization.searchParams.get('redirect_uri'));
    replay.searchParams.set('state', authorization.searchParams.get('state')); replay.searchParams.set('code', 'replay-not-a-real-code');
    check('oauth-callback-replay-denied', (await fetch(replay, { redirect: 'manual' })).status === 400);
  } else {
    check('native-connected-account-bound', (await account()).accountId === String(input.expectedAccountId));
  }
  const added = await rpc('os.grants.introduce', { agentId: scenarioAgent, url: issueUrl });
  check(phase === 'deferred' ? 'grant-introduced' : 'native-grant-introduced', added.status === 'active' && added.resourceType === 'issue');
  const grant = added.handle;
  const read = { tool: 'gk_github_issue_get', params: { grant } };
  const write = body => ({ tool: 'gk_github_issue_comment', params: { grant, body } });
  let baseline = await observer.capture();
  if (phase === 'deferred') {
    const pending = await runTurn('comment-and-read', [write(markers.first), read]);
    check('issue-only-tools', pending.names.every(names => names.includes('gk_github_issue_get') && names.includes('gk_github_issue_comment') &&
      !names.includes('gk_github_issue_create') && !names.includes('gk_github_pull_review')));
    check('pending-overlay-visible', pending.results[1]?.first === true && !pending.results[1]?.denied);
    const queue = (await rpc('os.approvals.list')).actions;
    check('action-pending', queue.length === 1 && queue[0].status === 'pending');
    baseline = await unchanged('remote-unchanged-before-approval', baseline);
    check('deferred-unauthorized-denied', await denied(restricted.client, 'os.approvals.apply', { ids: [queue[0].id] }));
    await rpc('os.approvals.apply', { ids: [queue[0].id] });
    cleanupAction = queue[0].id;
    let applied = await observer.capture();
    const receipt = effect('apply-remote-confirmed', baseline, applied, { kind: 'created', body: markers.first });
    check('apply-replay-denied', await denied(paired.client, 'os.approvals.apply', { ids: [queue[0].id] }));
    applied = await unchanged('apply-replay-no-duplicate', applied);
    const rejected = await runTurn('reject-pending', [write(markers.rejected), read]);
    check('second-overlay-visible', rejected.results[1]?.rejected === true);
    const second = (await rpc('os.approvals.list')).actions;
    check('second-action-pending', second.length === 1 && second[0].status === 'pending');
    await rpc('os.approvals.reject', { ids: [second[0].id] });
    const afterReject = await runTurn('rejected-read', [read]);
    check('reject-overlay-removed', afterReject.results[0]?.rejected === false && afterReject.results[0]?.first === true);
    applied = await unchanged('reject-remote-unchanged', applied);
    await rpc('os.approvals.revert', { ids: [queue[0].id] }); cleanupAction = undefined;
    effect('revert-remote-confirmed', applied, await observer.capture(), { kind: 'reverted', commentId: receipt.commentId });
    const audit = await rpc('os.audit.query', { limit: 1000 });
    check('audit-complete', audit.some(r => r.kind === 'action.apply' && r.actionId === queue[0].id && r.ok) &&
      audit.some(r => r.kind === 'action.revert' && r.actionId === queue[0].id && r.ok) &&
      audit.some(r => r.kind === 'action.decide' && r.actionId === second[0].id && r.decision === 'reject' && r.ok));
    check('deferred-audit-no-bodies', Object.values(markers).every(marker => !JSON.stringify(audit).includes(marker)));
    await rpc('os.grants.revoke', { handle: grant });
    const revoked = await runTurn('revoked', []);
    check('revoked-tools-absent', revoked.names.every(names => !names.some(n => n.startsWith('gk_github_'))));
  } else {
    async function nativeTurn(id, decision, body) {
      const before = await observer.capture(), offset = requests.length;
      let done = false;
      const pending = runTurn(id, [write(body), read]);
      void pending.then(() => { done = true; }, () => { done = true; });
      const deadline = Date.now() + 45000;
      while (requests.length === offset && !done && Date.now() < deadline) await sleep(100);
      const request = requests[offset];
      check(id + '-native-prompt', !done && typeof request?.id === 'string' && request.request?.pluginId === 'clawos-kernel' && request.request?.toolName === 'gk_github_issue_comment');
      await unchanged(id + '-remote-paused', before);
      check(id + '-unauthorized-denied', await denied(restricted.client, 'plugin.approval.resolve', { id: request.id, decision }));
      check(id + '-still-paused', !done);
      await rpc('plugin.approval.resolve', { id: request.id, decision });
      const row = await pending;
      check(id + '-resolution-event', resolutions.some(r => r.id === request.id && r.decision === decision));
      const after = await observer.capture();
      try { await rpc('plugin.approval.resolve', { id: request.id, decision: 'allow-once' }); } catch {}
      await unchanged(id + '-resolution-replay-unchanged', after);
      return { row, before, after };
    }
    const allowed = await nativeTurn('native-allow', 'allow-once', markers.native);
    let audit = await rpc('os.audit.query', { limit: 1000 });
    const nativeActions = audit.filter(r => r.kind === 'action.apply' && r.by === 'native-approval' && r.ok);
    check('native-success-audited', nativeActions.length === 1 && Number.isSafeInteger(nativeActions[0].actionId));
    cleanupAction = nativeActions[0].actionId;
    const nativeReceipt = effect('native-remote-applied-once', allowed.before, allowed.after, { kind: 'created', body: markers.native });
    check('native-allow-readback', allowed.row.results[1]?.native === true && !allowed.row.results[0]?.denied);
    check('await-decision-requested', report.checks['native-allow-native-prompt']);
    check('unauthorized-decision-denied', report.checks['native-allow-unauthorized-denied']);
    check('operator-approval-resumes', allowed.row.results[1]?.native === true);
    check('resolved-once', report.checks['native-allow-resolution-replay-unchanged']);
    const refused = await nativeTurn('native-deny', 'deny', markers.denied);
    effect('native-deny-remote-unchanged', refused.before, refused.after, { kind: 'unchanged' });
    check('native-deny-reported', refused.row.results[0]?.denied === true);
    check('native-deny-no-overlay', refused.row.results[1]?.nativeDenied === false && refused.row.results[1]?.native === true);
    check('native-no-pending', (await rpc('os.approvals.list')).actions.length === 0);
    report.nativeDenial = true;
    await paired.client.stopAndWait({ timeoutMs: 5000 });
    paired = await connect({ deviceToken: shared.deviceToken });
    const beforeRoute = await observer.capture();
    const route = await runTurn('native-route-failure', [write(markers.route), read]);
    check('native-route-failure-reported', route.results[0]?.approvalUnavailable === true);
    await unchanged('native-route-remote-unchanged', beforeRoute);
    check('native-route-no-overlay', route.results[1]?.routeFailure === false && !route.results[1]?.denied);
    check('native-route-not-pending', (await rpc('os.approvals.list')).actions.length === 0);
    report.nativeApprovalRouteFailure = true; save();
    // Clean up only the action corresponding to the observer's recorded comment.
    await rpc('os.approvals.revert', { ids: [cleanupAction] }); cleanupAction = undefined;
    effect('native-recorded-comment-reverted', allowed.after, await observer.capture(), { kind: 'reverted', commentId: nativeReceipt.commentId });
    await paired.client.stopAndWait({ timeoutMs: 5000 });
    paired = await connect({ deviceToken: shared.deviceToken }, ['operator.admin'], true);
    const failed = await nativeTurn('native-provider-validation', 'allow-once', markers.failure);
    audit = await rpc('os.audit.query', { limit: 1000 });
    const unexpectedApplied = audit.filter(r => r.kind === 'action.apply' && r.by === 'native-approval' && r.ok && r.actionId !== nativeActions[0].actionId);
    // If GitHub unexpectedly accepts whitespace, never leave that own recorded action behind.
    if (unexpectedApplied.length === 1) cleanupAction = unexpectedApplied[0].actionId;
    check('native-failed-tool-reported', failed.row.results[0]?.providerFailure === true && unexpectedApplied.length === 0);
    effect('native-failed-tool-remote-unchanged', failed.before, failed.after, { kind: 'unchanged' });
    audit = await rpc('os.audit.query', { limit: 1000 });
    check('native-failed-tool-audited', audit.some(r => r.kind === 'tool' && r.title === 'gk_github_issue_comment' && r.sessionKey?.endsWith('native-provider-validation') && r.ok === false));
    report.failedToolExecuted = true;
    report.providerFailureProvenance = [200, 422].includes(failed.row.results[0]?.providerResponseStatus);
    check('native-provider-validation-http-response', report.providerFailureProvenance);
    await rpc('os.grants.revoke', { handle: grant });
  }
} catch (error) {
  report.failure = /^[a-z0-9-]+$/.test(error.message) ? error.message : 'real-provider-scenario-error';
  console.log('FAIL ' + report.failure); process.exitCode = 1;
} finally {
  if (cleanupAction !== undefined && paired) {
    // Revert routes through the driver's saved action ID, never arbitrary comment deletion.
    try { await rpc('os.approvals.revert', { ids: [cleanupAction] }); report.failureCleanup = 'recorded-action-reverted-unverified'; }
    catch { report.failureCleanup = 'recorded-action-cleanup-required'; }
  }
  save(); await restricted?.client.stopAndWait({ timeoutMs: 5000 }); await paired?.client.stopAndWait({ timeoutMs: 5000 }); await shared?.client.stopAndWait({ timeoutMs: 5000 });
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
