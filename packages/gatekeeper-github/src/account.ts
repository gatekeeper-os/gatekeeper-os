import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { GatekeeperAccount, ObserverVerifier } from '@clawos/shared';
import { GitHubApi, GitHubError, identifier, nodeId, object, text } from './api.js';
import { type Target, type ResourceIdentity, parseTarget } from './urls.js';
import { resources } from './resources.js';
import { RepoGatekeeper } from './repo.js';
import { IssueGatekeeper } from './issue.js';
import { PullGatekeeper } from './pull.js';
import type { GitHubResource } from './resource.js';
import { synchronousActions } from './approval-policy.js';
/** Opaque per-vendor verifier registry. No credential is serialized in a verifier. */
export type Verifiers = Map<string, (target: Target) => Promise<boolean>>;
/** Check repository and exact resource kind using this account's credentials. */
export async function inspect(api: GitHubApi, target: Target): Promise<ResourceIdentity> {
    const repo = object(await api.request(target.path));
    if (text(repo.full_name).toLowerCase() !== `${target.owner}/${target.repo}`)
        throw new GitHubError(403);
    const result = { repo: identifier(repo.id), repoNode: nodeId(repo.node_id) };
    if (target.type === 'repo')
        return result;
    const item = object(await api.request(`${target.path}/${target.type === 'issue' ? 'issues' : 'pulls'}/${target.number}`));
    if (identifier(item.number) !== target.number || (target.type === 'issue' && item.pull_request) || (target.type === 'pull' && !item.head))
        throw new GitHubError(403);
    return { ...result, item: identifier(item.id), itemNode: nodeId(item.node_id) };
}
/** Revocable account; operator-validated introductions never create agent grants or sessions. */
export class GitHubAccount implements GatekeeperAccount {
    private active = true;
    private readonly retained = new Map<string, GitHubResource>();
    private readonly verifierIds = new Set<string>();
    private readonly synchronous: readonly string[];
    constructor(private readonly api: GitHubApi, private readonly login: string, private readonly enabled: string[], private readonly stateDir: string, private readonly removeCredential: () => void, private readonly verifiers: Verifiers, policy: readonly string[] = []) {
        this.synchronous = synchronousActions(policy);
    }
    assertLive = () => {
        if (!this.active) throw new Error('GitHub account unavailable.');
    };
    async describe() { this.assertLive(); return { displayName: this.login }; }
    async getSupportedResources() { this.assertLive(); return structuredClone(resources.filter(r => this.enabled.includes(r.type))); }
    async getGatekeeperFor(url: string) {
        this.assertLive();
        const target = parseTarget(url);
        if (!this.enabled.includes(target.type))
            throw new Error('Resource type not connected.');
        const identity = await inspect(this.api, target);
        this.assertLive();
        let gatekeeper = this.retained.get(target.key);
        if (!gatekeeper) {
            const check = async () => {
                this.assertLive();
                const current = await inspect(this.api, target);
                this.assertLive();
                if (current.repo !== identity.repo || current.item !== identity.item || current.repoNode !== identity.repoNode || current.itemNode !== identity.itemNode)
                    throw new Error('GitHub resource identity changed.');
            };
            const Constructor = target.type === 'repo' ? RepoGatekeeper : target.type === 'issue' ? IssueGatekeeper : PullGatekeeper;
            gatekeeper = new Constructor(target, identity, this.api, this.assertLive, check, join(this.stateDir, createHash('sha256').update(JSON.stringify([target.key, identity])).digest('hex')), async (verifier, resource) => {
                this.assertLive();
                const verify = verifier.vendor === 'github' ? this.verifiers.get(verifier.opaque) : undefined;
                return verify ? verify(resource) : false;
            }, this.synchronous);
            this.retained.set(target.key, gatekeeper);
        }
        // Retained objects check their original identity on every observation and application.
        return { gatekeeper, resource: structuredClone(resources.find(r => r.type === target.type)!), resourceKey: target.key };
    }
    async getVerifier(): Promise<ObserverVerifier> {
        this.assertLive();
        const opaque = randomBytes(32).toString('base64url');
        this.verifiers.set(opaque, async (target) => {
            this.assertLive();
            if (!this.enabled.includes(target.type))
                return false;
            try {
                await inspect(this.api, target);
                this.assertLive();
                return true;
            }
            catch (error) {
                // A rate-limited 403 is not a reliable negative ACL result. Transport marks it 429.
                if (error instanceof GitHubError && (error.status === 403 || error.status === 404))
                    return false;
                throw error;
            }
        });
        this.verifierIds.add(opaque);
        return { vendor: 'github', opaque };
    }
    /** Invalidate retained sessions before removing encrypted credentials. */
    async revoke() {
        if (!this.active) return;
        this.deactivate();
        this.removeCredential();
    }
    /** Vendor reconnection invalidates old objects without deleting newly stored credentials. */
    deactivate() {
        this.active = false;
        for (const id of this.verifierIds) this.verifiers.delete(id);
        this.verifierIds.clear();
        this.retained.clear();
    }
    async reconnect(): Promise<{
        url: string;
    }> { throw new Error('Start reconnection through the authenticated gatekeeper connect command.'); }
}
