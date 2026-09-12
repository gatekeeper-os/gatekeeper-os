/** Independent, read-only GitHub evidence. No driver imports, cache or token journal. */
export interface GitHubObservationTarget {
  owner: string;
  repo: string;
  repositoryId: number;
  issueNumber: number;
  issueId: number;
  accountId: number;
}

/** Opaque receipt; comment bodies remain private in this observer's memory. */
export interface GitHubObservation {
  readonly observedAt: number;
  readonly comments: number;
}

type Comment = { id: number; body: string; accountId: number };
type State = { comments: Comment[]; sequence: number };
type Effect = { kind: 'unchanged' } | { kind: 'created'; body: string } | { kind: 'reverted'; commentId: number };
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
function fail(): never { throw new Error('GITHUB_OBSERVATION_INVALID'); }

/** Read GitHub REST directly. A supplied test transport always marks evidence synthetic.
 * A private-repository observer token is optional and separate from the driver's OAuth.
 * All requests are GETs to fixed api.github.com paths; redirects are never followed.
 */
export class GitHubObserver {
  readonly #target: GitHubObservationTarget;
  readonly #transport: typeof fetch;
  readonly #token: string | undefined;
  readonly #realProvider: boolean;
  readonly #observations = new WeakMap<GitHubObservation, State>();
  readonly #created = new Set<number>();
  #sequence = 0;

  constructor(target: GitHubObservationTarget, options: { token?: string; transport?: typeof fetch } = {}) {
    if (!options.transport && (process.env.CLAWOS_KERNEL_VM !== '1' || !['full', 'observer-live'].includes(process.env.CLAWOS_TEST_MODE ?? '') ||
        process.cwd() !== '/home/tester/src' || process.env.OPENCLAW_STATE_DIR !== '/home/tester/.openclaw-kernel-test' ||
        process.env.OPENCLAW_CONFIG_PATH !== '/home/tester/.openclaw-kernel-test/openclaw.json')) fail();
    if (typeof target.owner !== 'string' || typeof target.repo !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(target.owner) ||
        !/^[A-Za-z0-9_.-]{1,100}$/.test(target.repo) || ['.', '..'].includes(target.repo) ||
        ![target.repositoryId, target.issueNumber, target.issueId, target.accountId].every(positive) ||
        (options.token !== undefined && (typeof options.token !== 'string' || !options.token.trim() || /\s/.test(options.token)))) fail();
    this.#target = Object.freeze({ ...target });
    this.#transport = options.transport ?? globalThis.fetch;
    this.#realProvider = options.transport === undefined;
    this.#token = options.token;
  }

  async #get(path: string): Promise<unknown> {
    try {
      const response = await this.#transport('https://api.github.com' + path, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'Cache-Control': 'no-cache, no-store', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          ...(this.#token ? { Authorization: 'Bearer ' + this.#token } : {}) },
      });
      // A 304, redirect or error body is never a successful observation.
      if (response.status !== 200 || response.redirected || !response.body) fail();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 8 * 1024 * 1024) { await reader.cancel(); fail(); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw new Error('GITHUB_OBSERVATION_UNAVAILABLE'); }
  }

  /** Fetch a complete uncached snapshot, rejecting target drift and incomplete pagination. */
  async capture(): Promise<GitHubObservation> {
    const t = this.#target, root = `/repos/${t.owner}/${t.repo}`;
    const repository = await this.#get(root);
    if (!record(repository) || repository.id !== t.repositoryId ||
        typeof repository.full_name !== 'string' || repository.full_name.toLowerCase() !== `${t.owner}/${t.repo}`.toLowerCase()) fail();
    const issuePath = `${root}/issues/${t.issueNumber}`;
    const readIssue = async () => {
      const issue = await this.#get(issuePath);
      if (!record(issue) || issue.id !== t.issueId || issue.number !== t.issueNumber ||
          issue.repository_url !== 'https://api.github.com' + root || 'pull_request' in issue ||
          !Number.isSafeInteger(issue.comments) || (issue.comments as number) < 0) fail();
      return issue.comments as number;
    };
    const expectedCount = await readIssue();
    const comments: Comment[] = [], ids = new Set<number>();
    let complete = false;
    for (let page = 1; page <= 20; page++) {
      // Never follow a server-supplied Link URL with observer credentials.
      const rows = await this.#get(`${issuePath}/comments?per_page=100&page=${page}`);
      if (!Array.isArray(rows) || rows.length > 100) fail();
      for (const row of rows) {
        if (!record(row) || !positive(row.id) || typeof row.body !== 'string' ||
            !record(row.user) || !positive(row.user.id) || ids.has(row.id) ||
            row.issue_url !== 'https://api.github.com' + issuePath) fail();
        ids.add(row.id); comments.push({ id: row.id, body: row.body, accountId: row.user.id });
      }
      if (rows.length < 100) { complete = true; break; }
    }
    if (!complete || comments.length !== expectedCount || await readIssue() !== expectedCount) fail();
    const receipt = Object.freeze({ observedAt: Date.now(), comments: comments.length });
    this.#observations.set(receipt, { comments, sequence: ++this.#sequence });
    return receipt;
  }

  /** Check the exact delta, including unchanged pre-existing comments. No bodies in output.
   * Receipts must belong to this instance; copied/replayed JSON is not evidence.
   */
  verify(before: GitHubObservation, after: GitHubObservation, effect: Effect): {
    ok: boolean; realProvider: boolean; provider: 'github.com' | 'fixture'; commentId?: number;
  } {
    const a = this.#observations.get(before), b = this.#observations.get(after);
    if (!a || !b || b.sequence <= a.sequence || after.observedAt < before.observedAt) fail();
    const same = (x: Comment, y: Comment | undefined) => !!y && x.id === y.id && x.body === y.body && x.accountId === y.accountId;
    const byId = new Map(b.comments.map(c => [c.id, c]));
    let ok = false, commentId: number | undefined;
    if (effect.kind === 'unchanged') {
      ok = a.comments.length === b.comments.length && a.comments.every(c => same(c, byId.get(c.id)));
    } else if (effect.kind === 'created') {
      const old = new Set(a.comments.map(c => c.id)), added = b.comments.filter(c => !old.has(c.id));
      ok = effect.body.length > 0 && !a.comments.some(c => c.body === effect.body) && added.length === 1 &&
        added[0]!.body === effect.body && added[0]!.accountId === this.#target.accountId &&
        a.comments.every(c => same(c, byId.get(c.id)));
      if (ok) { commentId = added[0]!.id; this.#created.add(commentId); }
    } else if (effect.kind === 'reverted') {
      const removed = a.comments.find(c => c.id === effect.commentId);
      ok = this.#created.has(effect.commentId) && !!removed && removed.accountId === this.#target.accountId && !byId.has(effect.commentId) &&
        b.comments.length === a.comments.length - 1 && a.comments.filter(c => c.id !== effect.commentId).every(c => same(c, byId.get(c.id)));
    }
    return { ok, realProvider: this.#realProvider, provider: this.#realProvider ? 'github.com' : 'fixture', ...(commentId === undefined ? {} : { commentId }) };
  }
}
