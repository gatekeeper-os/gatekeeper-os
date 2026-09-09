// Verify that published workspace packages retain the project's license and notice.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let count = 0;
for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = join(root, 'packages', entry.name);
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  if (pkg.license !== 'MIT') throw new Error(`${entry.name}: missing MIT metadata`);
  for (const name of ['LICENSE', 'NOTICE']) {
    if (!pkg.files?.includes(name)) throw new Error(`${entry.name}: ${name} absent from package files`);
    if (!readFileSync(join(directory, name)).equals(readFileSync(join(root, name)))) {
      throw new Error(`${entry.name}: ${name} differs from project text`);
    }
  }
  count++;
}
console.log(`Package licenses: ${count} verified`);
