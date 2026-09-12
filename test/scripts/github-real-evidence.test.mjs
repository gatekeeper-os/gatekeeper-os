import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absentFromLogs, validateInput, oauthStartUrl } from './github-real-evidence.mjs';
test('OAuth entry accepts only the kernel relative route and fixed loopback origin', () => {
  const path = '/os/gatekeeper/github/oauth/start?state=' + 'a'.repeat(32);
  assert.equal(oauthStartUrl(path), 'http://127.0.0.1:19100' + path);
  for (const bad of [undefined, 'https://evil.example' + path, '//evil.example' + path,
    path + '&redirect=https://evil.example', path + '#fragment', path.slice(0, -1),
    path.replace('/github/', '/other/'), '/a/..' + path]) assert.equal(oauthStartUrl(bad), undefined);
});
const input = { runId: 'current', owner: 'mmango7474', repo: 'clawos-beta-acceptance', repositoryId: 1366819708,
  issueNumber: 1, issueId: 5430217206, expectedAccountId: 56606128, oauthClientId: 'public-client' };
test('input binds exact current run, numeric identities and loopback callback', () => {
  assert.equal(validateInput(input, 'current'), true);
  for (const patch of [{ runId: 'stale' }, { issueId: '5430217206' }, { expectedAccountId: 0 }, { repo: '..' },
    { owner: 'github.com/x' }, { oauthClientId: '' }, { publicOrigin: 'http://example.com' }, { publicOrigin: 'http://127.0.0.1:19100/evil' }])
    assert.equal(validateInput({ ...input, ...patch }, 'current'), false);
  assert.equal(validateInput(null, 'current'), false);
});
test('secrecy detects raw, JSON-escaped and nested JSON whitespace request bodies', () => {
  const marker = '\t\n \t  \n\t\n   \t\n';
  assert.equal(absentFromLogs(['only safe status'], [marker]), true);
  for (const content of [marker, JSON.stringify({ body: marker }), JSON.stringify({ error: JSON.stringify({ body: marker }) })])
    assert.equal(absentFromLogs([content], [marker]), false);
});
test('missing sinks/canaries fail rather than vacuous pass', () => {
  assert.equal(absentFromLogs([], ['secret']), false);
  assert.equal(absentFromLogs(['safe'], []), false);
  assert.equal(absentFromLogs(['safe'], [undefined]), false);
  assert.equal(absentFromLogs(['safe'], ['']), false);
  assert.equal(absentFromLogs(['secret'], ['secret']), false);
});
