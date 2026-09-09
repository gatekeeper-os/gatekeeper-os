// VM-only primary boundary uses the production evaluator with independently controlled rules.
// That separation establishes which boundary denied; this is not installer projection evidence.
import { appendFileSync, readFileSync } from 'node:fs';
import { evaluateInstall } from '../../packages/clawos-shared/src/install-policy.js';
const root='/home/tester/.openclaw-kernel-test/os';
let result={protocolVersion:1,decision:'block',reason:'VM fixture refused.'};
try {
  if(process.env.HOME!=='/home/tester')throw new Error();
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>1048576)throw new Error();}
  const event=JSON.parse(input);
  if(event.protocolVersion!==1)throw new Error();
  result={...evaluateInstall(JSON.parse(readFileSync(root+'/primary-rules.json','utf8')),event),reason:'VM primary policy verdict.'};
  appendFileSync(root+'/install-events.jsonl',JSON.stringify({stage:'primary',allow:result.decision==='allow'})+'\n',{mode:0o600});
}catch{}
process.stdout.write(JSON.stringify(result)+'\n');
