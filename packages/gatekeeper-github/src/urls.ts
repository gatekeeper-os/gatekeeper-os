/** Canonical, constructor-bound GitHub resource identity. */
export interface Target {
    owner: string;
    repo: string;
    type: 'repo' | 'issue' | 'pull';
    number?: number;
    key: string;
    path: string;
}
/** Parse original spelling before URL normalization can erase traversal or separators. */
export function parseTarget(input: string): Target {
    const match = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})(?:\/(issues|pull)\/([1-9][0-9]*))?\/?$/.exec(input);
    if (!match || ['.', '..'].includes(match[2]!))
        throw new Error('Invalid GitHub resource URL.');
    const owner = match[1]!.toLowerCase(), repo = match[2]!.toLowerCase();
    const type = match[3] === 'issues' ? 'issue' : match[3] === 'pull' ? 'pull' : 'repo';
    const number = match[4] ? Number(match[4]) : undefined;
    if (number !== undefined && !Number.isSafeInteger(number))
        throw new Error('Invalid GitHub resource URL.');
    return { owner, repo, type, ...(number === undefined ? {} : { number }),
        key: `https://github.com/${owner}/${repo}${type === 'repo' ? '' : `/${type === 'issue' ? 'issues' : 'pull'}/${number}`}`,
        path: `/repos/${owner}/${repo}` };
}
/** Encode individual path components without permitting traversal or alternate destinations. */
export function filePath(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 2048 || /[\\\x00-\x1f\x7f]/u.test(value))
        throw new Error('Invalid file path.');
    const parts = value.split('/');
    if (parts.some(p => !p || p === '.' || p === '..'))
        throw new Error('Invalid file path.');
    return parts.map(encodeURIComponent).join('/');
}
/** Stable provider identifiers captured at introduction; names are never mutation authority. */
export interface ResourceIdentity {
    repo: number;
    repoNode: string;
    item?: number;
    itemNode?: string;
}
