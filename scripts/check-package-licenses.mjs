// Verify project metadata and optionally the actual distributable tarballs.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const validate = process.argv.includes('--validate');
const pack = process.argv.includes('--pack') || validate;
const temporary = pack ? mkdtempSync(join(tmpdir(), 'clawos-license-check-')) : undefined;
const license = readFileSync(join(root, 'LICENSE'));
const notice = readFileSync(join(root, 'NOTICE'));
let count = 0, plugins = 0;
const validationRoots = [], extractedPackages = [];
const validator = join(root, 'packages/clawos-kernel/node_modules/openclaw/openclaw.mjs');
function validatePlugin(pluginRoot) {
  const state = mkdtempSync(join(temporary, 'validation-state-'));
  const config = join(state, 'openclaw.json');
  for (const name of ['.openclaw', '.openclaw-prod']) {
    const protectedRoot = resolve(homedir(), name);
    if ([state, config].some(path => path === protectedRoot || path.startsWith(protectedRoot + '/'))) throw new Error('Production state prohibited');
  }
  writeFileSync(config, '{}\n', { mode: 0o600 });
  const env = { ...process.env, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: config, OPENCLAW_NO_AUTO_UPDATE: '1' };
  for (const name of ['OPENCLAW_PROFILE', 'OPENCLAW_GATEWAY_TOKEN', 'OPENCLAW_GATEWAY_PASSWORD', 'OPENCLAW_GATEWAY_URL']) delete env[name];
  try {
    execFileSync(process.execPath, [validator, 'plugins', 'validate', '--root', pluginRoot, '--entry', './dist/index.js', '--json'], { env, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const missing = /does not expose tool or feature authoring metadata/.test(String(error.stderr ?? '') + String(error.stdout ?? ''));
    throw new Error(`Packed plugin metadata validation failed${missing ? ': ordinary entry lacks authoring metadata' : ''} (raw output withheld)`);
  }
  plugins++;
}
try {
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, 'packages', entry.name);
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    if (pkg.license !== 'MIT') throw new Error(`${entry.name}: missing MIT metadata`);
    for (const [name, expected] of [['LICENSE', license], ['NOTICE', notice]]) {
      if (!pkg.files?.includes(name)) throw new Error(`${entry.name}: ${name} absent from package files`);
      if (!readFileSync(join(directory, name)).equals(expected)) {
        throw new Error(`${entry.name}: ${name} differs from project text`);
      }
    }
    if (pack) {
      const output = execFileSync('pnpm', ['pack', '--json', '--pack-destination', temporary], {
        cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      const packed = JSON.parse(output);
      const archive = resolve(temporary, packed.filename);
      const members = new Set(packed.files.map(file => file.path));
      const read = name => execFileSync('tar', ['-xOf', archive, `package/${name}`]);
      const verify = prefix => {
        if (JSON.parse(read(`${prefix}package.json`)).license !== 'MIT') {
          throw new Error(`${entry.name}: ${prefix}package.json missing packed MIT metadata`);
        }
        for (const [name, expected] of [['LICENSE', license], ['NOTICE', notice]]) {
          if (!members.has(`${prefix}${name}`) || !read(`${prefix}${name}`).equals(expected)) {
            throw new Error(`${entry.name}: packed ${prefix}${name} missing or changed`);
          }
        }
      };
      verify('');
      const manifest = JSON.parse(read('package.json'));
      for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        if (Object.values(manifest[field] ?? {}).some(value => /^(workspace|catalog|link|file):/.test(value))) {
          throw new Error(`${entry.name}: unresolved packed dependency protocol`);
        }
      }
      const verifyThirdParty = prefix => {
        const thirdParty = `${prefix}THIRD-PARTY-NOTICES`;
        const typeboxLicense = readFileSync(join(root, 'packages/gatekeeper-fs/node_modules/typebox/license'), 'utf8');
        if (!members.has(thirdParty) || !read(thirdParty).toString().includes(typeboxLicense)) {
          throw new Error(`${entry.name}: bundled TypeBox notice missing from ${prefix}`);
        }
      };
      const pluginPrefixes = new Set([...members].map(member => member.match(/^(?:dist\/)?templates\/plugins\/[^/]+\//)?.[0]).filter(Boolean));
      for (const prefix of pluginPrefixes) {
        verify(prefix);
        verifyThirdParty(prefix);
      }
      for (const prefix of ['templates/plugins/', 'dist/templates/plugins/']) {
        if (members.has(prefix + 'install-policy.mjs')) verifyThirdParty(prefix);
      }
      if (validate) {
        const extracted = join(temporary, entry.name);
        mkdirSync(extracted);
        execFileSync('tar', ['-xf', archive, '-C', extracted], { stdio: 'pipe' });
        const packageRoot = join(extracted, 'package');
        extractedPackages.push({ name: pkg.name, root: packageRoot });
        if (pkg.private === false) {
          if (existsSync(join(packageRoot, 'openclaw.plugin.json'))) validationRoots.push(packageRoot);
          for (const prefix of pluginPrefixes) validationRoots.push(join(packageRoot, prefix));
        }
      }
    }
    count++;
  }
  console.log(`Package licenses: ${count} verified${pack ? ' including packed artifacts' : ''}`);
  if (validate) {
    // Resolve the pre-publication dependency set from extracted tarballs, never
    // workspace libraries. Only pinned third-party dependencies come from install.
    const modules = join(temporary, 'node_modules');
    mkdirSync(join(modules, '@clawkeepers'), { recursive: true });
    for (const item of extractedPackages) symlinkSync(item.root, join(modules, item.name));
    symlinkSync(join(root, 'packages/gatekeeper-fs/node_modules/typebox'), join(modules, 'typebox'));
    symlinkSync(join(root, 'packages/clawos-kernel/node_modules/openclaw'), join(modules, 'openclaw'));
    for (const pluginRoot of validationRoots) validatePlugin(pluginRoot);
    if (!plugins) throw new Error('No packed plugins validated');
    console.log(`Packed plugin CLI validation: ${plugins} verified`);
  }
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
