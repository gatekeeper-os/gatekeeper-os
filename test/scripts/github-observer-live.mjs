// Uses the operator-authorized gh credential only in this separate real-provider
// observer test. It never connects/seeds the gatekeeper and cannot pass full mode.
import { readFileSync, writeFileSync, openSync, closeSync, constants, fstatSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { GitHubObserver } from '../../packages/clawos-conformance/src/github-observer.ts';
if (process.env.CLAWOS_KERNEL_VM !== '1' || process.env.CLAWOS_TEST_MODE !== 'observer-live' || process.cwd() !== '/home/tester/src') throw new Error('VM required');
const reportPath = '/home/tester/phase-4-observer-evidence/scenarios.json';
const report = { runId: process.env.CLAWOS_TEST_START, mode: 'observer-live', provider: 'github.com', realProvider: true, fullPhaseAcceptance: false, oauthAcceptance: false, gatekeeperAcceptance: false, checks: {} };
let createdId, base, input, observer;
const body = 'clawos-observer-live-' + randomUUID();
function save() { writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
function check(key, ok) { report.checks[key] = ok === true; save(); if (!ok) throw new Error(); console.log('PASS ' + key); }
async function api(path, method = 'GET', json) {
  const response = await fetch('https://api.github.com' + path, { method, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: 'Bearer ' + process.env.CLAWOS_TEST_OBSERVER_TOKEN, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    ...(json ? { body: JSON.stringify(json) } : {}) });
  if (response.status !== (method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200)) { await response.body?.cancel(); throw new Error(); }
  return method === 'DELETE' ? null : response.json();
}
try {
  const fd = openSync('/run/user/1000/clawos-phase4-input.json', constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = fstatSync(fd); if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o077) || s.size > 16384) throw new Error(); input = JSON.parse(readFileSync(fd, 'utf8')); }
  finally { closeSync(fd); }
  // This initial authorized run is deliberately narrower than a generic mutation harness.
  check('authorized-test-target', input.runId === report.runId && input.owner === 'mmango7474' && input.repo === 'clawos-beta-acceptance' &&
    input.repositoryId === 1366819708 && input.issueId === 5430217206 && input.issueNumber === 1 && input.expectedAccountId === 56606128);
  check('authorized-gh-identity', (await api('/user')).id === input.expectedAccountId);
  base = `/repos/${input.owner}/${input.repo}`;
  observer = new GitHubObserver({ ...input, accountId: input.expectedAccountId }, { token: process.env.CLAWOS_TEST_OBSERVER_TOKEN });
  const before = await observer.capture();
  const unchanged = observer.verify(before, await observer.capture(), { kind: 'unchanged' });
  check('native-read-transport', unchanged.realProvider === true && unchanged.provider === 'github.com');
  check('unchanged-baseline', unchanged.ok);
  const created = await api(`${base}/issues/${input.issueNumber}/comments`, 'POST', { body });
  if (!Number.isSafeInteger(created.id) || created.id < 1 || created.body !== body || created.user?.id !== input.expectedAccountId) throw new Error();
  createdId = created.id;
  const after = await observer.capture();
  const delta = observer.verify(before, after, { kind: 'created', body });
  check('exact-remote-create', delta.ok && delta.commentId === createdId);
  check('no-second-effect', observer.verify(after, await observer.capture(), { kind: 'unchanged' }).ok);
  await api(`${base}/issues/comments/${createdId}`, 'DELETE');
  const reverted = await observer.capture();
  check('exact-remote-revert', observer.verify(after, reverted, { kind: 'reverted', commentId: createdId }).ok);
  createdId = undefined;
  check('baseline-restored', observer.verify(before, reverted, { kind: 'unchanged' }).ok);
  check('payload-free-report', !JSON.stringify(report).includes(body) && !JSON.stringify(report).includes(process.env.CLAWOS_TEST_OBSERVER_TOKEN));
} catch {
  report.failure = 'real-observer-check-failed'; process.exitCode = 1;
  console.log('FAIL real-observer-check-failed');
} finally {
  if (createdId && base) {
    try {
      // Never delete an ID whose identity/body no longer matches this run.
      const value = await api(`${base}/issues/comments/${createdId}`);
      if (value.id !== createdId || value.body !== body || value.user?.id !== input.expectedAccountId) throw new Error();
      await api(`${base}/issues/comments/${createdId}`, 'DELETE'); report.cleanup = 'recorded-comment-removed';
    } catch { report.cleanup = 'recorded-comment-needs-review'; report.createdCommentId = createdId; process.exitCode = 1; }
  }
  save();
}
