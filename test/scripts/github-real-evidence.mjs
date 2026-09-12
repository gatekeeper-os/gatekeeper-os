// Pure evidence predicates; a missing canary or missing sink can never prove secrecy.
export function oauthStartUrl(path) {
  if (typeof path !== 'string' || !/^\/os\/gatekeeper\/github\/oauth\/start\?state=[A-Za-z0-9_-]{32}$/.test(path)) return undefined;
  return new URL(path, 'http://127.0.0.1:19100').href;
}
export function absentFromLogs(contents, values) {
  return Array.isArray(contents) && contents.length > 0 && contents.every(value => typeof value === 'string') &&
    Array.isArray(values) && values.length > 0 && values.every(value => typeof value === 'string' && value.length > 0) &&
    contents.every(bytes => values.every(value => !bytes.includes(value) &&
      !bytes.includes(JSON.stringify(value).slice(1, -1)) && !bytes.includes(JSON.stringify(JSON.stringify(value)).slice(1, -1))));
}
export function validateInput(input, runId) {
  return input !== null && typeof input === 'object' && typeof runId === 'string' && runId.length > 0 && input.runId === runId &&
    typeof input.oauthClientId === 'string' && /^[A-Za-z0-9_.-]{1,256}$/.test(input.oauthClientId) &&
    typeof input.owner === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(input.owner) &&
    typeof input.repo === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(input.repo) && !['.', '..'].includes(input.repo) &&
    [input.repositoryId, input.issueId, input.issueNumber, input.expectedAccountId].every(x => Number.isSafeInteger(x) && x > 0) &&
    (input.publicOrigin === undefined || input.publicOrigin === 'http://127.0.0.1:19100');
}
