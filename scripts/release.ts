/** Prepare versions/changelog and an explicitly requested local tag. Never handles npm credentials or publishes. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const encode = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

/** Plan all version writes before mutation, retaining non-release package pins. */
export function versionPlan(directory: string, version: string, notes: string): Map<string, string> {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?$/.test(version) || !notes.trim()) throw new Error('Valid version and release notes required.');
  const config = read(join(directory, 'config/release-packages.json'));
  if (!Array.isArray(config.packages) || !config.packages.length || new Set(config.packages).size !== config.packages.length) throw new Error('Invalid release package set.');
  const files = new Map<string, string>(), lock = read(join(directory, 'gkos.lock.json'));
  for (const name of config.packages) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Invalid package directory.');
    const path = join(directory, 'packages', name, 'package.json'), pkg = read(path);
    if (pkg.private !== false || !pkg.name.startsWith('@gatekeeper-os/') || pkg.publishConfig?.access !== 'public') throw new Error('Release package is not explicitly publishable.');
    pkg.version = version; files.set(path, encode(pkg));
    const manifestPath = join(directory, 'packages', name, 'openclaw.plugin.json');
    if (existsSync(manifestPath)) {
      const manifest = read(manifestPath); manifest.version = version;
      files.set(manifestPath, encode(manifest)); lock.plugins[manifest.id] = version;
    }
  }
  const packagePath = join(directory, 'package.json'), pkg = read(packagePath);
  pkg.version = version; files.set(packagePath, encode(pkg));
  files.set(join(directory, 'gkos.lock.json'), encode(lock));
  const changelog = join(directory, 'CHANGELOG.md'), prior = existsSync(changelog) ? readFileSync(changelog, 'utf8') : '# Changelog\n';
  if (!prior.includes(`## ${version}\n`)) files.set(changelog, prior.replace(/^# Changelog\n/, `# Changelog\n\n## ${version}\n\n${notes.trim()}\n`));
  return files;
}

/** `--write` prepares files; commit them, then `--tag` verifies and creates only a local tag. */
export function main(args: string[]): void {
  const { values } = parseArgs({ args, options: { version: { type: 'string' }, 'notes-file': { type: 'string' }, write: { type: 'boolean' }, tag: { type: 'boolean' } } });
  if (!values.version || !values['notes-file'] || (values.write && values.tag)) throw new Error('Use --version V --notes-file PATH [--write | --tag].');
  const plan = versionPlan(root, values.version, readFileSync(resolve(values['notes-file']), 'utf8'));
  const changed = [...plan].filter(([path, text]) => !existsSync(path) || readFileSync(path, 'utf8') !== text);
  if (values.tag) {
    if (changed.length || execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Commit the prepared version and notes before tagging.');
    const tag = `v${values.version}`;
    if (execFileSync('git', ['tag', '--list', tag], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Tag already exists; never move release tags.');
    // Metadata tests are not VM acceptance; the release record must also cite its VM checkpoint.
    for (const command of ['lint', 'typecheck', 'test']) execFileSync('pnpm', [command], { cwd: root, stdio: 'inherit' });
    execFileSync('node', ['scripts/check-package-licenses.mjs', '--pack', '--validate'], { cwd: root, stdio: 'inherit' });
    execFileSync('git', ['tag', '-a', tag, '-m', `Release ${values.version}`], { cwd: root, stdio: 'inherit' });
    console.log(`Created local ${tag}; not pushed or published.`);
  } else if (values.write) {
    for (const [path, text] of changed) writeFileSync(path, text);
    console.log(`Prepared ${changed.length} files; no commit, tag, or publish.`);
  } else console.log(encode({ version: values.version, mode: 'dry-run', files: changed.map(([path]) => path.slice(root.length + 1)) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.error(error instanceof Error && !('status' in error) ? error.message : 'Release preflight failed; no tag created.'); process.exitCode = 1;
  }
}
