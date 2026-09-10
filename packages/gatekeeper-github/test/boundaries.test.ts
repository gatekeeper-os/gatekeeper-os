import { describe, expect, it } from 'vitest';
import { parseTarget, filePath } from '../src/urls.js';
import { GitHubApi, GitHubError, boundedBody } from '../src/api.js';
import { fixture } from './fixture.js';
import { TestApprovalQueue } from '@clawos/gatekeeper-kit';
import { GitHubAccount } from '../src/account.js';

describe('GitHub identity boundaries', () => {
  it.each(['https://github.com/Owner/Repo', 'https://github.com/Owner/Repo/', 'https://github.com/Owner/Repo/issues/12', 'https://github.com/Owner/Repo/pull/12'])('accepts exact reviewed URL %s', value => expect(parseTarget(value).owner).toBe('owner'));
  it.each(['http://github.com/o/r', 'https://github.com.evil/o/r', 'https://user@github.com/o/r', 'https://github.com:443/o/r', 'https://github.com/o/r?x=1', 'https://github.com/o/r#x', 'https://github.com/o/r/issues/0', 'https://github.com/o/r/pull/-1', 'https://github.com/o/r/issues/9007199254740992', 'https://github.com/o/r/issues/1/files', 'https://github.com/o/r/%2e%2e', 'https://github.com/o/../r', 'https://github.com/o/r%2fsecret', 'https://github.com/o/r\\x', ' https://github.com/o/r', 'https://github.com/o/r\n'])('rejects noncanonical URL %s', value => expect(() => parseTarget(value)).toThrow());
  it.each(['../secret', '/etc/passwd', 'x/../y', 'x//y', 'x\\y', 'x\0y'])('rejects file path %s', path => expect(() => filePath(path)).toThrow());
  it('encodes metacharacters as path components', () => expect(filePath('docs/a?x#y')).toBe('docs/a%3Fx%23y'));
  it('revocation invalidates retained resources, sessions, and verifiers', async () => {
    const f = fixture(), bound = await f.account.getGatekeeperFor('https://github.com/org/repo/issues/12');
    const q = new TestApprovalQueue(), session = await bound.gatekeeper.startSession(q), verifier = await f.account.getVerifier();
    await f.account.revoke(); const before = f.state.calls.length;
    await expect(session.call('gk_github_issue_get', { grant: 'g' }, q.context())).rejects.toThrow();
    await expect(bound.gatekeeper.applyAction(1)).rejects.toThrow();
    expect(f.state.calls.length).toBe(before); expect(f.verifiers.has(verifier.opaque)).toBe(false);
  });
  it('rejects stale remote repository and item identities', async () => {
    const f = fixture(), bound = await f.account.getGatekeeperFor('https://github.com/org/repo/issues/12'), q = new TestApprovalQueue();
    const session = await bound.gatekeeper.startSession(q); f.state.repoId++;
    await expect(session.call('gk_github_issue_get', { grant: 'g' }, q.context())).rejects.toThrow();
    f.state.repoId--; f.state.issueId++;
    await expect(session.call('gk_github_issue_get', { grant: 'g' }, q.context())).rejects.toThrow();
  });
  it('enforces account resource scope and no issue-to-repository widening', async () => {
    const f = fixture(), account = new GitHubAccount(new GitHubApi(() => 'fixture', f.transport), 'limited', ['issue'], f.dir + '/limited', () => {}, f.verifiers);
    await expect(account.getGatekeeperFor('https://github.com/org/repo')).rejects.toThrow();
    const binding = await account.getGatekeeperFor('https://github.com/org/repo/issues/12'), q = new TestApprovalQueue();
    const s = await binding.gatekeeper.startSession(q);
    await expect(s.call('gk_github_repo_get', { grant: 'g' }, q.context())).rejects.toThrow();
  });
  it('distinguishes negative observer ACL from transient failures and rejects forged verifiers', async () => {
    const f = fixture(), binding = await f.account.getGatekeeperFor('https://github.com/org/repo');
    const verifier = await f.account.getVerifier(); await binding.gatekeeper.addObserver('observer', verifier);
    await expect(binding.gatekeeper.addObserver('observer', { vendor: 'github', opaque: 'forged' })).rejects.toThrow('Observer lacks access');
    f.state.status = 404; await expect(binding.gatekeeper.addObserver('observer', verifier)).rejects.toThrow('Observer lacks access');
    f.state.status = 500; await expect(binding.gatekeeper.addObserver('observer', verifier)).rejects.toThrow('(500)');
  });
});

describe('bounded secret-safe transport', () => {
  it('never follows redirects or exposes response bodies in errors', async () => {
    let options: RequestInit | undefined;
    const api = new GitHubApi(() => 'private-credential', async (_url, init) => { options = init; return new Response('sensitive vendor body', { status: 302 }); });
    await expect(api.request('/user')).rejects.toThrow('GitHub request failed (302).');
    expect(options?.redirect).toBe('error');
  });
  it('separates rate limiting from negative ACL', async () => {
    const api = new GitHubApi(() => 'fixture', async () => new Response('private', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }));
    await expect(api.request('/user')).rejects.toMatchObject({ status: 429 });
  });
  it('bounds streamed bodies even without content length', async () => {
    await expect(boundedBody(new Response('123456'), 5)).rejects.toBeInstanceOf(GitHubError);
  });
  it('removes raw transport exception strings', async () => {
    const api = new GitHubApi(() => 'fixture', async () => { throw new Error('private credential'); });
    await expect(api.request('/user')).rejects.toThrow('GitHub request failed (0).');
  });
});
