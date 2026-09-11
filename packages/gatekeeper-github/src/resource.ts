import { isUtf8 } from 'node:buffer';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Value } from 'typebox/value';
import { KitGatekeeper, OverlayStore, type ActionImpl, type ObservationImpl } from '@clawos/gatekeeper-kit';
import type { ActionDescription, ApprovalQueue, GatekeeperSession, ObserverVerifier, SupportedResource } from '@clawos/shared';
import { GitHubApi, object, summary, comment, text, nodeId } from './api.js';
import { type Target, type ResourceIdentity, filePath } from './urls.js';
import { resources } from './resources.js';
import { tools } from './tools.js';
import { synchronousActions } from './approval-policy.js';
/** Pure action preview reused by the plugin declaration and bound resources. Bodies live only in preview. */
export function describeAction(tool: string, params: Record<string, unknown>, target = 'the granted GitHub resource'): ActionDescription {
    validate(tool, params);
    const kind = tool === 'gk_github_issue_create' ? 'issue.create' : tool === 'gk_github_pull_review' ? 'pull.review' : tool === 'gk_github_issue_comment' ? 'issue.comment' : 'pull.comment';
    return { title: `GitHub ${kind}`, description: `Modify ${target}.`, actionKind: { tag: `github.${kind}`, label: kind },
        autoApprovable: kind.endsWith('.comment') && !/@/.test(String(params.body)), implementsRevert: kind !== 'pull.review',
        preview: { target, ...(params.title === undefined ? {} : { title: params.title }), ...(params.body === undefined ? {} : { body: params.body }),
            ...(params.labels === undefined ? {} : { labels: params.labels }), ...(params.event === undefined ? {} : { event: params.event }) } };
}
function validate(tool: string, params: Record<string, unknown>): void {
    const schema = tools.find(t => t.name === tool)?.parameters;
    if (!schema || !Value.Check(schema, params))
        throw new Error('Invalid GitHub tool arguments.');
    if (tool === 'gk_github_repo_read_file')
        filePath(params.path);
    if (params.ref !== undefined && /[\x00-\x1f\x7f]/u.test(String(params.ref)))
        throw new Error('Invalid ref.');
}
function list(value: unknown): unknown[] { if (!Array.isArray(value))
    throw new Error('Invalid GitHub list.'); return value; }
/** Common bound implementation; subclasses expose only their reviewed resource surface. */
export class GitHubResource extends KitGatekeeper {
    resource: SupportedResource;
    protected overlay: OverlayStore;
    private readonly cachePath: string;
    private readonly snapshots = new Map<string, { queryKey: string; expires: number; value: Record<string, unknown> }>();
    private cacheGeneration = 0;
    private readonly synchronous: readonly string[];
    constructor(protected readonly target: Target, private readonly identity: ResourceIdentity, protected readonly api: GitHubApi, private readonly live: () => void, private readonly checkAccess: () => Promise<void>, stateDir: string, private readonly verifyObserver: (verifier: ObserverVerifier, target: Target) => Promise<boolean>, policy: readonly string[] = []) {
        super(join(stateDir, 'actions.json'));
        this.synchronous = synchronousActions(policy);
        mkdirSync(stateDir, { recursive: true, mode: 0o700 });
        this.resource = structuredClone(resources.find(r => r.type === target.type)!);
        this.overlay = new OverlayStore(join(stateDir, 'overlay.json'));
        this.cachePath = join(stateDir, 'cache');
        for (const tool of tools.filter(t => t.resourceType === target.type)) {
            if (tool.kind === 'observation')
                this.observations[tool.name] = this.observation(tool.name);
            else
                this.actions[tool.name] = this.action(tool.name);
        }
    }
    override async describe() { this.live(); return { resource: structuredClone(this.resource), title: this.target.key, suggestedName: `${this.target.owner}/${this.target.repo}${this.target.number ? `#${this.target.number}` : ''}` }; }
    override async getAutoApprovableActions() {
        this.live();
        return this.resource.tools.filter(t => t.endsWith('_comment') && !this.synchronous.includes(t)).map(t => ({ tag: t === 'gk_github_issue_comment' ? 'github.issue.comment' : 'github.pull.comment', label: 'Comment' }));
    }
    override async startSession(queue: ApprovalQueue): Promise<GatekeeperSession> {
        this.live();
        const session = await super.startSession(queue);
        this.live();
        return { close: () => session.close(), call: async (tool, params, ctx) => {
                this.live();
                validate(tool, params);
                try {
                    const result = await session.call(tool, params, ctx);
                    this.live();
                    return result;
                } finally {
                    if (!ctx.dryRun && this.synchronous.includes(tool)) this.invalidateCache();
                }
            } };
    }
    override async applyAction(id: number) {
        this.live();
        try { await super.applyAction(id); }
        finally { this.invalidateCache(); }
        this.live();
    }
    override async rejectAction(id: number) { this.live(); await super.rejectAction(id); }
    override async revertAction(id: number) {
        this.live();
        try { await super.revertAction(id); }
        finally { this.invalidateCache(); }
        this.live();
    }
    override async addObserver(_id: string, verifier: ObserverVerifier) {
        this.live();
        if (!await this.verifyObserver(verifier, this.target))
            throw new Error('Observer lacks access.');
        this.live();
    }
    private async authority() { this.live(); await this.checkAccess(); this.live(); }
    private invalidateCache(): void {
        this.cacheGeneration++;
        this.snapshots.clear();
    }
    private cacheKey(tool: string, params: Record<string, unknown>): string {
        const { grant: _grant, ...query } = params;
        return createHash('sha256').update(JSON.stringify([tool, query])).digest('hex');
    }
    private cacheSlot(key: string): string { return String(Number.parseInt(key.slice(0, 2), 16) % 32); }
    private cache(tool: string, params: Record<string, unknown>, value: unknown): void {
        // Never persist credentials, grants, or raw provider responses. A cache never substitutes for a fresh ACL check.
        mkdirSync(this.cachePath, { recursive: true, mode: 0o700 });
        // Fixed slots bound disk growth across restarts and arbitrarily many refs/queries.
        const path = join(this.cachePath, this.cacheSlot(this.cacheKey(tool, params)) + '.json');
        const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
        writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
        renameSync(temporary, path);
    }
    private observation(tool: string): ObservationImpl {
        return { describe: () => ({ title: `GitHub ${tool.slice(10)}`, description: `Read ${this.target.key}.`, prohibitAllSharing: true }),
            read: async (p) => {
                await this.authority();
                const key = this.cacheKey(tool, p);
                const slot = this.cacheSlot(key);
                const candidate = this.snapshots.get(slot);
                const cached = candidate?.queryKey === key ? candidate : undefined;
                const generation = this.cacheGeneration;
                const base = cached && cached.expires > Date.now() ? structuredClone(cached.value) : await this.read(tool, p);
                await this.authority();
                if (generation !== this.cacheGeneration) throw new Error('GitHub resource changed during observation.');
                if (!cached || cached.expires <= Date.now()) {
                    this.cache(tool, p, base);
                    this.snapshots.set(slot, { queryKey: key, expires: Date.now() + 30000, value: structuredClone(base) });
                }
                return this.merge(tool, p, base);
            } };
    }
    private async read(tool: string, p: Record<string, unknown>): Promise<Record<string, unknown>> {
        const root = this.target.path, number = this.target.number;
        if (tool === 'gk_github_repo_get') {
            const r = object(await this.api.request(root));
            return { name: text(r.full_name, 150), description: text(r.description, 4096), defaultBranch: text(r.default_branch, 256), private: r.private === true,
                truncated: typeof r.description === 'string' && r.description.length > 4096 };
        }
        if (tool === 'gk_github_repo_list_issues' || tool === 'gk_github_repo_list_pulls') {
            const limit = Number(p.limit ?? 30), query = new URLSearchParams({ state: String(p.state ?? 'open'), per_page: String(limit) });
            if (p.labels)
                query.set('labels', (p.labels as string[]).join(','));
            const raw = list(await this.api.request(`${root}/${tool.endsWith('issues') ? 'issues' : 'pulls'}?${query}`));
            return { items: raw.filter(v => !tool.endsWith('issues') || !object(v).pull_request).slice(0, limit).map(summary), truncated: raw.length >= limit };
        }
        if (tool === 'gk_github_repo_read_file') {
            const query = p.ref ? `?ref=${encodeURIComponent(String(p.ref))}` : '';
            const f = object(await this.api.request(`${root}/contents/${filePath(p.path)}${query}`));
            if (f.type !== 'file' || f.encoding !== 'base64' || typeof f.content !== 'string' || typeof f.size !== 'number' || f.size > 256 * 1024)
                throw new Error('File unavailable or too large.');
            const content = Buffer.from(f.content, 'base64');
            if (content.length > 256 * 1024 || content.length !== f.size || !isUtf8(content) || content.includes(0))
                throw new Error('File unavailable or too large.');
            return { path: String(p.path), content: content.toString('utf8'), sha: text(f.sha, 64), truncated: false };
        }
        if (tool === 'gk_github_pull_diff')
            return { diff: await this.api.request(`${root}/pulls/${number}`, 'GET', undefined, true), truncated: false };
        const issue = tool === 'gk_github_issue_get';
        const item = summary(await this.api.request(`${root}/${issue ? 'issues' : 'pulls'}/${number}`));
        const comments = list(await this.api.request(`${root}/issues/${number}/comments?per_page=100`));
        if (issue)
            return { ...item, comments: comments.slice(0, 100).map(comment), commentsTruncated: comments.length >= 100 };
        const reviews = list(await this.api.request(`${root}/pulls/${number}/reviews?per_page=100`));
        const reviewComments = list(await this.api.request(`${root}/pulls/${number}/comments?per_page=100`));
        return { ...item, comments: comments.slice(0, 100).map(comment), reviews: reviews.slice(0, 100).map(comment), reviewComments: reviewComments.slice(0, 100).map(comment),
            commentsTruncated: comments.length >= 100, reviewsTruncated: reviews.length >= 100, reviewCommentsTruncated: reviewComments.length >= 100 };
    }
    private merge(tool: string, p: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> {
        const value = structuredClone(base);
        for (const entry of this.overlay.list()) {
            const effect = object(entry.payload);
            if (entry.kind === 'issue' && tool === 'gk_github_repo_list_issues' && p.state !== 'closed') {
                const labels = p.labels as string[] | undefined;
                if (!labels?.every(l => (effect.labels as string[]).includes(l))) {
                    if (labels?.length)
                        continue;
                }
                const items = [effect, ...(value.items as unknown[])];
                value.items = items.slice(0, Number(p.limit ?? 30));
                value.truncated = Boolean(value.truncated) || items.length > Number(p.limit ?? 30);
            }
            if (entry.kind === 'comment' && (tool === 'gk_github_issue_get' || tool === 'gk_github_pull_get'))
                value.comments = [...value.comments as unknown[], effect];
            if (entry.kind === 'review' && tool === 'gk_github_pull_get')
                value.reviews = [...value.reviews as unknown[], effect];
        }
        for (const field of ['comments', 'reviews']) {
            if (Array.isArray(value[field]) && value[field].length > 100) {
                value[field] = value[field].slice(-100);
                value[`${field}Truncated`] = true;
            }
        }
        return value;
    }
    private action(tool: string): ActionImpl {
        const create = tool === 'gk_github_issue_create', review = tool === 'gk_github_pull_review';
        return { describe: p => ({ ...describeAction(tool, p, this.target.key),
                ...(this.synchronous.includes(tool) ? { awaitDecision: true, autoApprovable: false } : {}) }),
            simulate: (p, overlay, actionId) => {
                this.live();
                const id = overlay.nextTempId();
                const value = create ? { id, number: id, title: p.title, body: p.body ?? '', labels: p.labels ?? [], state: 'open', author: 'you', truncated: false }
                    : { id, body: p.body, author: 'you', state: review ? ({ COMMENT: 'COMMENTED', APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED' }[String(p.event)] ?? '') : '', truncated: false };
                overlay.add({ actionId, kind: create ? 'issue' : review ? 'review' : 'comment', payload: value });
                return value;
            },
            apply: async (p) => {
                await this.authority();
                let remoteId: string;
                if (create) {
                    const labelIds: string[] = [];
                    for (const label of (p.labels as string[] | undefined) ?? []) {
                        const data = await this.api.graphql('query($repo:ID!,$name:String!){node(id:$repo){... on Repository{label(name:$name){id}}}}', { repo: this.identity.repoNode, name: label });
                        labelIds.push(nodeId(object(object(data.node).label).id));
                    }
                    this.live();
                    const data = await this.api.graphql('mutation($input:CreateIssueInput!){createIssue(input:$input){issue{id}}}', { input: { repositoryId: this.identity.repoNode, title: p.title, body: p.body ?? '', labelIds } });
                    remoteId = nodeId(object(object(data.createIssue).issue).id);
                }
                else if (review) {
                    const data = await this.api.graphql('mutation($input:AddPullRequestReviewInput!){addPullRequestReview(input:$input){pullRequestReview{id}}}', { input: { pullRequestId: this.identity.itemNode, body: p.body, event: p.event } });
                    remoteId = nodeId(object(object(data.addPullRequestReview).pullRequestReview).id);
                }
                else {
                    const data = await this.api.graphql('mutation($input:AddCommentInput!){addComment(input:$input){commentEdge{node{id}}}}', { input: { subjectId: this.identity.itemNode, body: p.body } });
                    remoteId = nodeId(object(object(object(data.addComment).commentEdge).node).id);
                }
                return { remoteId };
            },
            ...(!review ? { revert: async ({ remoteId }: {
                    remoteId?: string;
                }) => {
                    const id = nodeId(remoteId);
                    await this.authority();
                    if (create) {
                        const result = await this.api.graphql('mutation($input:CloseIssueInput!){closeIssue(input:$input){issue{id state}}}', { input: { issueId: id } });
                        const issue = object(object(result.closeIssue).issue);
                        if (issue.id !== id || issue.state !== 'CLOSED') throw new Error('Issue closure unconfirmed.');
                    }
                    else {
                        const result = await this.api.graphql('mutation($input:DeleteIssueCommentInput!){deleteIssueComment(input:$input){clientMutationId}}', { input: { id } });
                        object(result.deleteIssueComment);
                    }
                } } : {}) };
    }
}
