// All traffic stays in the disposable VM. Only structural evidence leaves this process.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
if (process.env.CLAWOS_KERNEL_VM !== '1' || process.env.OPENCLAW_STATE_DIR !== '/home/tester/.openclaw-kernel-test' || process.cwd() !== '/home/tester/src') throw new Error('VM required');
const require=createRequire(resolve('packages/clawos-conformance/package.json'));
const {GatewayClient}=await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
const config=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
const phase=process.argv[2]??'normal', reportPath=process.env.CLAWOS_SCENARIO_REPORT;
const report=phase==='normal'?{runId:process.env.CLAWOS_SCENARIO_RUN,checks:{},turns:[]}:JSON.parse(readFileSync(reportPath,'utf8'));
let current, serial=0, paired, shared, restricted;
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
function check(id,ok){report.checks[id]=ok===true;save();if(!ok)throw new Error(id);console.log('PASS '+id);}
const records=()=>{try{return readFileSync('/home/tester/.openclaw-kernel-test/os/hooks.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return[];}};
const server=createServer(async(req,res)=>{
  try {
    if(req.method!=='POST'||!current){res.writeHead(400);res.end('{}');return;}
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2_000_000)throw new Error();}
    const input=JSON.parse(raw),names=(input.tools??[]).map(t=>t.function?.name??t.name);
    current.names.push(names);
    const messages=input.messages??[],lastUser=messages.findLastIndex(m=>m.role==='user');
    const results=messages.slice(lastUser+1).filter(m=>m.role==='tool');
    // Fixture contents are compared in memory, never copied into logs or evidence.
    for(const result of results){const body=typeof result.content==='string'?result.content:JSON.stringify(result.content);
      current.sawResult=true;
      current.sawOverlay ||= body.includes('phase-three-overlay');
      current.sawInside ||= body.includes('inside-fixture-content');
      current.sawOutside ||= body.includes('outside-fixture-content');
      current.sawListing ||= body.includes('example.txt');
      current.sawDenial ||= /denied|no such grant|not active|blocked|not found|unavailable|not available/i.test(body);
    }
    const call=!!current.tool&&results.length===0&&current.calls===0;
    if(call)current.calls++;
    const id='kernel-probe-'+(++serial),tc={id,type:'function',function:{name:current.tool,arguments:JSON.stringify(current.params??{})}};
    const message=call?{role:'assistant',content:null,tool_calls:[tc]}:{role:'assistant',content:'scenario-complete'};
    if(input.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});for(const part of [{delta:call?{role:'assistant',tool_calls:[{index:0,...tc}]}:{role:'assistant',content:'scenario-complete'},finish_reason:null},{delta:{},finish_reason:call?'tool_calls':'stop'}])res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'spike',choices:[{index:0,...part}]})+'\n\n');res.end('data: [DONE]\n\n');}
    else {res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id,object:'chat.completion',model:'spike',choices:[{index:0,message,finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));}
  }catch{res.writeHead(400);res.end('{}');}
});
async function connect(auth,scopes=["operator.admin"]){let client,timer;try{const hello=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('connect-timeout')),30_000);client=new GatewayClient({url:'ws://127.0.0.1:19100',...auth,env:process.env,clientName:'cli',mode:'cli',role:'operator',scopes,requestTimeoutMs:120_000,hostDeps:{logDebug(){},logError(){}},onHelloOk:resolve,onConnectError:()=>reject(new Error('connect-failed'))});client.start();});return{client,deviceToken:hello.auth?.deviceToken};}catch(error){await client?.stopAndWait({timeoutMs:5000});throw error;}finally{clearTimeout(timer);}}
function cli(args, binary='clawos') {
  const result=spawnSync(binary,args,{env:process.env,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});
  if(result.status!==0||result.error)return {ok:false,exit:result.status,error:result.error?.code};
  try{return {ok:true,value:JSON.parse(result.stdout)};}catch{return {ok:false,exit:result.status,emptyStdout:!result.stdout.trim()};}
}
async function denied(client,method,params){try{await client.request(method,params);return false;}catch{return true;}}
async function turn(id,{tool,params={},agentId='main',message='Run the test operation once.',client=paired.client}={}){
  current={id,tool,params,names:[],calls:0,sawResult:false,sawInside:false,sawOverlay:false,sawOutside:false,sawListing:false,sawDenial:false};
  const before=records().length;
  try { await client.request('agent',{agentId,sessionKey:`agent:${agentId}:kernel-${id}`,message,idempotencyKey:randomUUID()},{expectFinal:true,timeoutMs:120_000}); }
  catch { throw new Error('turn-'+id); }
  const row={...current};delete row.params;row.hooks=records().slice(before).map(({hook,tool,callId,error,senderIsOwner})=>({hook,tool,callId,error,senderIsOwner}));
  report.turns.push(row);save();current=undefined;
  check(id+'-model-used',row.names.length>0);
  if(tool)check(id+'-tool-result',row.calls===1&&row.sawResult);
  check(id+'-no-outside-data',!row.sawOutside);
  return row;
}
try {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(19101,'127.0.0.1',resolve);});
  shared=await connect({token:config.gateway.auth.token});
  if(!shared.deviceToken)throw new Error('no-device-token');
  paired=await connect({deviceToken:shared.deviceToken});
  check(phase+'-kernel-ready',(await paired.client.request('os.status',{})).gatekeepers.some(g=>g.vendor==='fs'&&g.healthy));
  if(phase==='normal'){
    const plugins=cli(['plugins','list','--json'],'openclaw');
    const loaded=plugins.value?.plugins;
    for(const id of ['clawos-kernel','gatekeeper-fs']) check('plugin-loaded-'+id,plugins.ok&&Array.isArray(loaded)&&loaded.some(p=>p.id===id&&p.enabled===true&&p.status==='loaded'));
    const statusRpc=await paired.client.request('os.status',{});
    check('rpc-status',statusRpc.cell==='kernel-test'&&statusRpc.healthy===true&&Number.isInteger(statusRpc.pendingApprovals));
    const gatekeepersRpc=await paired.client.request('os.gatekeepers.list',{});
    check('rpc-gatekeepers',Array.isArray(gatekeepersRpc)&&gatekeepersRpc.some(g=>g.vendor==='fs'&&g.healthy===true));
    const grantsRpc=await paired.client.request('os.grants.list',{});
    check('rpc-grants',Array.isArray(grantsRpc)&&grantsRpc.length===0);
    const approvalsRpc=await paired.client.request('os.approvals.list',{});
    check('rpc-approvals',Array.isArray(approvalsRpc.actions)&&approvalsRpc.actions.length===0&&Array.isArray(approvalsRpc.requests)&&approvalsRpc.requests.length===0);
    const auditRpc=await paired.client.request('os.audit.query',{limit:10});
    check('rpc-audit',Array.isArray(auditRpc)&&auditRpc.length<=10);
    check('shared-auth-introduction-denied',await denied(shared.client,'os.grants.introduce',{agentId:'main',url:'file:///home/tester/kernel-resource/'}));
    check('forged-identity-denied',await denied(paired.client,'os.grants.introduce',{agentId:'main',url:'file:///home/tester/kernel-resource/',operatorId:'forged'}));
    check('outside-introduction-denied',await denied(paired.client,'os.grants.introduce',{agentId:'main',url:'file:///home/tester/kernel-outside/'}));
    const empty=await turn('no-grant',{tool:'os_list_grants'});
    check('no-grant-narrowing',empty.names.every(names=>names.length===2&&names.includes('os_list_grants')&&names.includes('os_request_access')));
    restricted=await connect({deviceToken:shared.deviceToken},['operator.write']);
    const pasted=await turn('untrusted-url',{client:restricted.client,agentId:'stranger',message:'Inspect file:///home/tester/kernel-resource/'});
    check('untrusted-sender-not-owner',pasted.hooks.some(h=>h.hook==='before_agent_run'&&h.senderIsOwner===false));
    check('untrusted-url-no-grant',(await paired.client.request('os.grants.list',{agentId:'stranger'})).length===0);
    check('untrusted-url-narrowing',pasted.names.every(names=>!names.some(n=>n.startsWith('gk_'))));
    await turn('request-access',{agentId:'stranger',tool:'os_request_access',params:{url:'file:///home/tester/kernel-resource/',reason:'Inspect the fixture'}});
    check('request-does-not-mint',(await paired.client.request('os.grants.list',{agentId:'stranger'})).length===0);
    const requests=(await paired.client.request('os.approvals.list',{})).requests;
    check('request-stored-bound-agent',requests.length===1&&requests[0].agentId==='stranger');
    check('request-shared-token-denied',await denied(shared.client,'os.requests.approve',{ids:[requests[0].id]}));
    check('request-operator-approved',(await paired.client.request('os.requests.approve',{ids:[requests[0].id]})).ids[0]===requests[0].id);
    const requested=await turn('request-granted',{agentId:'stranger',tool:'os_list_grants'});
    check('request-next-turn-tools',requested.names.every(names=>names.includes('gk_fs_dir_list')));
    const status=cli(['kernel','status','--cell','kernel-test','--json']);
    check('cli-kernel-status',status.ok&&status.value.cell==='kernel-test'&&status.value.gatekeepers.some(g=>g.vendor==='fs'&&g.healthy));
    const mounted=cli(['os','status','--json'],'openclaw');
    report.cliMountedDiagnostics={ok:mounted.ok,exit:mounted.exit,emptyStdout:mounted.emptyStdout,error:mounted.error};save();
    check('cli-upstream-mounted',mounted.ok&&mounted.value.cell==='kernel-test'&&mounted.value.healthy);
    const added=cli(['grant','add','--cell','kernel-test','--agent','main','file:///home/tester/kernel-resource/','--json']);
    check('cli-grant-add',added.ok&&added.value.status==='active');
    const grant=added.value;
    const grants=cli(['grant','list','--cell','kernel-test','--agent','main','--json']);
    check('cli-grant-list',grants.ok&&grants.value.some(g=>g.handle===grant.handle));
    check('cli-wrong-cell-denied',!cli(['grant','list','--cell','missing-kernel','--json']).ok);
    check('cli-invalid-input-denied',!cli(['grant','add','--cell','kernel-test','--agent','main','--operatorId','forged','file:///home/tester/kernel-resource/','--json']).ok);
    check('operator-introduced',grant.status==='active'&&/^grant:/.test(grant.handle));
    const listed=await turn('valid-list',{tool:'gk_fs_dir_list',params:{grant:grant.handle}});
    check('valid-grant-narrowing',listed.names.every(names=>names.length===5&&['os_list_grants','os_request_access','gk_fs_dir_list','gk_fs_file_read','gk_fs_file_write'].every(n=>names.includes(n))));
    check('directory-list-succeeded',listed.sawListing&&!listed.sawDenial);
    const before=listed.hooks.find(h=>h.hook==='before_tool_call'&&h.tool==='gk_fs_dir_list');
    check('hook-call-correlation',!!before?.callId&&listed.hooks.some(h=>h.hook==='after_tool_call'&&h.callId===before.callId));
    check('lifecycle-hooks-fired',['before_agent_run','before_prompt_build','agent_end'].every(name=>listed.hooks.some(h=>h.hook===name)));
    const read=await turn('valid-read',{tool:'gk_fs_file_read',params:{grant:grant.handle,path:'example.txt'}});
    check('file-read-succeeded',read.sawInside&&!read.sawDenial);
    const escape=await turn('path-escape',{tool:'gk_fs_file_read',params:{grant:grant.handle,path:'../kernel-outside/outside.txt'}});
    check('path-escape-denied',escape.sawDenial&&!escape.sawInside);
    const unknown=await turn('unknown-grant',{tool:'gk_fs_dir_list',params:{grant:'grant:zzzzzzzz'}});
    check('unknown-grant-denied',unknown.sawDenial&&!unknown.sawListing);
    const audit=await paired.client.request('os.audit.query',{limit:1000});
    check('successful-call-audited',audit.some(a=>a.kind==='tool'&&a.title==='gk_fs_dir_list'&&a.ok===true));
    check('observation-audited',audit.some(a=>a.kind==='observation'&&a.handle===grant.handle&&a.ok===true));
    check('unknown-policy-audited',audit.some(a=>a.kind==='tool'&&a.title==='Capability policy denied call'&&a.ok===false));
    const pendingWrite=await turn('pending-write',{tool:'gk_fs_file_write',params:{grant:grant.handle,path:'example.txt',content:'phase-three-overlay'}});
    check('simulated-write-succeeded',!pendingWrite.sawDenial);
    const pending=(await paired.client.request('os.approvals.list',{})).actions;
    check('write-pending-not-auto-applied',pending.length===1&&pending[0].status==='pending');
    check('simulated-write-host-unchanged',readFileSync('/home/tester/kernel-resource/example.txt','utf8')==='inside-fixture-content\n');
    const overlay=await turn('pending-read',{tool:'gk_fs_file_read',params:{grant:grant.handle,path:'example.txt'}});
    check('pending-read-sees-overlay',overlay.sawOverlay&&!overlay.sawInside);
    const rejection=cli(['approvals','reject',String(pending[0].id),'--cell','kernel-test','--json']);
    check('cli-reject-action',rejection.ok&&rejection.value.ids[0]===pending[0].id);
    const afterReject=await turn('rejected-read',{tool:'gk_fs_file_read',params:{grant:grant.handle,path:'example.txt'}});
    check('rejected-overlay-gone',afterReject.sawInside&&!afterReject.sawOverlay);
    check('rejection-audited',(await paired.client.request('os.audit.query',{limit:1000})).some(a=>a.kind==='action.decide'&&a.actionId===pending[0].id&&a.decision==='reject'&&a.ok));
    await turn('unsafe-write',{tool:'gk_fs_file_write',params:{grant:grant.handle,path:'example.txt',content:'phase-three-overlay'}});
    const unsafe=(await paired.client.request('os.approvals.list',{})).actions;
    check('unsafe-write-pending',unsafe.length===1);
    check('unsafe-write-apply-denied',await denied(paired.client,'os.approvals.apply',{ids:[unsafe[0].id]}));
    check('unsafe-write-host-unchanged',readFileSync('/home/tester/kernel-resource/example.txt','utf8')==='inside-fixture-content\n');
    check('unsafe-write-no-auto-retry',(await paired.client.request('os.approvals.list',{})).actions.length===0);
    check('uncertain-action-audited',(await paired.client.request('os.audit.query',{limit:1000})).some(a=>a.kind==='action.decide'&&a.actionId===unsafe[0].id&&a.decision==='failed'&&a.ok===false));
    const revokedCli=cli(['grant','revoke',grant.handle,'--cell','kernel-test','--json']);
    check('cli-grant-revoke',revokedCli.ok&&revokedCli.value.revoked===true);
    check('grant-revoked',revokedCli.ok&&revokedCli.value.revoked===true);
    const revoked=await turn('revoked-grant');
    check('revoked-tool-absent',revoked.names.every(names=>!names.some(n=>n.startsWith('gk_'))));
    const auditCli=cli(['audit','tail','--cell','kernel-test','--limit','1000','--json']);
    check('cli-audit-tail',auditCli.ok&&auditCli.value.some(a=>a.kind==='grant'&&a.handle===grant.handle&&a.decision==='revoked')&&auditCli.value.some(a=>a.kind==='observation'&&a.handle===grant.handle));
    check('revocation-audited',(await paired.client.request('os.audit.query',{limit:1000})).some(a=>a.kind==='grant'&&a.handle===grant.handle&&a.decision==='revoked'));
  } else {
    const unknown=await turn('hooks-disabled-unknown',{tool:'gk_fs_dir_list',params:{grant:'grant:zzzzzzzz'}});
    check('disabled-hooks-tools-visible',unknown.names.some(names=>names.includes('gk_fs_dir_list')));
    check('disabled-hooks-policy-denied',unknown.sawDenial&&!unknown.sawListing);
    check('disabled-hooks-policy-audited',(await paired.client.request('os.audit.query',{limit:1000})).some(a=>a.kind==='tool'&&a.sessionKey?.endsWith('kernel-hooks-disabled-unknown')&&a.title==='Capability policy denied call'&&a.ok===false));
  }
}catch(error){report.failure=/^[a-z0-9-]+$/.test(error.message)?error.message:'scenario-error';process.exitCode=1;console.log('FAIL '+report.failure);}
finally {save();await restricted?.client.stopAndWait({timeoutMs:5000});await shared?.client.stopAndWait({timeoutMs:5000});await paired?.client.stopAndWait({timeoutMs:5000});await new Promise(resolve=>server.close(resolve));}
