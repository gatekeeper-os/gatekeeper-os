// Read-only registry preflight. Exit 0 = published, 1 = absent, 2 = unsafe/unknown.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function archivePublished(archive, run = spawnSync) {
  const packed = run('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  if (packed.error || packed.status !== 0) throw new Error('Cannot inspect release archive');
  const { name, version } = JSON.parse(packed.stdout);
  if (!/^@clawkeepers\/[a-z0-9-]+$/.test(name) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid archive identity');
  const result = run('npm', ['view', `${name}@${version}`, 'version', '--json'], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  if (result.error) throw new Error('Registry lookup failed');
  let response;
  try { response = JSON.parse(result.stdout); } catch { throw new Error('Invalid registry response'); }
  if (result.status === 0 && response === version) return { name, version, published: true };
  if (result.status !== 0 && result.status !== null && response?.error?.code === 'E404') return { name, version, published: false };
  throw new Error('Registry lookup failed or returned an unexpected version');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Expected one archive');
    const result = archivePublished(process.argv[2]);
    if (result.published) console.log(`${result.name}@${result.version}: already published, skipping`);
    process.exitCode = result.published ? 0 : 1;
  } catch {
    console.error('Release registry preflight failed; publication stopped');
    process.exitCode = 2;
  }
}
