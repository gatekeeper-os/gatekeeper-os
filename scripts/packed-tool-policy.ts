// Test adapter: read policy from the INSTALLED CLI tarball, never checkout config.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseJson5 } from '../packages/gkos-cli/src/util/json5.js';
const cli = process.argv[2]!;
if (JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8')).name !== '@gatekeeper-os/cli') throw new Error('Packed CLI required');
const configD = process.argv[3]!;
mkdirSync(configD, { recursive: true });
copyFileSync(join(cli, 'dist/templates/config.d/00-baseline.json5'), join(configD, '00-baseline.json5'));
const installed = await import(pathToFileURL(join(cli, 'dist/index.js')).href);
// beta.4 has no preview export: its shipped baseline is the negative control.
// Never emulate reconciliation or inject a fixture tool/plugin allowance here.
const policy = typeof installed.mergeFragments === 'function'
  ? installed.mergeFragments(configD)
  : parseJson5(readFileSync(join(configD, '00-baseline.json5'), 'utf8'));
if (!policy || Array.isArray(policy) || typeof policy !== 'object' || !policy.tools) throw new Error('Packed baseline tools missing');
console.log(JSON.stringify(policy.tools));
