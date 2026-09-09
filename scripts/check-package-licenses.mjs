// Verify project metadata and optionally the actual distributable tarballs.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pack = process.argv.includes('--pack');
const temporary = pack ? mkdtempSync(join(tmpdir(), 'clawos-license-check-')) : undefined;
const license = readFileSync(join(root, 'LICENSE'));
const notice = readFileSync(join(root, 'NOTICE'));
let count = 0;
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
      const output = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], {
        cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      const [packed] = JSON.parse(output);
      const archive = join(temporary, packed.filename);
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
      const verifyThirdParty = prefix => {
        const thirdParty = `${prefix}THIRD-PARTY-NOTICES`;
        const typeboxLicense = readFileSync(join(root, 'packages/gatekeeper-fs/node_modules/typebox/license'), 'utf8');
        if (!members.has(thirdParty) || !read(thirdParty).toString().includes(typeboxLicense)) {
          throw new Error(`${entry.name}: bundled TypeBox notice missing from ${prefix}`);
        }
      };
      const pluginPrefixes = new Set([...members].map(member => member.match(/^templates\/plugins\/[^/]+\//)?.[0]).filter(Boolean));
      for (const prefix of pluginPrefixes) {
        verify(prefix);
        verifyThirdParty(prefix);
      }
      if (members.has('templates/plugins/install-policy.mjs')) verifyThirdParty('templates/plugins/');
    }
    count++;
  }
  console.log(`Package licenses: ${count} verified${pack ? ' including packed artifacts' : ''}`);
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
