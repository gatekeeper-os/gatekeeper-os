import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TokenStore, type VendorContext } from '@clawos/gatekeeper-kit';
import type { GatekeeperVendor } from '@clawos/shared';
import { GitHubAccount, type Verifiers } from './account.js';
import { boundedBody, GitHubApi, identifier, object, text, type Transport } from './api.js';
import { resources } from './resources.js';
import { tools } from './tools.js';
interface Credential {
    version: 1;
    token: string;
    id: number;
    login: string;
    resourceTypes: string[];
    expiresAt?: number;
    refreshToken?: string;
    refreshExpiresAt?: number;
}
interface Pending {
    operator: string;
    verifier: string;
    redirect: string;
    expires: number;
    resourceTypes: string[];
    previousId?: number;
    generation: number;
}
/** Web OAuth/PKCE adapter. Kernel OAuthNonceMachine owns the two-stage state nonce. */
export class GitHubVendor implements GatekeeperVendor {
    vendor = 'github' as const;
    apiVersion = 1 as const;
    private readonly store: TokenStore;
    private readonly pending = new Map<string, Pending>();
    private readonly accounts = new Map<string, GitHubAccount>();
    private readonly generations = new Map<string, number>();
    private readonly verifiers: Verifiers = new Map();
    private readonly clientId: string;
    private readonly origin: string;
    constructor(private readonly ctx: VendorContext, private readonly transport: Transport = fetch, private readonly now: () => number = Date.now) {
        const c = ctx.pluginConfig;
        if (typeof c.clientId !== 'string' || !/^[A-Za-z0-9_.-]{1,256}$/.test(c.clientId) || typeof c.publicOrigin !== 'string')
            throw new Error('GitHub OAuth configuration required.');
        const origin = new URL(c.publicOrigin);
        if (origin.origin !== c.publicOrigin || origin.username || origin.password || !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))))
            throw new Error('Invalid OAuth public origin.');
        if (c.apiBase !== undefined && c.apiBase !== 'https://api.github.com')
            throw new Error('Only GitHub.com is supported.');
        this.clientId = c.clientId;
        this.origin = origin.origin;
        const fd = openSync(join(ctx.stateDir, 'os', 'cell.key'), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const stat = fstatSync(fd);
            if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()))
                throw new Error('Private cell key required.');
            // clawos install writes a base64-encoded 32-byte key, not raw bytes.
            const encoded = readFileSync(fd, 'utf8').trim();
            if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error('Invalid cell key format.');
            const key = Buffer.from(encoded, 'base64');
            try { this.store = new TokenStore(join(ctx.stateDir, 'os', 'gatekeepers', 'github', 'accounts'), key); }
            finally { key.fill(0); }
        }
        finally {
            closeSync(fd);
        }
    }
    async describe() { return { title: 'GitHub', description: 'Repositories, issues, and pull requests.' }; }
    private credential(operator: string): Credential | null {
        const value = this.store.get<Credential>(operator);
        if (!value)
            return null;
        if (value.version !== 1 || !value.token || !value.login || !Number.isSafeInteger(value.id) || value.id < 1 || !Array.isArray(value.resourceTypes) || value.resourceTypes.some(t => !resources.some(r => r.type === t)))
            throw new Error('Invalid GitHub credential record.');
        return value;
    }
    private secret(): string {
        // The supported env/default SecretRef subset is explicit. No plaintext config fallback or exec evaluation.
        const ref = this.ctx.pluginConfig.clientSecret;
        if (!ref || typeof ref !== 'object' || Array.isArray(ref))
            throw new Error('GitHub client secret reference required.');
        const r = ref as Record<string, unknown>;
        if (r.source !== 'env' || r.provider !== 'default' || typeof r.id !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(r.id) || Object.keys(r).some(k => !['source', 'provider', 'id'].includes(k)))
            throw new Error('Unsupported GitHub client secret reference.');
        const secret = process.env[r.id];
        if (!secret || /[\r\n]/u.test(secret))
            throw new Error('GitHub client secret unavailable.');
        return secret;
    }
    async connectAccount(operator: string, opts?: {
        resourceTypes?: string[];
        state?: string;
        callbackPath?: string;
    }): Promise<{
        url: string;
    }> {
        if (!operator || operator.length > 512 || !opts?.state || !/^[A-Za-z0-9_-]{20,256}$/.test(opts.state) || opts.callbackPath !== '/os/gatekeeper/github/oauth/callback')
            throw new Error('Kernel authorization binding required.');
        const types = opts.resourceTypes ?? resources.map(r => r.type);
        if (!types.length || new Set(types).size !== types.length || types.some(t => !resources.some(r => r.type === t)))
            throw new Error('Unsupported resource type.');
        this.secret();
        for (const [state, pending] of this.pending)
            if (pending.expires <= this.now() || pending.operator === operator)
                this.pending.delete(state);
        if (this.pending.size >= 128 || this.pending.has(opts.state))
            throw new Error('Connection unavailable.');
        const verifier = randomBytes(32).toString('base64url'), redirect = `${this.origin}${opts.callbackPath}`, previous = this.credential(operator);
        const generation = (this.generations.get(operator) ?? 0) + 1;
        this.generations.set(operator, generation);
        this.pending.set(opts.state, { operator, verifier, redirect, expires: this.now() + 600000, resourceTypes: [...types], generation, ...(previous ? { previousId: previous.id } : {}) });
        const query = new URLSearchParams({ client_id: this.clientId, redirect_uri: redirect, scope: 'repo', state: opts.state,
            code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        return { url: `https://github.com/login/oauth/authorize?${query}` };
    }
    async completeConnection(operator: string, opts: {
        code: string;
        state: string;
        resourceTypes?: string[];
    }): Promise<void> {
        const pending = this.pending.get(opts.state);
        this.pending.delete(opts.state);
        if (!pending || pending.operator !== operator || pending.expires <= this.now() || pending.generation !== this.generations.get(operator) ||
            !opts.code || opts.code.length > 1024 || /[\x00-\x20\x7f]/u.test(opts.code) ||
            (opts.resourceTypes && JSON.stringify(opts.resourceTypes) !== JSON.stringify(pending.resourceTypes)))
            throw new Error('Invalid GitHub callback.');
        try {
            const response = await this.transport('https://github.com/login/oauth/access_token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
                headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: this.clientId, client_secret: this.secret(), code: opts.code, redirect_uri: pending.redirect, code_verifier: pending.verifier }).toString() });
            if (!response.ok) {
                await response.body?.cancel();
                throw new Error();
            }
            const data = object(JSON.parse(await boundedBody(response, 16384)));
            if (data.error || typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 4096 || String(data.token_type).toLowerCase() !== 'bearer' || !String(data.scope).split(/[ ,]+/u).includes('repo'))
                throw new Error();
            const token = data.access_token, expiration = this.expiration(data);
            const identity = object(await new GitHubApi(() => token, this.transport).request('/user'));
            const id = identifier(identity.id), login = text(identity.login, 100);
            if (!login || (pending.previousId !== undefined && id !== pending.previousId) || pending.generation !== this.generations.get(operator))
                throw new Error();
            this.store.put(operator, { version: 1, token, id, login, resourceTypes: pending.resourceTypes, ...expiration } satisfies Credential);
            this.accounts.get(operator)?.deactivate();
            this.accounts.delete(operator);
        }
        catch {
            throw new Error('GitHub connection failed.');
        }
    }
    private expiration(data: Record<string, unknown>): Pick<Credential, 'expiresAt' | 'refreshToken' | 'refreshExpiresAt'> {
        if (data.expires_in === undefined && data.refresh_token === undefined)
            return {};
        if (!Number.isSafeInteger(data.expires_in) || Number(data.expires_in) < 1 || typeof data.refresh_token !== 'string' || !data.refresh_token || data.refresh_token.length > 4096 ||
            !Number.isSafeInteger(data.refresh_token_expires_in) || Number(data.refresh_token_expires_in) < 1)
            throw new Error('Invalid token expiry.');
        return { expiresAt: this.now() + Number(data.expires_in) * 1000, refreshToken: data.refresh_token, refreshExpiresAt: this.now() + Number(data.refresh_token_expires_in) * 1000 };
    }
    private async accessToken(operator: string): Promise<string> {
        let record = this.credential(operator);
        if (!record)
            throw new Error('GitHub account unavailable.');
        if (record.expiresAt !== undefined && record.expiresAt <= this.now() + 60000) {
            const previous = record;
            record = await this.store.refresh(operator, async () => {
                if (!previous.refreshToken || !previous.refreshExpiresAt || previous.refreshExpiresAt <= this.now())
                    throw new Error('GitHub reconnection required.');
                const response = await this.transport('https://github.com/login/oauth/access_token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
                    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ client_id: this.clientId, client_secret: this.secret(), grant_type: 'refresh_token', refresh_token: previous.refreshToken }).toString() });
                if (!response.ok) {
                    await response.body?.cancel();
                    throw new Error('GitHub refresh failed.');
                }
                const data = object(JSON.parse(await boundedBody(response, 16384)));
                if (data.error || typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 4096 || String(data.token_type).toLowerCase() !== 'bearer' || !String(data.scope).split(/[ ,]+/u).includes('repo'))
                    throw new Error('GitHub refresh failed.');
                const token = data.access_token, expiration = this.expiration(data);
                if (!expiration.expiresAt)
                    throw new Error('GitHub refresh failed.');
                const identity = object(await new GitHubApi(() => token, this.transport).request('/user'));
                if (identifier(identity.id) !== previous.id)
                    throw new Error('GitHub refresh identity mismatch.');
                return { version: 1, token, id: previous.id, login: text(identity.login, 100), resourceTypes: previous.resourceTypes, ...expiration } satisfies Credential;
            });
        }
        return record.token;
    }
    async getAccount(operator: string): Promise<GitHubAccount | null> {
        const credential = this.credential(operator);
        if (!credential)
            return null;
        let account = this.accounts.get(operator);
        if (!account) {
            const api = new GitHubApi(async () => {
                account!.assertLive();
                const token = await this.accessToken(operator);
                account!.assertLive();
                return token;
            }, this.transport);
            const stateDir = join(this.ctx.stateDir, 'os', 'gatekeepers', 'github', 'resources',
                createHash('sha256').update(JSON.stringify([operator, credential.id])).digest('hex'));
            const remove = () => {
                this.store.remove(operator);
                this.accounts.delete(operator);
                this.generations.set(operator, (this.generations.get(operator) ?? 0) + 1);
                for (const [state, pending] of this.pending) {
                    if (pending.operator === operator) this.pending.delete(state);
                }
            };
            account = new GitHubAccount(api, credential.login, credential.resourceTypes, stateDir, remove, this.verifiers);
            this.accounts.set(operator, account);
        }
        return account;
    }
    async getSupportedResources() { return structuredClone(resources); }
    async getTools() { return structuredClone(tools); }
}
