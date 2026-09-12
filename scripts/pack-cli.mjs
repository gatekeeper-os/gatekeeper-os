// Return pnpm's actual archive path; do not hardcode the npm scope or version.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length !== 3) throw new Error('Pack destination required');
const result = JSON.parse(execFileSync('pnpm', ['pack', '--json', '--pack-destination', resolve(process.argv[2])], {
  cwd: resolve(root, 'packages/clawos-cli'), encoding: 'utf8',
}));
console.log(result.filename);
