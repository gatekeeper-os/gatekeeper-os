import {selectCell} from './selector.mjs';
// All traffic stays in the disposable VM. Only structural evidence leaves this process.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
if (process.env.GKOS_KERNEL_VM !== '1' || process.env.OPENCLAW_STATE_DIR !== '/home/tester/.openclaw-kernel-test' || process.cwd() !== '/home/tester/npm-acceptance') throw new Error('VM required');
const require=createRequire(process.env.GKOS_UPSTREAM_PACKAGE_JSON);
const {GatewayClient}=await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
const nativeDenied=['exec','process','code_execution','read','write','edit','apply_patch','browser','cron','gateway'];
const cell=selectCell();
const phase='normal', reportPath=process.env.GKOS_SCENARIO_REPORT;
const report=phase==='normal'?{runId:process.env.GKOS_SCENARIO_RUN,checks:{},turns:[]}:JSON.parse(readFileSync(reportPath,'utf8'));
let current, serial=0, paired, shared, restricted;
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
function check(id,ok){report.checks[id]=ok===true;save();if(!ok)throw new Error(id);console.log('PASS '+id);}
const records=()=>{try{return readFileSync(cell.stateDir+'/os/hooks.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return[];}};
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
async function connect(auth,scopes=["operator.admin"]){let client,timer;try{const hello=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('connect-timeout')),30_000);client=new GatewayClient({url:cell.ws,...auth,env:process.env,clientName:'cli',mode:'cli',role:'operator',scopes,requestTimeoutMs:120_000,hostDeps:{logDebug(){},logError(){}},onHelloOk:resolve,onConnectError:()=>reject(new Error('connect-failed'))});client.start();});return{client,deviceToken:hello.auth?.deviceToken};}catch(error){await client?.stopAndWait({timeoutMs:5000});throw error;}finally{clearTimeout(timer);}}
function cli(args, binary='gkos') {
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
  check(id+'-messaging-native-denials',row.names.every(names=>!names.some(n=>nativeDenied.includes(n))));
  if(tool)check(id+'-tool-result',row.calls===1&&row.sawResult);
  check(id+'-no-outside-data',!row.sawOutside);
  return row;
}
const effects=()=>readFileSync('/home/tester/npm-acceptance/approval-effects.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse);
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(19101,'127.0.0.1',resolve);});
 shared=await connect({token:process.env.GKOS_GATEWAY_TOKEN});
 if(!shared.deviceToken)throw new Error('no-device-token');
 paired=await connect({deviceToken:shared.deviceToken});
 const health=await paired.client.request('os.status',{});
 check('real-kernel-and-fs-remain-healthy',health.gatekeepers.some(g=>g.vendor==='fs'&&g.healthy));
 check('synthetic-published-kit-driver-healthy',health.gatekeepers.some(g=>g.vendor==='fixture'&&g.healthy));
 const grant=await paired.client.request('os.grants.introduce',{agentId:'approval-fixture',url:'https://npm-acceptance.invalid/record'});
 check('fixture-owner-only-grant',grant.audience==='owner-only');
 for(const decision of ['apply','reject']){
  const row=await turn('fixture-'+decision,{agentId:'approval-fixture',tool:'gk_fixture_record',params:{grant:grant.handle}});
  check(decision+'-fixture-result',row.sawResult&&!row.sawDenial);
  check(decision+'-retained-tools-positive',row.names.every(names=>names.includes('gk_fixture_record')&&names.includes('os_list_grants')));
  const pending=(await paired.client.request('os.approvals.list',{})).actions;
  check(decision+'-exact-pending-action',pending.length===1&&pending[0].status==='pending');
  check(decision+'-shared-token-denied',await denied(shared.client,'os.approvals.'+decision,{ids:[pending[0].id]}));
  const before=effects().filter(e=>e.kind===decision).length;
  check(decision+'-not-auto-decided',before===0);
  const response=await paired.client.request('os.approvals.'+decision,{ids:[pending[0].id]});
  check(decision+'-operator-success',response.ids[0]===pending[0].id);
  check(decision+'-one-fixture-effect',effects().filter(e=>e.kind===decision).length===before+1);
  check(decision+'-pending-cleared',(await paired.client.request('os.approvals.list',{})).actions.length===0);
  check(decision+'-audited',(await paired.client.request('os.audit.query',{limit:1000})).some(a=>a.kind==='action.decide'&&a.actionId===pending[0].id&&a.decision===decision&&a.ok));
 }
 check('real-filesystem-still-unchanged',readFileSync('/home/tester/kernel-resource/example.txt','utf8')==='inside-fixture-content\n');
 report.scope={syntheticDriver:true,publishedKit:true,publishedKernel:true,realFilesystemWritesEnabled:false};
}catch(error){report.failure=/^[a-z0-9-]+$/.test(error.message)?error.message:'scenario-error';process.exitCode=1;console.log('FAIL '+report.failure);}
finally{save();await shared?.client.stopAndWait({timeoutMs:5000});await paired?.client.stopAndWait({timeoutMs:5000});await new Promise(resolve=>server.close(resolve));}
