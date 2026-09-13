// Disposable update runtime probe. Real Gateway/SDK/grants, no model credentials or phase-acceptance claim.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
if(process.env.HOME!=='/home/tester'||process.cwd()!=='/home/tester/src')throw new Error('DISPOSABLE_VM_REQUIRED');
const [binary,state,version]=process.argv.slice(2);
if(!state?.startsWith('/home/tester/.gkos/updates/')||!binary?.startsWith('/home/tester/.gkos/runtimes/'))throw new Error('ISOLATED_RUNTIME_REQUIRED');
for(const dir of [state,join(state,'os'),state+'-resource'])mkdirSync(dir,{recursive:true,mode:0o700});
const live=JSON.parse(readFileSync('/home/tester/.openclaw/openclaw.json','utf8'));
const paths=live.plugins.load.paths.filter(p=>['gkos-kernel','gkos-gatekeeper-fs'].some(id=>p.endsWith('/'+id)));
const catalog=JSON.parse(readFileSync('/home/tester/.openclaw/os/gatekeepers.json','utf8'));
writeFileSync(join(state,'os/gatekeepers.json'),JSON.stringify(catalog),{mode:0o600});
writeFileSync(join(state,'openclaw.json'),JSON.stringify({gateway:{mode:'local',bind:'loopback',port:19100,auth:{mode:'token',token:randomBytes(32).toString('hex')}},update:{auto:{enabled:false}},agents:{defaults:{workspace:join(state,'workspace')}},plugins:{allow:['gkos-kernel','gkos-gatekeeper-fs'],load:{paths},entries:{'gkos-kernel':{enabled:true,hooks:{allowConversationAccess:true},config:{operators:[],install:{allowSources:[]}}},'gkos-gatekeeper-fs':{enabled:true,config:{roots:[state+'-resource']}}}}}),{mode:0o600});
const env={...process.env,OPENCLAW_STATE_DIR:state,OPENCLAW_CONFIG_PATH:join(state,'openclaw.json'),OPENCLAW_GATEWAY_PORT:'19100',OPENCLAW_PROFILE:'update-probe',GKOS_CELL:'update-probe',OPENCLAW_NO_AUTO_UPDATE:'1'};
function rpc(method,params={}){stage=method;const r=spawnSync(process.execPath,[resolve('packages/gkos-cli/bin/gateway-rpc.mjs'),binary],{env,input:JSON.stringify({method,params}),encoding:'utf8',timeout:85000});if(r.status!==0)throw new Error('RPC_FAILED');const v=JSON.parse(r.stdout);if(!v.ok)throw new Error('RPC_INVALID');return v.result;}
const checks=[];let stage='initialization';function check(name,value){stage=name;if(!value)throw new Error(name);checks.push(name);}
let gateway;
try{
 const v=spawnSync(binary,['--version'],{env,encoding:'utf8'});check('exact-version',v.status===0&&v.stdout.includes(version));
 check('config-valid',spawnSync(binary,['config','validate'],{env,stdio:'ignore'}).status===0);
 gateway=spawn(binary,['gateway','run'],{env,stdio:'ignore'});gateway.on('error',()=>{});
 const deadline=Date.now()+120000;for(;;){if(gateway.exitCode!==null)throw new Error('GATEWAY_EXIT');try{if((await fetch('http://127.0.0.1:19100/readyz')).ok)break;}catch{}if(Date.now()>deadline)throw new Error('GATEWAY_TIMEOUT');await new Promise(r=>setTimeout(r,500));}
 for(const endpoint of ['startupz','readyz','healthz'])check(endpoint,(await fetch('http://127.0.0.1:19100/'+endpoint)).ok);
 const s=rpc('os.status');check('kernel-schema',s.healthy&&s.kernelSchema===1);check('driver-healthy',s.gatekeepers.some(g=>g.vendor==='fs'&&g.healthy));check('no-grants-before',rpc('os.grants.list').length===0);
 const g=rpc('os.grants.introduce',{agentId:'main',url:new URL('file://'+state+'-resource'+'/').href});
 check('real-fs-grant',g.vendor==='fs'&&g.status==='active'&&typeof g.handle==='string');check('grant-listed',rpc('os.grants.list').some(row=>row.handle===g.handle));
 check('maintenance-on',rpc('os.maintenance.set',{enabled:true}).maintenance===true);check('zero-drained-runs',rpc('os.status').activeRuns===0);check('maintenance-off',rpc('os.maintenance.set',{enabled:false}).maintenance===false);
 check('grant-revoked',rpc('os.grants.revoke',{handle:g.handle}).revoked===true);
 writeFileSync(join(state,'runtime-verdict.json'),JSON.stringify({ok:true,upstreamVersion:version,scope:'update-runtime-checkpoint',fullConformance:false,checks})+'\n',{mode:0o600});
}catch{writeFileSync(join(state,'runtime-verdict.json'),JSON.stringify({ok:false,stage,checks,fullConformance:false})+'\n',{mode:0o600});throw new Error('RUNTIME_PROBE_FAILED');}finally{if(gateway){gateway.kill('SIGTERM');await new Promise(r=>{const timer=setTimeout(()=>{gateway.kill('SIGKILL');r();},10000);gateway.once('exit',()=>{clearTimeout(timer);r();});});}}
