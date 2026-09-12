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
const phase='normal', reportPath=process.env.CLAWOS_SCENARIO_REPORT;
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
  const before=0;
  try { await client.request('agent',{agentId,sessionKey:`agent:${agentId}:kernel-${id}`,message,idempotencyKey:randomUUID()},{expectFinal:true,timeoutMs:120_000}); }
  catch { throw new Error('turn-'+id); }
  const row={...current};delete row.params;row.hooks=[];
  report.turns.push(row);save();current=undefined;
  check(id+'-model-used',row.names.length>0);
  if(tool)check(id+'-tool-result',row.calls===1&&row.sawResult);
  check(id+'-no-outside-data',!row.sawOutside);
  return row;
}

const effects=()=>readFileSync('/home/tester/phase5-effects.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse);
const deliveries=()=>readFileSync('/home/tester/phase5-delivery.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse);
const actions=async()=> (await paired.client.request('os.approvals.list',{includeDecided:true})).actions;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,timeout=35000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await predicate())return;await wait(100);}throw new Error('condition-timeout');}
let handle;
async function submit(id,overrides={}){return turn(id,{tool:'gk_fs_file_write',params:{grant:handle,eligible:true,tag:'github.issue.comment',count:1,delay:false,...overrides}});}
try {
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(19101,'127.0.0.1',resolve);});
 shared=await connect({token:config.gateway.auth.token});paired=await connect({deviceToken:shared.deviceToken});
 check('kernel-ready',(await paired.client.request('os.status',{})).healthy===true);
 handle=(await paired.client.request('os.grants.introduce',{agentId:'main',url:'file:///phase5-fixture/'})).handle;
 check('real-operator-grant',/^grant:[a-z0-9]{8}$/.test(handle));
 await submit('missing-author-rule',{tag:'not.configured'});
 check('no-operator-rule-no-effect',effects().filter(x=>x.kind==='apply').length===0);
 const first=(await actions()).at(-1).id;
 await paired.client.request('os.approvals.reject',{ids:[first]});
 await submit('missing-author-flag',{eligible:false,count:2});
 const blocked=(await actions()).filter(x=>x.status==='pending');
 check('two-actions-one-run',blocked.length===2);
 check('no-author-flag-no-effect',effects().filter(x=>x.kind==='apply').length===0);
 // Agent RPC acknowledgement can precede agent_end delivery; observe the channel adapter receipt.
 await until(()=>deliveries().length>=2);
 const n=deliveries().length;await wait(1000);
 check('one-digest-per-pending-run',n===2&&deliveries().length===2);
 check('digest-fixed-metadata-only',deliveries().every(x=>x.digest&&x.noBody));
 const listed=spawnSync('clawos',['approvals','list','--cell','kernel-test'],{env:process.env,encoding:'utf8',timeout:90000});
 check('cli-table',listed.status===0&&listed.stdout.includes('STATUS')&&listed.stdout.includes('Synthetic action')&&!listed.stdout.includes('VM-only recorded effect'));
 const preview=spawnSync('clawos',['approvals','preview',String(blocked[0].id),'--cell','kernel-test'],{env:process.env,encoding:'utf8',timeout:90000});
 check('cli-explicit-preview',preview.status===0&&preview.stdout.includes('VM-only recorded effect')&&preview.stdout.includes('Revert supported: yes'));
 await submit('eligible-behind-head');
 const last=(await actions()).at(-1);
 check('head-blocks-eligible-tail',last.status==='pending'&&effects().filter(x=>x.kind==='apply').length===0);
 await paired.client.request('os.approvals.reject',{ids:blocked.map(x=>x.id)});
 check('decision-resumes-ordered-drain',(await actions()).find(x=>x.id===last.id).status==='applied'&&effects().filter(x=>x.kind==='apply').length===1);
 // Delayed submission occurs after agent_end, so only the timer can apply it.
 await submit('timer-only',{delay:true});
 await until(()=>effects().filter(x=>x.kind==='submit').length===5);
 const delayed=effects().filter(x=>x.kind==='submit').at(-1);
 await until(()=>effects().some(x=>x.kind==='apply'&&x.id===delayed.id));
 const applied=effects().find(x=>x.kind==='apply'&&x.id===delayed.id);
 report.timerElapsedMs=applied.ts-delayed.ts;save();
 check('timer-within-thirty-seconds',report.timerElapsedMs>=0&&report.timerElapsedMs<=30000);
 await submit('command-target',{eligible:false});
 const commandAction=(await actions()).at(-1);
 for(const scenario of ['command-outsider','command-group','command-forged','command-owner']) {
  current={id:scenario,names:[],calls:0};
  const result=await paired.client.request('vm.channel.dispatch',{scenario,command:'/approvals'},{timeoutMs:120000});
  check(scenario+'-no-model',current.names.length===0);
  check(scenario+'-delivery',scenario==='command-owner'?result.commandResult===true:result.delivered===0);
  current=undefined;
 }
 current={id:'approve-command',names:[],calls:0};
 const approve=await paired.client.request('vm.channel.dispatch',{scenario:'command-owner',command:'/approve '+commandAction.id},{timeoutMs:120000});
 check('approve-command-claimed',current.names.length===0&&approve.delivered===1);current=undefined;
 check('approve-command-effect',(await actions()).find(x=>x.id===commandAction.id).status==='applied');
 const reverted=cli(['approvals','revert',String(commandAction.id),'--cell','kernel-test','--json']);
 check('cli-revert',reverted.ok&&(await actions()).find(x=>x.id===commandAction.id).status==='reverted');
 await submit('reject-command-target',{eligible:false});const rejected=(await actions()).at(-1);
 current={id:'reject-command',names:[],calls:0};
 await paired.client.request('vm.channel.dispatch',{scenario:'command-owner',command:'/reject '+rejected.id},{timeoutMs:120000});
 check('reject-command-claimed',current.names.length===0);current=undefined;
 check('reject-command-effect',(await actions()).find(x=>x.id===rejected.id).status==='rejected');
 current={id:'grant-command',names:[],calls:0};
 await paired.client.request('vm.channel.dispatch',{scenario:'command-owner',command:'/grant file:///phase5-fixture/'},{timeoutMs:120000});
 check('grant-command-claimed',current.names.length===0);current=undefined;
 check('grant-command-operator-bound',(await paired.client.request('os.grants.list',{agentId:'command'})).length===1);
 restricted=await connect({deviceToken:shared.deviceToken},['operator.read']);
 check('read-only-cannot-decide',await denied(restricted.client,'os.approvals.revert',{ids:[last.id]}));
 check('no-pending-actions',(await paired.client.request('os.approvals.list',{})).actions.length===0);
 report.status='passed';save();
}catch(error){report.failure=/^[a-z0-9-]+$/.test(error.message)?error.message:'scenario-error';process.exitCode=1;console.log('FAIL '+report.failure);}
finally{save();await restricted?.client.stopAndWait({timeoutMs:5000});await shared?.client.stopAndWait({timeoutMs:5000});await paired?.client.stopAndWait({timeoutMs:5000});await new Promise(resolve=>server.close(resolve));}
