// Public SDK only. No direct hook invocation, upstream database access, or returned bodies in evidence.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const state='/home/tester/.openclaw-kernel-test',root=state+'/os',phase=process.argv[2];
if(process.env.CLAWOS_KERNEL_VM!=='1'||process.env.OPENCLAW_STATE_DIR!==state||process.cwd()!=='/home/tester/src')throw new Error('VM required');
const require=createRequire(resolve('packages/clawos-conformance/package.json'));
const {GatewayClient}=await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
const config=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
const report=phase==='deny'?{runId:process.env.CLAWOS_SCENARIO_RUN,checks:{}}:JSON.parse(readFileSync(process.env.CLAWOS_SCENARIO_REPORT,'utf8'));
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
  return{ok:false,policy:/policy/i.test(diagnostic),cellPolicy:/not authorized by cell policy/i.test(diagnostic),shape:shape(value)};
}
async function attempt(client,method,params){
  try{
    const value=await client.request(method,params);
    return value&&typeof value==='object'&&value.ok===false?failedAttempt(value):{ok:true,value};
  }catch(error){return failedAttempt(error);}
}
try{
  const shared=await connect({token:config.gateway.auth.token});
  if(!shared.deviceToken)throw new Error('device-token-required');
  await shared.client.stopAndWait({timeoutMs:5000});
  const {client}=await connect({deviceToken:shared.deviceToken});
  const status=await client.request('os.status',{});
  check(phase+'-kernel-healthy',status.healthy===true);
  // Skills install into the requesting agent's workspace, so the agent segment belongs in the path.
  const agentId='main',target=state+'/workspace/'+agentId+'/skills/clawos-hook-fixture/SKILL.md';
  if(phase==='deny'){
    check('upload-opt-in-isolated',config.skills.install.allowUploadedArchives===true&&config.security.installPolicy.enabled===true&&config.plugins.entries['clawos-kernel'].config.install.allowSources.length===0);
    const archive=readFileSync('/home/tester/install-hook-fixture.zip'),sha256=createHash('sha256').update(archive).digest('hex');
    const begin={kind:'skill-archive',slug:'clawos-hook-fixture',sizeBytes:archive.length,sha256,force:false};
    const readOnly=await connect({deviceToken:shared.deviceToken},['operator.read']);
    const blocked=await attempt(readOnly.client,'skills.upload.begin',begin);
    check('read-scope-cannot-upload',!blocked.ok);
    await readOnly.client.stopAndWait({timeoutMs:5000});
    const commitArchive=async()=>{
      const {uploadId}=await client.request('skills.upload.begin',begin);
      await client.request('skills.upload.chunk',{uploadId,offset:0,dataBase64:archive.toString('base64')});
      const committed=await client.request('skills.upload.commit',{uploadId,sha256});
      return{uploadId,committed};
    };
    let {uploadId,committed}=await commitArchive();
    check('archive-committed-not-installed',committed.sha256===sha256&&!existsSync(target));
    const params={source:'upload',uploadId,slug:begin.slug,force:false,sha256,agentId};
    let before=events().length;
    const primary=await attempt(client,'skills.install',params);
    let rows=events().slice(before);
    report.diagnostics={primary:{attemptOk:primary.ok,policy:primary.policy,responseShape:primary.shape,targetExists:existsSync(target),rowCount:rows.length,stages:rows.map(e=>e.stage),allows:rows.map(e=>e.allow)}};save();
    check('primary-denies-before-hook',!primary.ok&&primary.policy&&!existsSync(target)&&rows.length>0&&rows.every(e=>e.stage==='primary'&&e.allow===false));
    ({uploadId,committed}=await commitArchive());
    check('replacement-archive-committed',committed.sha256===sha256&&!existsSync(target));
    Object.assign(params,{uploadId});
    writeFileSync(root+'/upload-fixture.json',JSON.stringify(params),{mode:0o600});
    writeFileSync(root+'/primary-rules.json',JSON.stringify({allowSources:['upload:'+uploadId]}),{mode:0o600});
    before=events().length;
    const secondary=await attempt(client,'skills.install',params);
    rows=events().slice(before);
    report.diagnostics.secondary={attemptOk:secondary.ok,policy:secondary.policy,cellPolicy:secondary.cellPolicy,responseShape:secondary.shape,targetExists:existsSync(target),rowCount:rows.length,stages:rows.map(e=>e.stage),allows:rows.map(e=>e.allow)};save();
    check('primary-allows-before-secondary',rows.some(e=>e.stage==='primary'&&e.allow===true)&&!rows.some(e=>e.stage==='primary'&&!e.allow));
    check('secondary-sees-typed-material',rows.some(e=>e.stage==='before'&&e.targetSkill&&e.directory&&e.upload));
    check('secondary-denies-unlisted-upload',!secondary.ok&&secondary.cellPolicy&&!existsSync(target));
    check('secondary-block-terminal',rows.some(e=>e.stage==='before')&&!rows.some(e=>e.stage==='after'));
    ({uploadId,committed}=await commitArchive());
    check('allow-archive-committed',committed.sha256===sha256&&!existsSync(target));
    Object.assign(params,{uploadId});
    writeFileSync(root+'/upload-fixture.json',JSON.stringify(params),{mode:0o600});
    writeFileSync(root+'/primary-rules.json',JSON.stringify({allowSources:['upload:'+uploadId]}),{mode:0o600});
  }else if(phase==='allow'){
    const params=JSON.parse(readFileSync(root+'/upload-fixture.json','utf8'));
    check('secondary-exact-operator-rule',config.plugins.entries['clawos-kernel'].config.install.allowSources.length===1&&config.plugins.entries['clawos-kernel'].config.install.allowSources[0]==='upload:'+params.uploadId&&!existsSync(target));
    const before=events().length;
    const allowed=await attempt(client,'skills.install',params),rows=events().slice(before);
    check('both-boundaries-allow',allowed.ok&&allowed.value.ok===true&&rows.some(e=>e.stage==='primary'&&e.allow===true)&&rows.some(e=>e.stage==='before')&&rows.some(e=>e.stage==='after')&&!rows.some(e=>e.stage==='primary'&&!e.allow));
    check('installed-fixture-exact',existsSync(target)&&readFileSync(target,'utf8')==='---\nname: clawos-hook-fixture\ndescription: Inert VM install acceptance fixture.\n---\nNo actions.\n');
    const grants=await client.request('os.grants.list',{});
    check('install-mints-no-grants',Array.isArray(grants)&&grants.length===0);
    const again=await attempt(client,'skills.install',params);
    check('consumed-upload-cannot-replay',!again.ok);
  }else throw new Error('invalid-phase');
}catch(e){report.failure=/^[a-z-]+$/.test(e.message)?e.message:'scenario-failed';save();console.error('FAIL '+report.failure);process.exitCode=1;}
finally{for(const client of clients)await client.stopAndWait({timeoutMs:5000});}
