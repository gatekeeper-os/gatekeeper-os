/** Fixed-origin GitHub REST transport. Redirects and arbitrary API destinations are forbidden. */
export class GitHubError extends Error {
    constructor(readonly status: number, readonly providerResponseStatus?: number) { super(`GitHub request failed (${status}).`); }
}
/** Injectable transport is for offline tests; production always uses native fetch. */
export type Transport = typeof fetch;
/** Read response bodies with a finite allocation bound; never expose vendor error bodies. */
export async function boundedBody(response: Response, maximum = 2 * 1024 * 1024): Promise<string> {
    if (Number(response.headers.get('content-length')) > maximum)
        throw new GitHubError(413);
    const reader = response.body?.getReader();
    if (!reader)
        return '';
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done)
                break;
            size += next.value.length;
            if (size > maximum) {
                await reader.cancel();
                throw new GitHubError(413);
            }
            parts.push(next.value);
        }
        return Buffer.concat(parts).toString('utf8');
    }
    finally {
        reader.releaseLock();
    }
}
/** Only API paths assembled by this package are accepted; no redirects or retrying writes. */
export class GitHubApi {
    constructor(private readonly token: () => string | Promise<string>, private readonly transport: Transport = fetch) { }
    async graphql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
        const received = await this.requestWithStatus('/graphql', 'POST', { query, variables });
        const response = object(received.value);
        if (response.errors !== undefined)
            throw new GitHubError(502, received.status);
        return object(response.data);
    }
    async request(path: string, method = 'GET', body?: unknown, diff = false): Promise<unknown> {
        return (await this.requestWithStatus(path, method, body, diff)).value;
    }
    private async requestWithStatus(path: string, method = 'GET', body?: unknown, diff = false): Promise<{ value: unknown; status: number }> {
        if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n#]/u.test(path))
            throw new GitHubError(400);
        try {
            const response = await this.transport(`https://api.github.com${path}`, {
                method, redirect: 'error', signal: AbortSignal.timeout(30000),
                headers: { Authorization: `Bearer ${await this.token()}`, Accept: diff ? 'application/vnd.github.diff' : 'application/vnd.github+json',
                    'User-Agent': 'openclaw-os-github/0.1.0', 'X-GitHub-Api-Version': '2022-11-28', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            if (!response.ok) {
                await response.body?.cancel();
                throw new GitHubError(response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")) ? 429 : response.status, response.status);
            }
            const text = await boundedBody(response, diff ? 1024 * 1024 : 2 * 1024 * 1024);
            return { value: diff ? text : text ? JSON.parse(text) : null, status: response.status };
        }
        catch (error) {
            throw error instanceof GitHubError ? error : new GitHubError(0);
        }
    }
}
/** Reject malformed upstream shapes instead of relaying raw responses. */
export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new GitHubError(502);
    return value as Record<string, unknown>;
}
/** Validated positive remote identifiers. */
export function identifier(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 1)
        throw new GitHubError(502);
    return Number(value);
}
/** Select bounded public fields; no token/headers/raw vendor metadata is returned. */
export function text(value: unknown, limit = 65536): string { return typeof value === 'string' ? value.slice(0, limit) : ''; }
/** Structured, bounded issue/pull summary. */
export function summary(value: unknown): Record<string, unknown> {
    const v = object(value);
    return { id: identifier(v.id), number: identifier(v.number), title: text(v.title, 256), body: text(v.body),
        state: text(v.state, 20), author: text(v.user && object(v.user).login, 100),
        labels: Array.isArray(v.labels) ? v.labels.slice(0, 100).map(l => typeof l === 'string' ? text(l, 100) : text(object(l).name, 100)) : [],
        truncated: (typeof v.body === 'string' && v.body.length > 65536) || (typeof v.title === 'string' && v.title.length > 256) };
}
/** Structured comment/review, excluding raw account and API metadata. */
export function comment(value: unknown): Record<string, unknown> {
    const v = object(value);
    return { id: identifier(v.id), body: text(v.body), author: text(v.user && object(v.user).login, 100),
        state: text(v.state, 40), truncated: typeof v.body === 'string' && v.body.length > 65536 };
}
/** Validate an opaque GitHub GraphQL node ID without interpreting its encoding. */
export function nodeId(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_=-]{1,256}$/.test(value))
        throw new GitHubError(502);
    return value;
}
