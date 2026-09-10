import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitHubVendor } from '../src/vendor.js';
import { OAuthNonceMachine } from '@clawos/gatekeeper-kit';
import type { Transport } from '../src/api.js';
import { fixture } from './fixture.js';
const fakeSecret = 'offline-app-secret-marker';
const fakeToken = 'offline-access-token-marker';
function setup() {
  vi.stubEnv('CLAWOS_TEST_APP_SECRET', fakeSecret);
  const dir = mkdtempSync(join(tmpdir(), 'github-auth-')); mkdirSync(join(dir, 'os'), { mode: 0o700 }); writeFileSync(join(dir, 'os', 'cell.key'), randomBytes(32).toString('base64') + '\n', { mode: 0o600 });
  const calls: Array<{ url: string; body: URLSearchParams }> = [], f = fixture();
  const state = { now: Date.now(), user: 99, scope: 'repo', expiring: false, refreshCount: 0, failToken: false, block: undefined as (() => Promise<void>) | undefined };
  const transport: Transport = async (input, init) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = new URLSearchParams(String(init?.body)); calls.push({ url, body });
      if (body.has('refresh_token')) { state.refreshCount++; await state.block?.(); }
      if (state.failToken) return new Response(JSON.stringify({ error_description: fakeSecret }), { status: 400 });
      return new Response(JSON.stringify({ access_token: fakeToken, token_type: 'bearer', scope: state.scope,
        ...(state.expiring ? { expires_in: 3600, refresh_token: 'offline-refresh-marker', refresh_token_expires_in: 86400 } : {}) }));
    }
    if (url === 'https://api.github.com/user') return new Response(JSON.stringify({ id: state.user, login: 'fixture' }));
    return f.transport(input, init);
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx = { stateDir: dir, logger, pluginConfig: { clientId: 'fixture-client', publicOrigin: 'http://127.0.0.1:19100', clientSecret: { source: 'env', provider: 'default', id: 'CLAWOS_TEST_APP_SECRET' } } };
  const vendor = new GitHubVendor(ctx, transport, () => state.now);
  const nonces = new OAuthNonceMachine(600_000, () => state.now);
  const connect = async (operator = 'operator', resourceTypes = ['repo', 'issue', 'pull']) => {
    const first = nonces.issue(operator);
    const advanced = nonces.advanceBound(first)!;
    const result = await vendor.connectAccount(operator, { state: advanced.nonce, callbackPath: '/os/gatekeeper/github/oauth/callback', resourceTypes });
    return { state: advanced.nonce, url: new URL(result.url), operator, resourceTypes };
  };
  const complete = async (connection: Awaited<ReturnType<typeof connect>>) => {
    nonces.consume(connection.state);
    await vendor.completeConnection(connection.operator, { state: connection.state, code: 'fixture-short-code', resourceTypes: connection.resourceTypes });
  };
  return { dir, calls, state, vendor, connect, complete, ctx, transport, logger };
}
afterEach(() => vi.unstubAllEnvs());
describe('GitHub supported web OAuth with kernel nonce and encrypted tokens', () => {
  it('preserves exact state, callback and S256 PKCE and stores only encrypted credentials', async () => {
    const f = setup(), c = await f.connect();
    expect(c.url.origin).toBe('https://github.com'); expect(c.url.searchParams.get('state')).toBe(c.state);
    expect(c.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(c.url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:19100/os/gatekeeper/github/oauth/callback');
    await f.complete(c);
    expect(createHash('sha256').update(f.calls[0]!.body.get('code_verifier')!).digest('base64url')).toBe(c.url.searchParams.get('code_challenge'));
    expect(f.calls[0]!.body.get('redirect_uri')).toBe(c.url.searchParams.get('redirect_uri'));
    expect(f.calls[0]!.body.get('client_secret')).toBe(fakeSecret);
    const dir = join(f.dir, 'os', 'gatekeepers', 'github', 'accounts'), stored = readdirSync(dir).map(n => readFileSync(join(dir, n), 'utf8')).join('');
    expect(stored).not.toContain(fakeToken); expect(stored).not.toContain(fakeSecret);
    expect(await (await f.vendor.getAccount('operator'))!.describe()).toEqual({ displayName: 'fixture' });
    expect(await f.vendor.getAccount('other')).toBeNull();
    await expect(f.vendor.completeConnection('operator', { code: 'fixture', state: c.state })).rejects.toThrow();
    for (const logger of Object.values(f.logger)) expect(logger).not.toHaveBeenCalled();
  });
  it('uses the installer base64 cell key and rejects corrupt or public key files', () => {
    const f = setup();
    writeFileSync(join(f.dir, 'os', 'cell.key'), 'invalid-key');
    expect(() => new GitHubVendor(f.ctx, f.transport)).toThrow('Invalid cell key format.');
    writeFileSync(join(f.dir, 'os', 'cell.key'), randomBytes(32).toString('base64') + '\n');
    chmodSync(join(f.dir, 'os', 'cell.key'), 0o644);
    expect(() => new GitHubVendor(f.ctx, f.transport)).toThrow('Private cell key required.');
  });
  it('requires kernel binding and refuses arbitrary redirect or unknown resource types', async () => {
    const f = setup(); await expect(f.vendor.connectAccount('operator')).rejects.toThrow();
    await expect(f.vendor.connectAccount('operator', { state: 'x'.repeat(32), callbackPath: '//evil/callback' })).rejects.toThrow();
    await expect(f.connect('operator', ['admin'])).rejects.toThrow();
  });
  it('rejects wrong operator, stale state, and scope substitution', async () => {
    const f = setup(); let c = await f.connect();
    await expect(f.vendor.completeConnection('other', { code: 'fixture', state: c.state })).rejects.toThrow();
    expect(f.calls).toHaveLength(0); c = await f.connect(); f.state.now += 600001;
    await expect(f.vendor.completeConnection('operator', { code: 'fixture', state: c.state })).rejects.toThrow();
    c = await f.connect(); await expect(f.vendor.completeConnection('operator', { code: 'fixture', state: c.state, resourceTypes: ['repo'] })).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it('rejects cross-account reconnection based on stable numeric identity', async () => {
    const f = setup(); await f.complete(await f.connect()); const account = await f.vendor.getAccount('operator');
    f.state.user = 100; await expect(f.complete(await f.connect())).rejects.toThrow('GitHub connection failed');
    expect(await f.vendor.getAccount('operator')).toBe(account);
  });
  it('invalidates old account objects after successful same-identity reconnection', async () => {
    const f = setup(); await f.complete(await f.connect()); const account = await f.vendor.getAccount('operator');
    await f.complete(await f.connect()); await expect(account!.describe()).rejects.toThrow();
    expect(await f.vendor.getAccount('operator')).not.toBe(account);
  });
  it('does not store insufficient scopes or raw OAuth errors', async () => {
    const f = setup(); f.state.scope = 'user'; await expect(f.complete(await f.connect())).rejects.toThrow('GitHub connection failed.');
    expect(await f.vendor.getAccount('operator')).toBeNull();
    f.state.failToken = true; await expect(f.complete(await f.connect())).rejects.toThrow('GitHub connection failed.');
  });
  it('coalesces refresh and revalidates numeric identity', async () => {
    const f = setup(); f.state.expiring = true; await f.complete(await f.connect());
    const account = (await f.vendor.getAccount('operator'))!; f.state.now += 3600_000;
    await Promise.all([account.getGatekeeperFor('https://github.com/org/repo'), account.getGatekeeperFor('https://github.com/org/repo/issues/12')]);
    expect(f.state.refreshCount).toBe(1);
    f.state.now += 3600_000; f.state.user = 100;
    await expect(account.getGatekeeperFor('https://github.com/org/repo')).rejects.toThrow();
  });
  it('does not resurrect credentials after revocation races a refresh', async () => {
    const f = setup(); f.state.expiring = true; await f.complete(await f.connect()); const account = (await f.vendor.getAccount('operator'))!;
    f.state.now += 3600_000;
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(r => { started = r; });
    f.state.block = () => { started(); return new Promise<void>(r => { release = r; }); };
    const pending = account.getGatekeeperFor('https://github.com/org/repo'); const result = expect(pending).rejects.toThrow();
    await entered; await account.revoke(); release(); await result; expect(await f.vendor.getAccount('operator')).toBeNull();
  });
  it('refuses plaintext secret config, insecure origins and alternate API destinations', async () => {
    const f = setup();
    expect(() => new GitHubVendor({ ...f.ctx, pluginConfig: { ...f.ctx.pluginConfig, publicOrigin: 'http://example.com' } }, f.transport)).toThrow();
    expect(() => new GitHubVendor({ ...f.ctx, pluginConfig: { ...f.ctx.pluginConfig, apiBase: 'https://evil' } }, f.transport)).toThrow();
    const vendor = new GitHubVendor({ ...f.ctx, pluginConfig: { ...f.ctx.pluginConfig, clientSecret: fakeSecret } }, f.transport);
    await expect(vendor.connectAccount('operator', { state: 'x'.repeat(32), callbackPath: '/os/gatekeeper/github/oauth/callback' })).rejects.toThrow();
  });
});
