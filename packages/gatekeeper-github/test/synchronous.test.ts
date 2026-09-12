import { describe, expect, it } from 'vitest';
import { TestApprovalQueue } from '@clawos/gatekeeper-kit';
import { synchronousActions } from '../src/approval-policy.js';
import { GitHubAccount } from '../src/account.js';
import { GitHubApi } from '../src/api.js';
import { fixture } from './fixture.js';

const tool = 'gk_github_issue_comment', params = { grant: 'g', body: 'native fixture comment' };
async function setup(policy?: readonly string[]) {
  const f = fixture();
  const account = new GitHubAccount(new GitHubApi(() => 'fixture', f.transport), 'fixture', ['issue'], f.dir, () => {}, f.verifiers, policy);
  const { gatekeeper } = await account.getGatekeeperFor('https://github.com/org/repo/issues/12');
  const queue = new TestApprovalQueue(), session = await gatekeeper.startSession(queue);
  return { ...f, gatekeeper, queue, session };
}
describe('operator-only synchronous action policy', () => {
  it.each([null, true, 'all', ['all'], ['gk_github_issue_get'], [tool, tool], [42]])('rejects invalid policy %#', value => {
    expect(() => synchronousActions(value)).toThrow('Invalid GitHub synchronous action policy.');
  });
  it('copies and freezes policy; default remains deferred simulation', async () => {
    const selected = [tool], copied = synchronousActions(selected); selected.length = 0;
    expect(copied).toEqual([tool]); expect(Object.isFrozen(copied)).toBe(true);
    const f = await setup();
    await f.session.call(tool, params, f.queue.context());
    expect(f.state.comments).toHaveLength(0); expect(f.queue.actions).toHaveLength(1);
    expect(f.queue.actions[0]!.description.awaitDecision).not.toBe(true);
  });
  it('requires exact native approval and applies once without leaving stale read cache', async () => {
    const f = await setup([tool]), ctx = f.queue.context();
    expect(await f.session.call(tool, params, { ...ctx, dryRun: true })).toMatchObject({ kind: 'action', description: { awaitDecision: true, autoApprovable: false } });
    expect(await f.gatekeeper.getAutoApprovableActions()).toEqual([]);
    await expect(f.session.call(tool, params, ctx)).rejects.toThrow();
    expect(f.state.comments).toHaveLength(0); expect(f.queue.actions).toHaveLength(0);
    await f.session.call('gk_github_issue_get', { grant: 'g' }, f.queue.context('read'));
    const approved = { ...ctx, actionApproval: { toolCallId: ctx.toolCallId!, tool, params } };
    await expect(f.session.call(tool, { ...params, body: 'changed' }, approved)).rejects.toThrow();
    await f.session.call(tool, params, approved);
    expect(f.state.comments).toHaveLength(1);
    expect(await f.session.call('gk_github_issue_get', { grant: 'g' }, f.queue.context('read2'))).toMatchObject({ details: { comments: [{ body: params.body }] } });
    await expect(f.session.call(tool, params, approved)).rejects.toThrow();
    expect(f.state.comments).toHaveLength(1);
  });
});
