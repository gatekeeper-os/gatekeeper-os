// Full Phase 3 evidence aggregator. It accepts only fresh, successful live reports from this VM run.
import { readFileSync, statSync } from 'node:fs';

if(process.env.GKOS_TEST_MODE!=='full'||process.env.HOME!=='/home/tester'||process.cwd()!=='/home/tester/src')throw new Error('full VM run required');
const started=Date.parse(process.env.GKOS_TEST_START??'');
if(!Number.isFinite(started))throw new Error('missing run start');
const load=(path)=>{if(statSync(path).mtimeMs<started)throw new Error('stale evidence');return JSON.parse(readFileSync(path,'utf8'));};
const requireExit=(path)=>{if(readFileSync(path,'utf8').trim()!=='0')throw new Error('checkpoint failed');};
const suites=new Map();
for(const path of [
  '/home/tester/phase-3-install-evidence/install-verdict.json',
  '/home/tester/phase-3-conformance-runner-evidence/health-verdict.json',
  '/home/tester/phase-3-kernel-live-evidence/live-verdict.json',
  '/home/tester/phase-3-install-hook-evidence/hook-verdict.json',
  '/home/tester/phase-3-plugin-install-hook-evidence/hook-verdict.json',
]){
  const verdict=load(path);if(verdict.ok!==true)throw new Error('failed verdict');
  for(const suite of verdict.tests??[]){if(suite.failed!==0||suite.skipped!==0||suite.passed<1)throw new Error('incomplete suite');suites.set(suite.id,suite);}
}
for(const path of [
  '/home/tester/phase-3-install-evidence/install-exit-code',
  '/home/tester/phase-3-conformance-runner-evidence/runner-exit-code',
  '/home/tester/phase-3-kernel-live-evidence/live-exit-code',
  '/home/tester/phase-3-install-hook-evidence/hook-exit-code',
  '/home/tester/phase-3-plugin-install-hook-evidence/hook-exit-code',
  '/home/tester/phase-3-channel-ingress-evidence/live-exit-code',
])requireExit(path);
const required=['plugin-loads','hooks-fire','tool-narrowing','gate-blocks','rpc-methods','cli-mounted','health','fs-gatekeeper','install-gate','install-hook','plugin-install-hook'];
if(required.some(id=>!suites.has(id)))throw new Error('missing suite');
const channel=load('/home/tester/phase-3-channel-ingress-evidence/scenarios.json');
if(channel.runId!==process.env.GKOS_TEST_START||Object.values(channel.checks??{}).some(value=>value!==true)||Object.keys(channel.checks??{}).length<71)throw new Error('channel acceptance incomplete');
const requiredChannel=['command-owner-no-model','command-owner-private-authority','command-outsider-no-model','command-outsider-private-authority','command-group-no-model','command-group-private-authority','command-forged-no-model','command-forged-private-authority','connect-local-once','connect-static-account','connect-replay-denied','shared-grant-mint-denied','egress-positive-delivery','egress-blocked-delivery','egress-audited'];
if(requiredChannel.some(id=>channel.checks[id]!==true))throw new Error('missing kernel surface acceptance');
const kernel=load('/home/tester/phase-3-kernel-live-evidence/scenarios.json');
const requiredKernel=['request-does-not-mint','request-stored-bound-agent','request-shared-token-denied','request-operator-approved','request-next-turn-tools','simulated-write-succeeded','write-pending-not-auto-applied','simulated-write-host-unchanged','pending-read-sees-overlay','cli-reject-action','rejected-overlay-gone','rejection-audited','unsafe-write-apply-denied','unsafe-write-host-unchanged','unsafe-write-no-auto-retry','uncertain-action-audited'];
if(kernel.runId!==process.env.GKOS_TEST_START||Object.values(kernel.checks??{}).some(v=>v!==true)||requiredKernel.some(id=>kernel.checks[id]!==true))throw new Error('kernel lifecycle acceptance incomplete');
process.stdout.write(JSON.stringify({ok:true,runId:process.env.GKOS_TEST_START,suites:Object.fromEntries(required.map(id=>[id,suites.get(id).passed])),channelChecks:Object.keys(channel.checks).length,kernelChecks:Object.keys(kernel.checks).length})+'\n');
