// Dependency-free adapter for the SAME 38 selected Phase 3 live evidence assertions.
// No product implementation is bundled/imported. Evidence must come from this exact VM run.
import {readFileSync,writeFileSync} from 'node:fs';
const suites=JSON.parse(readFileSync(new URL('./selected-checks.json',import.meta.url),'utf8'));
const ids=Object.values(suites).flat(),reportPath=process.env.CLAWOS_SCENARIO_REPORT,runId=process.env.CLAWOS_SCENARIO_RUN;
let verdict={mode:'npm-only-selected-live-conformance',runId,ok:false,total:38,passed:0,tests:[],fullPhaseAcceptance:false};
try{
 if(process.env.CLAWOS_KERNEL_VM!=='1'||!runId||!reportPath||process.cwd()!=='/home/tester/npm-acceptance'||ids.length!==38||new Set(ids).size!==38)throw new Error('live-scenario-required');
 const report=JSON.parse(readFileSync(reportPath,'utf8'));
 if(report.runId!==runId||'failure'in report||!report.checks||Object.values(report.checks).some(v=>v!==true))throw new Error('live-scenario-invalid');
 for(const [suite,checks]of Object.entries(suites))for(const id of checks){const ok=report.checks[id]===true;verdict.tests.push({suite,id,ok});if(ok)verdict.passed++;}
 verdict.structuralChecks=Object.keys(report.checks).length;verdict.modelTurns=report.turns.length;
 if(verdict.passed!==38)throw new Error('selected-live-check-failed');
 verdict.ok=true;console.log('PASS npm-only-selected-live-conformance 38/38');
}catch(error){verdict.failure=error.message;process.exitCode=1;console.log('FAIL npm-only-selected-live-conformance');}
finally{writeFileSync(process.argv[2],JSON.stringify(verdict,null,2)+'\n',{mode:0o600});}
