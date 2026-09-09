// Real nonofficial registry plugin through Gateway plugins.install.
// Exact package/version is a fixture, not a floating registry selection.
// Public SDK only. No direct hook invocation, upstream database access, or returned bodies in evidence.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const state='/home/tester/.openclaw-kernel-test',root=state+'/os';
if(process.env.CLAWOS_KERNEL_VM!=='1'||process.env.OPENCLAW_STATE_DIR!==state||process.cwd()!=='/home/tester/src')throw new Error('VM required');
const require=createRequire(resolve('packages/clawos-conformance/package.json'));
const {GatewayClient}=await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
const config=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
const report={runId:process.env.CLAWOS_SCENARIO_RUN,checks:{},surface:'plugins.install'};
const save=()=>writeFileSync(process.env.CLAWOS_SCENARIO_REPORT,JSON.stringify(report,null,2)+'\n',{mode:0o600});
function check(id,ok){report.checks[id]=ok===true;save();if(!ok)throw new Error(id);console.log('PASS '+id);}
const events=()=>existsSync(root+'/install-events.jsonl')?readFileSync(root+'/install-events.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const clients=[];
async function connect(auth,scopes=['operator.admin']){
  let client,timer;try{
    const hello=await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('connect-timeout')),30000);
      client=new GatewayClient({url:'ws://127.0.0.1:19100',...auth,env:process.env,clientName:'cli',mode:'cli',role:'operator',scopes,requestTimeoutMs:120000,hostDeps:{logDebug(){},logError(){}},onHelloOk:resolve,onConnectError:()=>reject(new Error('connect-failed'))});
      clients.push(client);client.start();
    });return {client,deviceToken:hello.auth?.deviceToken};
  }finally{clearTimeout(timer);}
}
function diagnosticFields(value,depth=0){
  if(depth>2||!value||typeof value!=='object')return[];
  return['error','message','errorCode','code','reason','details'].flatMap(key=>{
    const field=value[key];
    return typeof field==='string'?[field]:diagnosticFields(field,depth+1);
  }).slice(0,8);
}
function shape(value){
  return value&&typeof value==='object'
    ? {keys:Object.keys(value).sort(),fieldTypes:Object.fromEntries(['error','message','errorCode','code','reason','details'].filter(key=>key in value).map(key=>[key,typeof value[key]]))}
    : {type:typeof value};
}
function failedAttempt(value){
  const diagnostic=diagnosticFields(value).join(' ');
  return{ok:false,policy:/policy/i.test(diagnostic),cellPolicy:/not authorized by cell policy/i.test(diagnostic),categories:Object.entries({unknownCatalog:/unknown official plugin catalog entry/i,network:/fetch|network|timed? ?out|ENOTFOUND|ECONN/i,compatibility:/incompatible|requires.*version|host version/i,packaging:/requires compiled runtime output|plugin packaging issue/i,consent:/capabilit|consent|acknowledg/i,config:/config|Nix mode|mutation/i,notFound:/not found|404/i}).filter(([,pattern])=>pattern.test(diagnostic)).map(([name])=>name),shape:shape(value)};
}
async function attempt(client,method,params){
  try{
    const value=await client.request(method,params);
    return value&&typeof value==='object'&&value.ok===false?failedAttempt(value):{ok:true,value};
  }catch(error){return failedAttempt(error);}
}
try{
  const shared=await connect({token:config.gateway.auth.token});
  const paired=await connect({deviceToken:shared.deviceToken});
  const client=paired.client;
  check('plugin-kernel-healthy',(await client.request('os.status',{})).healthy===true);
  check('plugin-secondary-deny-all',config.plugins.entries['clawos-kernel'].config.install.allowSources.length===0);
  const unchanged=()=>readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8');
  const initial=unchanged();
  const fixture=JSON.parse(readFileSync('test/fixtures/plugin-install-hook-monitor/candidate.json','utf8'));
  const catalog=await client.request('plugins.list',{});
  const candidate={id:fixture.pluginId,packageName:fixture.packageName};
  check('plugin-catalog-mutation-allowed',catalog.mutationAllowed===true);
  check('plugin-initially-not-installed',!catalog.plugins.some(p=>p.id===candidate.id&&p.installed===true)&&!existsSync(state+'/extensions/'+candidate.id));
  const params={source:'clawhub',packageName:candidate.packageName,version:fixture.version};
  report.pluginId=candidate.id;report.packageName=candidate.packageName;report.version=fixture.version;report.fixtureArtifactSha256=fixture.artifactSha256;save();
  let before=events().length;
  const denied=await attempt(client,'plugins.install',params);
  let rows=events().slice(before);
  report.primary={ok:denied.ok,policy:denied.policy,shape:denied.shape,categories:denied.categories,stages:rows.map(r=>r.stage)};save();
  check('plugin-primary-denial',!denied.ok&&rows.some(r=>r.stage==='primary'&&!r.allow)&&!rows.some(r=>r.stage==='before'));
  check('plugin-primary-no-config-mutation',unchanged()===initial);
  // Fixture-only independent primary authority; the real kernel remains deny-all.
  writeFileSync(root+'/primary-rules.json',JSON.stringify({allowSources:['*']}),{mode:0o600});
  before=events().length;
  const deniedSecondary=await attempt(client,'plugins.install',params);
  rows=events().slice(before);
  report.secondary={ok:deniedSecondary.ok,policy:deniedSecondary.policy,cellPolicy:deniedSecondary.cellPolicy,shape:deniedSecondary.shape,categories:deniedSecondary.categories,stages:rows.map(r=>r.stage),pluginMaterial:rows.some(r=>r.targetPlugin),exactMaterial:rows.some(r=>r.exactMaterial)};save();
  check('plugin-primary-allows',rows.some(r=>r.stage==='primary'&&r.allow)&&!rows.some(r=>r.stage==='primary'&&!r.allow));
  check('plugin-typed-before-install',rows.some(r=>r.stage==='before'&&r.targetPlugin&&r.pluginRequest));
  check('plugin-exact-staged-material',rows.some(r=>r.stage==='before'&&r.exactMaterial));
  check('plugin-secondary-denies',!deniedSecondary.ok&&deniedSecondary.cellPolicy);
  check('plugin-block-terminal',!rows.some(r=>r.stage==='after'));
  check('plugin-secondary-no-config-mutation',unchanged()===initial);
  check('plugin-not-installed',!(await client.request('plugins.list',{})).plugins.some(p=>p.id===candidate.id&&p.installed===true)&&!existsSync(state+'/extensions/'+candidate.id));
  check('plugin-mints-no-grants',(await client.request('os.grants.list',{})).length===0);
}catch(e){report.failure=/^[a-z-]+$/.test(e.message)?e.message:'scenario-failed';save();console.error('FAIL '+report.failure);process.exitCode=1;}
finally{for(const client of clients)await client.stopAndWait({timeoutMs:5000});save();}
