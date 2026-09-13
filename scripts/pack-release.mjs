// Explicit, ordered, version-bound release set. Packaging only: no registry writes.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const { packages } = read(join(root, 'config/release-packages.json'));
const { version } = read(join(root, 'package.json'));
if (!Array.isArray(packages) || !packages.length || new Set(packages).size !== packages.length) throw new Error('Invalid release set');
const selected = packages.map(directory => {
  if (!/^[a-z][a-z0-9-]*$/.test(directory)) throw new Error('Invalid package path');
  const cwd = join(root, 'packages', directory), pkg = read(join(cwd, 'package.json'));
  if (pkg.private !== false || pkg.version !== version || pkg.publishConfig?.access !== 'public'
    || pkg.repository?.url !== 'git+https://github.com/gatekeeper-os/gatekeeper-os.git') throw new Error('Release metadata mismatch');
  return { directory, cwd, pkg };
});
for (const name of readdirSync(join(root, 'packages'))) {
  if (read(join(root, 'packages', name, 'package.json')).private !== true && !packages.includes(name)) throw new Error('Unexpected publishable package');
}
const seen = new Set();
for (const { pkg } of selected) {
  for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    if (dependency.startsWith('@gatekeeper-os/') && !seen.has(dependency)) throw new Error('Release dependency order mismatch');
  }
  seen.add(pkg.name);
}
const output = process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, 'gatekeeper-os-release') : mkdtempSync(join(tmpdir(), 'gatekeeper-os-release-'));
const archives = selected.map(({ cwd, pkg }) => {
  const packed = JSON.parse(execFileSync('pnpm', ['pack', '--json', '--pack-destination', output], { cwd, encoding: 'utf8' }));
  if (packed.name !== pkg.name || packed.version !== version) throw new Error('Packed identity mismatch');
  return resolve(output, packed.filename);
});
writeFileSync(join(output, 'archives.txt'), archives.join('\n') + '\n');
console.log(JSON.stringify({ version, packages: selected.map(({ pkg }) => pkg.name), output }));
