// Structural assertions over live VM evidence. Never accept executed tools without hook correlation.
import { readFileSync, writeFileSync } from 'node:fs';
const root='/home/tester/phase-0-evidence';
const records=readFileSync(`${root}/spike-S1.jsonl`,'utf8').trim().split('\n').map(x=>JSON.parse(x));
const rows=q=>records.filter(x=>x.q===q).map(x=>x.data);
const checks={
  'sqlite-owned-store': rows('h:sqlite').some(x=>x.ok),
  'twenty-correlated-tool-calls': rows('f:execute').length>=20 && rows('f:execute').every(x=>x.hasToolCallId && x.correlated),
  'twenty-tool-hooks-with-identity': rows('f:before_tool_call').length>=20 && rows('f:before_tool_call').every(x=>x.hasToolCallId && x.hasAgentId && x.hasSessionKey),
  'model-tools-narrowed': rows('e:llm_input').length>=20 && rows('e:llm_input').every(x=>x.hasTools && x.names.every(n=>['probe_echo','probe_late'].includes(n))),
  'operator-client-observed': rows('g:gateway-client').some(x=>x.present && x.role==='operator'),
};
for(const [id,ok] of Object.entries(checks)) console.log(`${ok?'PASS':'FAIL'} ${id}`);
writeFileSync(`${root}/assertions.json`,JSON.stringify(checks,null,2)+'\n');
if(Object.values(checks).some(x=>!x)) process.exitCode=1;
else { console.log('FAIL phase-0-review-pending: evaluate c,d,g,i,j,m; verify dev:gateway and live CI before tagging'); process.exitCode=1; }
