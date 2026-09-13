// Actual Gateway agent turns; synthetic loopback model. Record booleans only, not prompts, bodies or credentials.
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const policy=process.env.GKOS_BLUEPRINT_POLICY,cell='blueprint-'+policy,state='/home/tester/.openclaw-'+cell;
if(!['runtime','messaging'].includes(policy)||process.env.OPENCLAW_STATE_DIR!==state||process.cwd()!=='/home/tester/src')throw new Error('VM required');
const roles=policy==='runtime'?['coder']:['assistant','ops','researcher'];
const before=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
const policySnapshot=JSON.stringify({tools:before.tools,sandbox:before.agents?.defaults?.sandbox});
const report={checks:{},turns:[],fullPhaseAcceptance:false,runId:process.env.GKOS_TEST_START},reportPath='/home/tester/phase-6-evidence/scenarios-'+policy+'.json';
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
function check(name,ok){report.checks[name]=ok===true;save();console.log((ok?'PASS ':'FAIL ')+name);if(!ok)throw new Error(name);}
function cli(args,binary='gkos'){const r=spawnSync(binary,args,{env:process.env,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});let value;try{value=JSON.parse(r.stdout);}catch{}return{ok:r.status===0,value,output:r.stdout+r.stderr};}
let current,paired,shared,serial=0;
const server=createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2_000_000)throw new Error();}
  const input=JSON.parse(raw);if(!current)throw new Error();
  current.requests++;const names=(input.tools??[]).map(t=>t.function?.name??t.name);current.names.push(names);
  const msgs=input.messages??[],lastUser=msgs.findLastIndex(m=>m.role==='user'),results=msgs.slice(lastUser+1).filter(m=>m.role==='tool');
  current.sawGuide ||= JSON.stringify(msgs).includes('Blueprint guide');
  for(const result of results){const text=typeof result.content==='string'?result.content:JSON.stringify(result.content);current.sawMarker ||= text.includes('BLUEPRINT_SANDBOX_OK');}
  const call=current.tool&&results.length===0&&current.calls===0;if(call)current.calls++;
  const id='bp'+(++serial),tc={id,type:'function',function:{name:current.tool,arguments:JSON.stringify({command:'test -e /.dockerenv && test ! -e /home/tester/blueprint-host-only && printf BLUEPRINT_SANDBOX_OK > /workspace/blueprint-proof && cat /workspace/blueprint-proof',host:'sandbox',timeoutSeconds:30})}};
  if(input.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});for(const part of [{delta:call?{role:'assistant',tool_calls:[{index:0,...tc}]}:{role:'assistant',content:'blueprint-turn-complete'},finish_reason:null},{delta:{},finish_reason:call?'tool_calls':'stop'}])res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'spike',choices:[{index:0,...part}]})+'\n\n');res.end('data: [DONE]\n\n');}
  else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id,object:'chat.completion',model:'spike',choices:[{index:0,message:call?{role:'assistant',content:null,tool_calls:[tc]}:{role:'assistant',content:'blueprint-turn-complete'},finish_reason:call?'tool_calls':'stop'}]}));}
}catch{res.writeHead(400);res.end('{}');}});
const require=createRequire(resolve('packages/gkos-conformance/package.json'));
const {GatewayClient}=await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
async function connect(auth){let client,timer;try{const hello=await new Promise((ok,no)=>{timer=setTimeout(()=>no(new Error('connect-timeout')),30000);client=new GatewayClient({url:'ws://127.0.0.1:'+process.env.OPENCLAW_GATEWAY_PORT,...auth,env:process.env,clientName:'cli',mode:'cli',role:'operator',scopes:['operator.admin'],requestTimeoutMs:120000,hostDeps:{logDebug(){},logError(){}},onHelloOk:ok,onConnectError:()=>no(new Error('connect-failed'))});client.start();});return{client,deviceToken:hello.auth?.deviceToken};}catch(e){await client?.stopAndWait({timeoutMs:5000});throw e;}finally{clearTimeout(timer);}}
try{
 const listing=cli(['blueprint','list','--json']);check('packed-four-blueprints',listing.ok&&listing.value?.length===4);
 const bad=cli(['blueprint','lint','test/fixtures/bad-blueprint-exec-no-sandbox','--json']);check('unsafe-lint-rejected',!bad.ok);
 for(const role of roles){
   const first=cli(['blueprint','apply',role,'--agent','bp-'+role,'--cell',cell,'--yes','--json']);check('apply-'+role,first.ok&&first.value?.changed===true);
   check('dependency-contract-'+role,role==='researcher'?!first.value.dependencyPending.includes('http'):first.value.dependencyPending.includes('github'));
   const second=cli(['blueprint','apply',role,'--agent','bp-'+role,'--cell',cell,'--yes','--json']);check('idempotent-'+role,second.ok&&second.value?.changed===false);
 }
 if(policy==='runtime'){
 const soul=state+'/agents/bp-coder/workspace/SOUL.md',original=readFileSync(soul,'utf8');writeFileSync(soul,original+'\nmanual drift\n');
 const diff=cli(['blueprint','diff','--agent','bp-coder','--cell',cell,'--json']);check('workspace-drift',diff.ok&&diff.value?.paths.includes('workspace/SOUL.md'));
 check('drift-reapply-refused',!cli(['blueprint','apply','coder','--agent','bp-coder','--cell',cell,'--yes']).ok);writeFileSync(soul,original);
 }else{
   const refused=cli(['blueprint','apply','coder','--agent','bp-coder','--cell',cell,'--yes']);
   check('messaging-coder-refused',!refused.ok);
   check('messaging-coder-create-command',refused.output.includes('gkos cell create blueprint-messaging-runtime --port 19111 --policy runtime'));
   check('messaging-coder-no-agent-created',!existsSync(state+'/agents/bp-coder'));
 }
 await new Promise((ok,no)=>{server.once('error',no);server.listen(19101,'127.0.0.1',ok);});
 const cfg=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
 check('apply-keeps-cell-global-policy',JSON.stringify({tools:cfg.tools,sandbox:cfg.agents?.defaults?.sandbox})===policySnapshot);
 check('apply-keeps-baseline',readFileSync(state+'/os/config.d/00-baseline.json5','utf8')===readFileSync('config/config.d/00-baseline.json5','utf8'));
 const token=readFileSync(state+'/.env','utf8').split('\n').find(line=>line.startsWith('GKOS_GATEWAY_TOKEN='))?.slice('GKOS_GATEWAY_TOKEN='.length);
 if(!token||!/^[a-f0-9]{64}$/.test(token))throw new Error('Cell token unavailable');
 shared=await connect({token});check('paired-device',typeof shared.deviceToken==='string');paired=await connect({deviceToken:shared.deviceToken});
 check('kernel-healthy',(await paired.client.request('os.status',{})).healthy===true);
 check('no-grants-created',(await paired.client.request('os.grants.list',{})).length===0);
 writeFileSync('/home/tester/blueprint-host-only','not available in sandbox',{mode:0o600});
 // Configuration reload is asynchronous; wait for this cell's applied IDs.
 for(let i=0;i<40;i++){const rows=await paired.client.request('agents.list',{});if((rows.agents??[]).filter(a=>a.id.startsWith('bp-')).length===roles.length)break;await new Promise(r=>setTimeout(r,500));}
 for(const role of roles){
   current={role,requests:0,calls:0,names:[],sawMarker:false,sawGuide:false,tool:role==='coder'?'exec':undefined};
   await paired.client.request('agent',{agentId:'bp-'+role,sessionKey:'agent:bp-'+role+':phase6-'+randomUUID(),message:'Run the isolated blueprint checkpoint once.',idempotencyKey:randomUUID()},{expectFinal:true,timeoutMs:120000});
   report.turns.push({role,requests:current.requests,calls:current.calls,sawMarker:current.sawMarker,toolNames:[...new Set(current.names.flat())]});save();
   check('model-turn-'+role,current.requests>0);check('guide-in-context-'+role,current.sawGuide);if(role==='researcher')check('researcher-web-only',current.names.some(n=>n.includes('web_search')&&n.includes('web_fetch'))&&current.names.every(n=>n.every(t=>['web_search','web_fetch'].includes(t))));else check('request-tool-'+role,current.names.some(n=>n.includes('os_request_access')));check('ungranted-gk-hidden-'+role,current.names.every(n=>!n.some(t=>t.startsWith('gk_'))));
   if(role==='coder'){check('coder-exec-present',current.names.some(n=>n.includes('exec')));check('coder-fs-present',current.names.some(n=>n.includes('read')&&n.includes('write')));check('coder-sandbox-exec-result',current.calls===1&&current.sawMarker);}
   else check('no-runtime-fs-tools-'+role,current.names.every(n=>!n.some(t=>['exec','process','read','write','edit','apply_patch'].includes(t))));
   current=undefined;
 }
 if(policy==='runtime'){
 check('runtime-default-sandbox-all',cfg.agents?.defaults?.sandbox?.mode==='all');
 const ids=spawnSync('docker',['ps','-aq','--filter','name=openclaw-sbx-'],{encoding:'utf8'}).stdout.trim().split('\n').filter(Boolean);
 check('sandbox-container-exists',ids.length>0);
 const inspected=JSON.parse(spawnSync('docker',['inspect',...ids],{encoding:'utf8'}).stdout);
 const candidates=inspected.filter(c=>c.Mounts.some(m=>m.Source===state+'/agents/bp-coder/workspace'&&m.Destination==='/workspace'));
 check('coder-container-unique',candidates.length===1);
 const coder=candidates[0];
 check('coder-docker-network-none',coder?.HostConfig.NetworkMode==='none');
 check('coder-docker-readonly-root',coder?.HostConfig.ReadonlyRootfs===true);
 check('coder-no-docker-socket',coder&&!coder.Mounts.some(m=>m.Source.endsWith('docker.sock')));
 check('coder-no-host-network',coder&&Object.keys(coder.NetworkSettings.Networks).every(n=>n==='none'));
 check('host-file-unchanged',readFileSync('/home/tester/blueprint-host-only','utf8')==='not available in sandbox');
 check('workspace-command-effect',existsSync(state+'/agents/bp-coder/workspace/blueprint-proof'));
 }
}finally{save();await paired?.client.stopAndWait({timeoutMs:5000});await shared?.client.stopAndWait({timeoutMs:5000});await new Promise(r=>server.close(r));}
