// Resolve moving tags once. Unsupported releases are explicitly NOT a conformance pass.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const tag = process.env.UPSTREAM_TAG;
if (!['pinned', 'latest', 'beta', 'extended-stable'].includes(tag)) throw new Error('INVALID_UPSTREAM_TAG');
const pin = JSON.parse(readFileSync('gkos.lock.json', 'utf8')).upstream.version;
const range = JSON.parse(readFileSync('packages/gkos-kernel/package.json', 'utf8')).openclaw.compat.pluginApi;
function versions(spec) {
  const value = JSON.parse(execFileSync('npm', ['view', `openclaw@${spec}`, 'version', '--json'], {
    encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  return Array.isArray(value) ? value : [value];
}
const resolved = versions(tag === 'pinned' ? pin : tag);
if (resolved.length !== 1 || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(resolved[0])) throw new Error('INVALID_UPSTREAM_VERSION');
const version = resolved[0];
// npm's range resolver uses the same semver semantics as plugin compatibility metadata.
const supported = versions(range).includes(version);
writeFileSync('verdict-compatibility.json', JSON.stringify({ tag, version, range, supported,
  status: supported ? 'pending' : 'unsupported', scope: 'compatibility-smoke', fullConformance: false,
  reason: supported ? 'Live checks required' : 'Outside declared plugin API range; live checks not run',
}, null, 2) + '\n');
// Only the deliberately older maintenance channel is an informational exclusion.
// A moving latest/beta channel escaping our supported range must still alert.
if (tag !== 'extended-stable' && !supported) throw new Error('UPSTREAM_OUTSIDE_DECLARED_RANGE');
appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nsupported=${supported}\n`);
