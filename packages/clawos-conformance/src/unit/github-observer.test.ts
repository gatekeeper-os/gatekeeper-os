import { describe, expect, it } from 'vitest';
import { GitHubObserver } from '../github-observer.js';

const target = { owner: 'disposable', repo: 'acceptance', repositoryId: 10, issueId: 20, issueNumber: 3, accountId: 30 };
const root = 'https://api.github.com/repos/disposable/acceptance';
const comment = (id: number, body = 'private-observer-body', accountId = 30) => ({ id, body, user: { id: accountId }, issue_url: root + '/issues/3' });
function fixture() {
  const state = { comments: [comment(1, 'pre-existing', 99)], requests: [] as { url: string; init: RequestInit | undefined }[],
    repoId: 10, issueId: 20, countDrift: false, issueReads: 0, duplicatePage: false };
  const transport: typeof fetch = async (input, init) => {
    const url = String(input); state.requests.push({ url, init });
    if (url === root) return Response.json({ id: state.repoId, full_name: 'disposable/acceptance' });
    if (url === root + '/issues/3') return Response.json({ id: state.issueId, number: 3, repository_url: root,
      comments: state.comments.length + (state.countDrift && state.issueReads++ > 0 ? 1 : 0) });
    const page = Number(new URL(url).searchParams.get('page'));
    return Response.json(state.comments.slice(state.duplicatePage ? 0 : (page - 1) * 100, state.duplicatePage ? 100 : page * 100),
      { headers: { Link: '<https://untrusted.invalid/credential-trap>; rel="next"' } });
  };
  const observer = new GitHubObserver(target, { transport, token: 'private-observer-credential' });
  return { state, transport, observer };
}

describe('independent GitHub observations (synthetic transport, not acceptance)', () => {
  it('verifies simulate, apply once, reject and exact recorded reversion without exposing bodies', async () => {
    const { state, observer } = fixture();
    const before = await observer.capture(), pending = await observer.capture();
    expect(observer.verify(before, pending, { kind: 'unchanged' }).ok).toBe(true);
    state.comments.push(comment(2));
    const applied = await observer.capture();
    expect(observer.verify(pending, applied, { kind: 'created', body: 'private-observer-body' })).toEqual({ ok: true, realProvider: false, provider: 'fixture', commentId: 2 });
    const rejected = await observer.capture();
    expect(observer.verify(applied, rejected, { kind: 'unchanged' }).ok).toBe(true);
    state.comments.pop();
    const reverted = await observer.capture();
    const verdict = observer.verify(rejected, reverted, { kind: 'reverted', commentId: 2 });
    expect(verdict.ok).toBe(true);
    expect(JSON.stringify({ observer, before, applied, verdict })).not.toMatch(/private-observer|pre-existing|Bearer/);
    expect(state.requests.every(r => r.url.startsWith(root) && r.init?.method === 'GET' && r.init.redirect === 'error' && new Headers(r.init.headers).get('Cache-Control') === 'no-cache, no-store')).toBe(true);
  });

  it('fetches all pages and never follows Link headers', async () => {
    const { state, observer } = fixture();
    state.comments = Array.from({ length: 101 }, (_, i) => comment(i + 1));
    expect((await observer.capture()).comments).toBe(101);
    expect(state.requests.some(r => r.url.endsWith('page=2'))).toBe(true);
    expect(state.requests.some(r => r.url.includes('untrusted'))).toBe(false);
  });

  it.each(['repoId', 'issueId'] as const)('rejects a changed %s', async key => {
    const { state, observer } = fixture(); state[key]++;
    await expect(observer.capture()).rejects.toThrow('GITHUB_OBSERVATION_INVALID');
  });

  it('rejects count drift while paginating', async () => {
    const { state, observer } = fixture(); state.countDrift = true;
    await expect(observer.capture()).rejects.toThrow('GITHUB_OBSERVATION_INVALID');
  });

  it('rejects duplicate pagination and refuses truncated oversized issue histories', async () => {
    const { state, observer } = fixture();
    state.comments = Array.from({ length: 101 }, (_, i) => comment(i + 1)); state.duplicatePage = true;
    await expect(observer.capture()).rejects.toThrow('GITHUB_OBSERVATION_INVALID');
    state.duplicatePage = false;
    state.comments = Array.from({ length: 2000 }, (_, i) => comment(i + 1));
    await expect(observer.capture()).rejects.toThrow('GITHUB_OBSERVATION_INVALID');
  });

  it.each(['duplicate', 'wrong-author', 'unrelated-edit', 'wrong-body', 'removed-baseline'])('rejects an incorrect apply delta: %s', async kind => {
    const { state, observer } = fixture(); const before = await observer.capture();
    state.comments.push(comment(2));
    if (kind === 'duplicate') state.comments.push(comment(3));
    if (kind === 'wrong-author') state.comments[1]!.user.id = 999;
    if (kind === 'unrelated-edit') state.comments[0]!.body = 'edited';
    if (kind === 'wrong-body') state.comments[1]!.body = 'wrong';
    if (kind === 'removed-baseline') state.comments.shift();
    expect(observer.verify(before, await observer.capture(), { kind: 'created', body: 'private-observer-body' }).ok).toBe(false);
  });

  it('does not accept an old canary as a new effect or a pre-existing own comment as a reversion', async () => {
    const { state, observer } = fixture(); state.comments = [comment(1)];
    const before = await observer.capture(); state.comments.push(comment(2));
    expect(observer.verify(before, await observer.capture(), { kind: 'created', body: 'private-observer-body' }).ok).toBe(false);
    state.comments = [];
    expect(observer.verify(before, await observer.capture(), { kind: 'reverted', commentId: 1 }).ok).toBe(false);
  });

  it('rejects changed same-count snapshots, reversed receipts, copied receipts and receipts from another observer', async () => {
    const { state, observer } = fixture(); const before = await observer.capture(); state.comments[0]!.body = 'edited';
    const after = await observer.capture();
    expect(observer.verify(before, after, { kind: 'unchanged' }).ok).toBe(false);
    expect(() => observer.verify(after, before, { kind: 'unchanged' })).toThrow('GITHUB_OBSERVATION_INVALID');
    expect(() => observer.verify({ ...before }, after, { kind: 'unchanged' })).toThrow('GITHUB_OBSERVATION_INVALID');
    const foreign = await fixture().observer.capture();
    expect(() => observer.verify(foreign, after, { kind: 'unchanged' })).toThrow('GITHUB_OBSERVATION_INVALID');
  });

  it.each([301, 304, 401, 403, 429, 503])('sanitizes HTTP %s without returning the response body', async status => {
    const transport: typeof fetch = async () => new Response(status === 304 ? null : 'private-provider-error', { status });
    await expect(new GitHubObserver(target, { transport }).capture()).rejects.toThrow(/^GITHUB_OBSERVATION_UNAVAILABLE$/);
  });

  it('sanitizes transport and malformed JSON errors', async () => {
    await expect(new GitHubObserver(target, { transport: async () => { throw new Error('private-transport-error'); } }).capture()).rejects.toThrow(/^GITHUB_OBSERVATION_UNAVAILABLE$/);
    await expect(new GitHubObserver(target, { transport: async () => new Response('private-invalid-json') }).capture()).rejects.toThrow(/^GITHUB_OBSERVATION_UNAVAILABLE$/);
  });

  it('rejects host live use, path injection and unsafe numeric target IDs before any request', () => {
    expect(() => new GitHubObserver(target)).toThrow('GITHUB_OBSERVATION_INVALID');
    const { transport } = fixture();
    for (const changed of [{ owner: 'https://untrusted.invalid' }, { repo: '../escape' }, { repo: '..' }, { issueNumber: 0 }, { repositoryId: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(() => new GitHubObserver({ ...target, ...changed }, { transport })).toThrow('GITHUB_OBSERVATION_INVALID');
    }
  });
});
