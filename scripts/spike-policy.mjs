#!/usr/bin/node
// VM-only install-policy fixture. Input values and source contents are never recorded.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
let text = '';
for await (const chunk of process.stdin) text += chunk;
const request = JSON.parse(text);
appendFileSync(join(process.env.OPENCLAW_STATE_DIR,'os','install-policy.jsonl'), JSON.stringify({
  keys: Object.keys(request), protocolVersion: request.protocolVersion,
  targetType: request.targetType, mode: process.argv[2],
})+'\n', {mode:0o600});
if (process.argv[2] === 'malformed') { process.stdout.write('{}'); }
else process.stdout.write(JSON.stringify({protocolVersion:1,decision:process.argv[2],...(process.argv[2] === 'block' ? {reason:'S-1 deliberate denial'} : {})}));
