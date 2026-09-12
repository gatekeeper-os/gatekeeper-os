import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TestApprovalQueue } from '@clawos/gatekeeper-kit';
import type { DryRunResult, ToolResult } from '@clawos/shared';
import { fixture } from './fixture.js';
import { GitHubAccount } from '../src/account.js';
import { GitHubApi } from '../src/api.js';
function details(result: ToolResult | DryRunResult): Record<string, unknown> { if ('kind' in result) throw new Error('not a result'); return result.details as Record<string, unknown>; }
const readCases = [
  ['repo', 'gk_github_repo_get', {}], ['repo', 'gk_github_repo_list_issues', {}], ['repo', 'gk_github_repo_list_pulls', {}], ['repo', 'gk_github_repo_read_file', { path: 'README.md' }],
  ['issue', 'gk_github_issue_get', {}], ['pull', 'gk_github_pull_get', {}], ['pull', 'gk_github_pull_diff', {}],
] as const;
const url = (type: string) => `https://github.com/org/repo${type === 'repo' ? '' : type === 'issue' ? '/issues/12' : '/pull/12'}`;
describe('kernel-authorized observations', () => {
  it.each(readCases)('%s %s awaits queue and refuses revoked/foreign/shared authority', async (type, tool, params) => {
    const f = fixture(), bound = await f.account.getGatekeeperFor(url(type)), q = new TestApprovalQueue(), s = await bound.gatekeeper.startSession(q);
    q.denyObservations = true; const before = f.state.calls.length;
    await expect(s.call(tool, { grant: 'g', ...params }, q.context())).rejects.toThrow(); expect(f.state.calls.length).toBe(before);
    q.denyObservations = false;
    await s.call(tool, { grant: 'g', ...params }, { ...q.context(), dryRun: true }); expect(f.state.calls.length).toBe(before);
    const result = await s.call(tool, { grant: 'g', ...params }, q.context()); expect(details(result)).toBeTruthy(); expect(q.observations).toHaveLength(1);
    await expect(s.call(tool, { grant: 'g', ...params }, { ...q.context(), observers: ['guest'] })).rejects.toThrow();
    await expect(s.call(tool, { grant: 'g', ...params }, { ...q.context(), queue: new TestApprovalQueue() })).rejects.toThrow();
    await expect(s.call(tool, { grant: 'g', ...params, token: 'override' }, q.context())).rejects.toThrow();
    await s.close(); await expect(s.call(tool, { grant: 'g', ...params }, q.context())).rejects.toThrow();
  });
  it('uses bounded snapshots without skipping authorization or refreshing overlays', async () => {
    const f = fixture(), { gatekeeper } = await f.account.getGatekeeperFor(url('issue')), q = new TestApprovalQueue(), session = await gatekeeper.startSession(q);
    await session.call('gk_github_issue_get', { grant: 'g' }, q.context('read1'));
    const fetched = () => f.state.calls.filter(c => c.url.pathname.endsWith('/comments')).length;
    const before = fetched();
    await session.call('gk_github_issue_get', { grant: 'g' }, q.context('read2'));
    expect(fetched()).toBe(before); expect(q.observations).toHaveLength(2);
    f.state.status = 403;
    await expect(session.call('gk_github_issue_get', { grant: 'g' }, q.context('denied'))).rejects.toThrow();
    f.state.status = 200;
    await session.call('gk_github_issue_comment', { grant: 'g', body: 'invalidate on effect' }, q.context('comment'));
    await gatekeeper.applyAction(1);
    const value = details(await session.call('gk_github_issue_get', { grant: 'g' }, q.context('read3')));
    expect(fetched()).toBe(before + 1); expect(JSON.stringify(value.comments)).toContain('invalidate on effect');
  });
  it('bounds query caches across restarts without serving a colliding ref', async () => {
    const f = fixture();
    const transport: typeof fetch = async (input, init) => {
      const request = new URL(String(input));
      if (request.pathname.endsWith('/contents/README.md')) {
        const content = request.searchParams.get('ref') ?? 'main';
        return new Response(JSON.stringify({ type: 'file', encoding: 'base64', content: Buffer.from(content).toString('base64'), size: Buffer.byteLength(content), sha: 'abc' }));
      }
      return f.transport(input, init);
    };
    for (let pass = 0; pass < 2; pass++) {
      const account = new GitHubAccount(new GitHubApi(() => 'fixture', transport), 'fixture', ['repo'], f.dir, () => {}, f.verifiers);
      const { gatekeeper } = await account.getGatekeeperFor(url('repo'));
      const q = new TestApprovalQueue(), session = await gatekeeper.startSession(q);
      for (let i = 0; i < 80; i++) {
        const ref = `branch-${pass}-${i}`;
        expect(details(await session.call('gk_github_repo_read_file', { grant: 'g', path: 'README.md', ref }, q.context(ref))).content).toBe(ref);
      }
      const resource = readdirSync(f.dir)[0]!;
      expect(readdirSync(join(f.dir, resource, 'cache')).length).toBeLessThanOrEqual(32);
      await session.close();
    }
  });
  it('issue listing excludes pull requests', async () => {
    const f = fixture(), { gatekeeper } = await f.account.getGatekeeperFor(url('repo')), q = new TestApprovalQueue(), s = await gatekeeper.startSession(q);
    expect(details(await s.call('gk_github_repo_list_issues', { grant: 'g' }, q.context())).items).toHaveLength(1);
  });
});
const writes = [
  ['repo', 'gk_github_issue_create', { title: 'new issue', body: 'private action body', labels: ['bug'] }, 'gk_github_repo_list_issues', 'items'],
  ['issue', 'gk_github_issue_comment', { body: 'private action body' }, 'gk_github_issue_get', 'comments'],
  ['pull', 'gk_github_pull_comment', { body: 'private action body' }, 'gk_github_pull_get', 'comments'],
  ['pull', 'gk_github_pull_review', { body: 'private action body', event: 'APPROVE' }, 'gk_github_pull_get', 'reviews'],
] as const;
describe('deferred writes, recovery, and truthful reversibility', () => {
  it.each(writes)('%s %s simulates, rejects, applies once, and has truthful revert', async (type, tool, params, read, field) => {
    const f = fixture(), { gatekeeper } = await f.account.getGatekeeperFor(url(type)), q = new TestApprovalQueue(), s = await gatekeeper.startSession(q);
    await s.call(tool, { grant: 'g', ...params }, { ...q.context(), dryRun: true }); expect(q.actions).toHaveLength(0);
    await s.call(tool, { grant: 'g', ...params }, q.context('first')); expect(q.actions).toHaveLength(1);
    expect(f.state.calls.filter(c => c.method !== 'GET')).toHaveLength(0);
    expect(JSON.stringify(details(await s.call(read, { grant: 'g' }, q.context('read')))[field])).toContain('private action body');
    expect(q.actions[0]!.description.description).not.toContain('private action body');
    expect(q.actions[0]!.description.preview).toMatchObject({ body: 'private action body', target: url(type) });
    await gatekeeper.rejectAction(1);
    expect(JSON.stringify(details(await s.call(read, { grant: 'g' }, q.context('read2')))[field])).not.toContain('private action body');
    await s.call(tool, { grant: 'g', ...params }, q.context('second'));
    await gatekeeper.applyAction(2); await gatekeeper.applyAction(2);
    expect(f.state.calls.filter(c => c.method === 'POST' && String(c.body.query).startsWith('mutation'))).toHaveLength(1);
    expect(JSON.stringify(details(await s.call(read, { grant: 'g' }, q.context('read3')))[field])).toContain('private action body');
    if (tool.endsWith('review')) { expect(q.actions[1]!.description.implementsRevert).toBe(false); await expect(gatekeeper.revertAction!(2)).rejects.toThrow(); }
    else {
      await gatekeeper.revertAction!(2); await gatekeeper.revertAction!(2);
      expect(f.state.calls.filter(c => String(c.body.query).includes('closeIssue(') || String(c.body.query).includes('deleteIssueComment('))).toHaveLength(1);
      if (type === 'repo') expect(f.state.issues[0]!.state).toBe('closed'); else expect(f.state.comments).toHaveLength(0);
    }
  });
  it('restores pending overlays with the same resource and account identity', async () => {
    const f = fixture(), { gatekeeper } = await f.account.getGatekeeperFor(url('issue')), q = new TestApprovalQueue(), s = await gatekeeper.startSession(q);
    await s.call('gk_github_issue_comment', { grant: 'g', body: 'persistent comment' }, q.context()); await s.close();
    const restored = new GitHubAccount(new GitHubApi(() => 'fixture', f.transport), 'fixture', ['issue'], f.dir, () => {}, f.verifiers);
    const r = await restored.getGatekeeperFor(url('issue')), q2 = new TestApprovalQueue(), s2 = await r.gatekeeper.startSession(q2);
    expect(JSON.stringify(details(await s2.call('gk_github_issue_get', { grant: 'g' }, q2.context())))).toContain('persistent comment');
    await r.gatekeeper.rejectAction(1);
    expect(JSON.stringify(details(await s2.call('gk_github_issue_get', { grant: 'g' }, q2.context())))).not.toContain('persistent comment');
  });
  it('does not retry uncertain remote writes and preserves decision order', async () => {
    const f = fixture(), { gatekeeper } = await f.account.getGatekeeperFor(url('issue')), q = new TestApprovalQueue(), s = await gatekeeper.startSession(q);
    await s.call('gk_github_issue_comment', { grant: 'g', body: 'one' }, q.context('1'));
    await s.call('gk_github_issue_comment', { grant: 'g', body: 'two' }, q.context('2'));
    await expect(gatekeeper.applyAction(2)).rejects.toThrow(); expect(f.state.calls.filter(c => c.method === 'POST' && String(c.body.query).startsWith('mutation'))).toHaveLength(0);
    f.state.failWrite = true; await expect(gatekeeper.applyAction(1)).rejects.toThrow(); await expect(gatekeeper.applyAction(1)).rejects.toThrow();
    expect(f.state.calls.filter(c => c.method === 'POST' && String(c.body.query).startsWith('mutation'))).toHaveLength(1);
  });
  it('keeps node-bound writes on the original target if its name is reused after the identity check', async () => {
    const f = fixture();
    const transport: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/graphql')) f.state.repoId = 999;
      return f.transport(input, init);
    };
    const account = new GitHubAccount(new GitHubApi(() => 'fixture', transport), 'fixture', ['repo'], f.dir + '/node-race', () => {}, f.verifiers);
    const { gatekeeper } = await account.getGatekeeperFor(url('repo')), q = new TestApprovalQueue(), session = await gatekeeper.startSession(q);
    await session.call('gk_github_issue_create', { grant: 'g', title: 'bound issue' }, q.context());
    await gatekeeper.applyAction(1);
    const mutation = f.state.calls.find(c => String(c.body.query).includes('createIssue('))!;
    expect((mutation.body.variables as { input: { repositoryId: string } }).input.repositoryId).toBe('R_10');
    expect(mutation.url.pathname).toBe('/graphql');
    await expect(session.call('gk_github_repo_get', { grant: 'g' }, q.context())).rejects.toThrow();
  });
  it('bounds accumulated pending comments while preserving recent effects and truncation', async () => {
    const f = fixture(), { gatekeeper } = await f.account.getGatekeeperFor(url('issue')), q = new TestApprovalQueue(), session = await gatekeeper.startSession(q);
    f.state.comments = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, body: 'remote', user: { login: 'fixture' } }));
    await session.call('gk_github_issue_comment', { grant: 'g', body: 'latest own effect' }, q.context());
    const value = details(await session.call('gk_github_issue_get', { grant: 'g' }, q.context('read')));
    expect(value.comments).toHaveLength(100); expect(value.commentsTruncated).toBe(true);
    expect(JSON.stringify(value.comments)).toContain('latest own effect');
  });
  it('denies retained pending writes after account revocation without touching provider', async () => {
    const f = fixture(), { gatekeeper } = await f.account.getGatekeeperFor(url('issue')), q = new TestApprovalQueue(), s = await gatekeeper.startSession(q);
    await s.call('gk_github_issue_comment', { grant: 'g', body: 'one' }, q.context()); await f.account.revoke();
    await expect(gatekeeper.applyAction(1)).rejects.toThrow(); expect(f.state.calls.filter(c => c.method === 'POST' && String(c.body.query).startsWith('mutation'))).toHaveLength(0);
  });
});
