// Read-only reproduction using real npm artifacts and the SAME packed-load gate as CI.
// Usage: node scripts/check-registry-packed-load.mjs <exact-version> <evidence-directory>
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPackedLoad } from './packed-load.mjs';
const version = process.argv[2], evidence = resolve(process.argv[3] ?? '');
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version ?? '') || !process.argv[3]) throw new Error('Exact version and evidence directory required');
mkdirSync(evidence, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'gkos-registry-packed-'));
const packages = [], receipt = { version, packages: [], passed: false };
try {
  for (const short of ['shared', 'gatekeeper-kit', 'kernel', 'gatekeeper-fs', 'cli']) {
    const name = '@gatekeeper-os/' + short;
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`);
    if (!response.ok) throw new Error(`Registry metadata unavailable: ${name}`);
    const metadata = await response.json();
    if (metadata.name !== name || metadata.version !== version || new URL(metadata.dist.tarball).origin !== 'https://registry.npmjs.org') throw new Error('Registry identity mismatch');
    const download = await fetch(metadata.dist.tarball);
    if (!download.ok) throw new Error('Registry archive unavailable');
    const bytes = Buffer.from(await download.arrayBuffer()), integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    if (integrity !== metadata.dist.integrity) throw new Error('Registry archive integrity mismatch');
    const archive = join(temporary, short + '.tgz'), unpack = join(temporary, short);
    writeFileSync(archive, bytes); mkdirSync(unpack);
    execFileSync('tar', ['-xf', archive, '-C', unpack], { stdio: 'pipe' });
    const root = join(unpack, 'package'), manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    if (manifest.name !== name || manifest.version !== version) throw new Error('Packed registry identity mismatch');
    const pluginId = existsSync(join(root, 'openclaw.plugin.json')) ? JSON.parse(readFileSync(join(root, 'openclaw.plugin.json'), 'utf8')).id : undefined;
    packages.push({ name, version, root, archive, publishable: true, pluginId });
    receipt.packages.push({ name, version, integrity, tarball: metadata.dist.tarball });
  }
  await checkPackedLoad(packages, temporary, dirname(dirname(fileURLToPath(import.meta.url))));
  receipt.passed = true;
} catch (error) {
  receipt.failure = error.message; console.error(error.message); process.exitCode = 1;
} finally {
  const verdict = join(temporary, 'packed-load-state/packed-model-verdict.json');
  if (existsSync(verdict)) copyFileSync(verdict, join(evidence, 'packed-model-verdict.json'));
  writeFileSync(join(evidence, 'registry-packed-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  rmSync(temporary, { recursive: true, force: true });
}
