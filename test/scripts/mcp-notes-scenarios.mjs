// Real Gateway/kernel, synthetic in-memory notes provider, deferred actions only.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
if(process.cwd()!=='/home/tester/src'||process.env.OPENCLAW_STATE_DIR!=='/home/tester/.openclaw-kernel-test')throw new Error('VM required');
const require=createRequire(resolve('packages/clawos-conformance/package.json'));
const {GatewayClient}=await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
const config=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
const report={checks:{},turns:[],syntheticProvider:true,nativeExecution:false,fullPhaseAcceptance:false};
const save=()=>writeFileSync('/home/tester/phase-8-boundary-evidence/deferred.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
function check(name,value){report.checks[name]=value===true;save();if(!value)throw new Error(name);console.log('PASS '+name);}
const provider=()=>JSON.parse(readFileSync('/home/tester/phase-8-boundary-evidence/fixture-provider.json','utf8'));
let current,serial=0,shared,paired;
const model=createServer(async(req,res)=>{
 try{
  if(req.method!=='POST'||!current)throw new Error();
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2000000)throw new Error();}
  const input=JSON.parse(raw);current.names.push((input.tools??[]).map(t=>t.function?.name??t.name));
  const messages=input.messages??[],lastUser=messages.findLastIndex(m=>m.role==='user');
  const results=messages.slice(lastUser+1).filter(m=>m.role==='tool');
  for(const result of results){const body=typeof result.content==='string'?result.content:JSON.stringify(result.content);current.result=true;current.overlay||=body.includes('fixture-base-fixture-change');current.base||=body.includes('fixture-base');current.denied||=/denied|no such grant|unavailable|blocked|not found/i.test(body);}
  const call=!!current.tool&&results.length===0&&current.calls===0;if(call)current.calls++;
  const id='mcpprobe'+(++serial),tc={id,type:'function',function:{name:current.tool,arguments:JSON.stringify(current.params??{})}};
  const message=call?{role:'assistant',content:null,tool_calls:[tc]}:{role:'assistant',content:'fixture-complete'};
  if(input.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});for(const part of [{delta:call?{role:'assistant',tool_calls:[{index:0,...tc}]}:{role:'assistant',content:'fixture-complete'},finish_reason:null},{delta:{},finish_reason:call?'tool_calls':'stop'}])res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'spike',choices:[{index:0,...part}]})+'\n\n');res.end('data: [DONE]\n\n');}
  else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id,object:'chat.completion',model:'spike',choices:[{index:0,message,finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));}
 }catch{res.writeHead(400);res.end('{}');}
});
async function connect(auth){let client,timer;try{const hello=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('connection-timeout')),30000);client=new GatewayClient({url:'ws://127.0.0.1:19100',...auth,env:process.env,clientName:'cli',mode:'cli',role:'operator',scopes:['operator.admin'],requestTimeoutMs:120000,hostDeps:{logDebug(){},logError(){}},onHelloOk:resolve,onConnectError:()=>reject(new Error('connection-failed'))});client.start();});return{client,deviceToken:hello.auth?.deviceToken};}finally{clearTimeout(timer);}}
async function denied(client,method,params){try{await client.request(method,params);return false;}catch{return true;}}
async function turn(id,tool,params,agentId='main'){
 current={id,tool,params,names:[],calls:0,result:false,base:false,overlay:false,denied:false};
 await paired.client.request('agent',{agentId,sessionKey:`agent:${agentId}:mcp-${id}`,message:'Run the synthetic fixture operation once.',idempotencyKey:randomUUID()},{expectFinal:true,timeoutMs:120000});
 const row={...current};delete row.params;report.turns.push(row);save();current=undefined;
 check(id+'-actual-model',row.names.length>0);if(tool)check(id+'-result',row.calls===1&&row.result);return row;
}
try{
 await new Promise((resolve,reject)=>{model.once('error',reject);model.listen(19101,'127.0.0.1',resolve);});
 shared=await connect({token:config.gateway.auth.token});paired=await connect({deviceToken:shared.deviceToken});
 check('fixture-lifecycle',(await paired.client.request('os.status',{})).gatekeepers.some(g=>g.vendor==='mcp'&&g.healthy));
 const url='https://mcp.clawkeeper.invalid/servers/demo';
 check('unpaired-introduction-denied',await denied(shared.client,'os.grants.introduce',{agentId:'main',url}));
 await paired.client.request('os.grants.introduce',{agentId:'main',url});
 const grants=await paired.client.request('os.grants.list',{agentId:'main'}),grant=grants.find(g=>g.vendor==='mcp');check('bound-grant-created',!!grant);
 const params={grant:grant.handle,noteId:'note1'},write={...params,text:'-fixture-change'};
 const read=await turn('read','gk_mcp_demo_read_note',params);check('read-projected',read.base&&!read.overlay&&!read.denied);
 const action=await turn('append','gk_mcp_demo_append_note',write);check('deferred-action-returned',!action.denied);
 let pending=(await paired.client.request('os.approvals.list',{})).actions;check('pending-with-no-provider-effect',pending.length===1&&pending[0].status==='pending'&&provider().effects===0);
 check('unpaired-apply-denied',await denied(shared.client,'os.approvals.apply',{ids:[pending[0].id]}));
 const overlay=await turn('overlay','gk_mcp_demo_read_note',params);check('deferred-overlay-observed',overlay.overlay&&!overlay.denied);
 await paired.client.request('os.approvals.reject',{ids:[pending[0].id]});
 const rejected=await turn('rejected','gk_mcp_demo_read_note',params);check('reject-removes-overlay-without-effect',rejected.base&&!rejected.overlay&&provider().effects===0);
 await turn('append-again','gk_mcp_demo_append_note',write);pending=(await paired.client.request('os.approvals.list',{})).actions;
 check('second-action-pending',pending.length===1&&provider().effects===0);
 await paired.client.request('os.approvals.apply',{ids:[pending[0].id]});check('operator-applied-once',provider().effects===1);
 check('duplicate-apply-denied',await denied(paired.client,'os.approvals.apply',{ids:[pending[0].id]}));check('no-duplicate-effect',provider().effects===1);
 check('truthful-no-revert',await denied(paired.client,'os.approvals.revert',{ids:[pending[0].id]}));
 const applied=await turn('applied','gk_mcp_demo_read_note',params);check('applied-read-projected',applied.overlay&&!applied.denied);
 const other=await turn('other-agent','os_list_grants',{},'stranger');check('cross-agent-tools-absent',other.names.every(names=>!names.some(n=>n.startsWith('gk_mcp_'))));
 const audit=await paired.client.request('os.audit.query',{limit:1000});
 check('observation-audit',audit.some(row=>row.kind==='observation'&&row.handle===grant.handle&&row.ok));
 check('decision-audit',audit.some(row=>row.kind==='action.decide'&&row.decision==='apply'&&row.ok));
 await paired.client.request('os.grants.revoke',{handle:grant.handle});
 const revoked=await turn('revoked','os_list_grants',{});check('revoked-tools-absent',revoked.names.every(names=>!names.some(n=>n.startsWith('gk_mcp_'))));
 check('no-native-execution',provider().nativeExecution===false);
}catch(error){console.log('FAIL '+(error instanceof Error&&/^[a-z0-9-]+$/.test(error.message)?error.message:'fixture-scenario'));process.exitCode=1;}
finally{save();await paired?.client.stopAndWait({timeoutMs:5000});await shared?.client.stopAndWait({timeoutMs:5000});await new Promise(resolve=>model.close(resolve));}
