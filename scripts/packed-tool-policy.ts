// Test adapter: read policy from the INSTALLED CLI tarball, never checkout config.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJson5 } from '../packages/gkos-cli/src/util/json5.js';
const cli = process.argv[2]!;
if (JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8')).name !== '@gatekeeper-os/cli') throw new Error('Packed CLI required');
const policy = parseJson5(readFileSync(join(cli, 'dist/templates/config.d/00-baseline.json5'), 'utf8'));
if (!policy || Array.isArray(policy) || typeof policy !== 'object' || !policy.tools) throw new Error('Packed baseline tools missing');
console.log(JSON.stringify(policy.tools));
