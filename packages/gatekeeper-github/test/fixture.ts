import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHubAccount, type Verifiers } from '../src/account.js';
import { GitHubApi, type Transport } from '../src/api.js';
/** Pure in-memory provider fixture. No network or personal identity is used. */
export function fixture() {
  const state = { repoId: 10, issueId: 20, status: 200, failWrite: false, calls: [] as Array<{ url: URL; method: string; body: Record<string, unknown> }>, comments: [] as Record<string, unknown>[], reviews: [] as Record<string, unknown>[], issues: [] as Record<string, unknown>[] };
  const issue = () => ({ id: state.issueId, node_id: `I_${state.issueId}`, number: 12, title: 'Fixture issue', body: 'description', state: 'open', user: { login: 'fixture' }, labels: [] });
  const pull = () => ({ ...issue(), head: { sha: 'fixture' }, pull_request: {} });
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const transport: Transport = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    state.calls.push({ url, method, body });
    if (url.origin !== 'https://api.github.com') throw new Error('Wrong origin');
    if (state.status !== 200) return response({ message: 'private vendor error' }, state.status);
    if (method !== 'GET' && state.failWrite) throw new Error('Uncertain write with secret');
    const path = url.pathname;
    if (path === '/graphql') {
      const query = String(body.query), input = (body.variables as Record<string, unknown>).input as Record<string, unknown>;
      if (query.startsWith('query')) return response({ data: { node: { label: { id: 'L_1' } } } });
      if (query.includes('createIssue(')) {
        const value = { ...issue(), title: input.title, body: input.body, labels: [], id: 30 + state.issues.length, number: 30 + state.issues.length }; state.issues.push(value);
        return response({ data: { createIssue: { issue: { id: `I_${value.id}` } } } });
      }
      if (query.includes('addComment(')) {
        const value = { id: 100 + state.comments.length, body: input.body, user: { login: 'fixture' } }; state.comments.push(value);
        return response({ data: { addComment: { commentEdge: { node: { id: `C_${value.id}` } } } } });
      }
      if (query.includes('addPullRequestReview(')) {
        const value = { id: 200 + state.reviews.length, body: input.body, state: input.event, user: { login: 'fixture' } }; state.reviews.push(value);
        return response({ data: { addPullRequestReview: { pullRequestReview: { id: `V_${value.id}` } } } });
      }
      if (query.includes('closeIssue(')) { const value = state.issues.find(i => `I_${i.id}` === input.issueId); if (value) value.state = 'closed'; return response({ data: { closeIssue: { issue: { id: input.issueId, state: 'CLOSED' } } } }); }
      if (query.includes('deleteIssueComment(')) { state.comments = state.comments.filter(c => `C_${c.id}` !== input.id); return response({ data: { deleteIssueComment: { clientMutationId: null } } }); }
      return response({ errors: [{ message: 'private provider error' }] });
    }
    if (path === '/user') return response({ id: 99, login: 'fixture' });
    if (path === '/repos/org/repo') return response({ id: state.repoId, node_id: `R_${state.repoId}`, full_name: 'org/repo', default_branch: 'main', private: true, description: 'Fixture repo' });
    if (method === 'DELETE') { state.comments = state.comments.filter(c => String(c.id) !== path.split('/').at(-1)); return new Response(null, { status: 204 }); }
    if (method === 'PATCH') { const i = state.issues.find(i => String(i.number) === path.split('/').at(-1)); if (i) i.state = 'closed'; return response(i); }
    if (path.endsWith('/contents/README.md')) return response({ type: 'file', encoding: 'base64', content: Buffer.from('hello').toString('base64'), size: 5, sha: 'abc' });
    if (path === '/repos/org/repo/issues' && method === 'POST') { const value = { ...issue(), ...body, id: 30 + state.issues.length, number: 30 + state.issues.length }; state.issues.push(value); return response(value); }
    if (path.endsWith('/comments')) {
      if (method === 'POST') { const value = { id: 100 + state.comments.length, body: body.body, user: { login: 'fixture' } }; state.comments.push(value); return response(value); }
      return response(state.comments);
    }
    if (path.endsWith('/reviews')) {
      if (method === 'POST') { const value = { id: 200 + state.reviews.length, body: body.body, state: body.event, user: { login: 'fixture' } }; state.reviews.push(value); return response(value); }
      return response(state.reviews);
    }
    if (path === '/repos/org/repo/issues/12') return response(issue());
    if (path === '/repos/org/repo/pulls/12') {
      if (new Headers(init?.headers).get('Accept') === 'application/vnd.github.diff') return new Response('diff --git a/a b/a\n+hello');
      return response(pull());
    }
    if (path === '/repos/org/repo/issues') return response([issue(), ...state.issues, pull()]);
    if (path === '/repos/org/repo/pulls') return response([pull()]);
    return response({ message: 'Unknown fixture endpoint' }, 404);
  };
  const dir = mkdtempSync(join(tmpdir(), 'github-fixture-')), verifiers: Verifiers = new Map();
  const account = new GitHubAccount(new GitHubApi(() => 'fixture-credential', transport), 'fixture', ['repo', 'issue', 'pull'], dir, () => {}, verifiers);
  return { state, transport, account, dir, verifiers };
}
