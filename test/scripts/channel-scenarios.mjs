// VM-only genuine public SDK channel dispatch; evidence contains structure, never model bodies.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync,writeFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
if(process.env.CLAWOS_KERNEL_VM!=='1'||process.env.OPENCLAW_STATE_DIR!=='/home/tester/.openclaw-kernel-test'||process.cwd()!=='/home/tester/src')throw new Error('VM required');
const require=createRequire(resolve('packages/clawos-conformance/package.json'));
const gatewayRuntimePath=require.resolve('openclaw/plugin-sdk/gateway-runtime');
const {GatewayClient}=await import(pathToFileURL(gatewayRuntimePath).href);
const controlUiBuildId=readFileSync(resolve(dirname(gatewayRuntimePath),'../control-ui/sw.js'),'utf8').match(/EMBEDDED_CACHE_VERSION\s*=\s*"([^"]+)"/)?.[1];
if(!controlUiBuildId)throw new Error('control-ui-build-id-missing');
const config=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
const reportPath=process.env.CLAWOS_SCENARIO_REPORT,report={runId:process.env.CLAWOS_SCENARIO_RUN,checks:{},turns:[]};
let current,paired,shared,controlUi;
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
function check(id,ok){report.checks[id]=ok===true;save();if(!ok)throw new Error(id);console.log('PASS '+id);}
const server=createServer(async(req,res)=>{
 try{
  if(req.method!=='POST'||!current)throw new Error();
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2000000)throw new Error();}
  const input=JSON.parse(raw);current.names.push((input.tools??[]).map(t=>t.function?.name??t.name));
  if(current.names.length===1)current.notice=JSON.stringify(input.messages??[]).includes('You now have access to fs');
  const id='channel-probe';
  if(input.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});for(const part of [{delta:{role:'assistant',content:'scenario-complete'},finish_reason:null},{delta:{},finish_reason:'stop'}])res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'spike',choices:[{index:0,...part}]})+'\n\n');res.end('data: [DONE]\n\n');}
  else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id,object:'chat.completion',model:'spike',choices:[{index:0,message:{role:'assistant',content:'scenario-complete'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));}
 }catch{res.writeHead(400);res.end('{}');}
});
async function connect(auth,scopes=["operator.admin"],identity={clientName:'cli',mode:'cli'}){let client,timer;try{const hello=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('connect-timeout')),30_000);client=new GatewayClient({url:'ws://127.0.0.1:19100',...auth,env:process.env,...identity,role:'operator',scopes,requestTimeoutMs:120_000,hostDeps:{logDebug(){},logError(){}},onHelloOk:resolve,onConnectError:(error)=>{console.log('CONNECT '+(error?.code??error?.name??'error')+' '+String(error?.message??'').replace(/[A-Za-z0-9_-]{24,}/g,'[redacted]'));reject(new Error('connect-failed'));}});client.start();});return{client,deviceToken:hello.auth?.deviceToken};}catch(error){await client?.stopAndWait({timeoutMs:5000});throw error;}finally{clearTimeout(timer);}}
async function waitForModel(){const deadline=Date.now()+120_000;while(current?.names.length===0&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));if(current?.names.length===0)throw new Error('model-timeout');}
try {
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(19101,'127.0.0.1',resolve);});
 shared=await connect({token:config.gateway.auth.token});paired=await connect({deviceToken:shared.deviceToken});
 check('kernel-ready',(await paired.client.request('os.status',{})).healthy===true);
 controlUi=await connect({token:config.gateway.auth.token},['operator.admin'],{clientName:'openclaw-control-ui',clientVersion:'control-ui',clientBuildId:controlUiBuildId,mode:'webchat',origin:'http://127.0.0.1:19100',minProtocol:4,maxProtocol:4});
 current={id:'control-ui-owner',names:[],notice:false};
 await controlUi.client.request('chat.send',{sessionKey:'agent:console:main',message:'Inspect file:///home/tester/kernel-resource/',idempotencyKey:randomUUID()});
 await waitForModel();
 report.controlUiDispatchShape=await paired.client.request('vm.channel.last-dispatch-shape',{});save();
 check('control-ui-owner-model-used',current.names.length===1);
 check('control-ui-owner-first-request-tools',current.names[0].includes('gk_fs_dir_list'));
 check('control-ui-owner-notice',current.notice===true);
 check('control-ui-owner-grant-state',(await paired.client.request('os.grants.list',{agentId:'console'})).length===1);
 report.turns.push(current);save();current=undefined;
 current={id:'gateway-forged-label',names:[],notice:false};
 await paired.client.request('agent',{agentId:'forged',sessionKey:'agent:forged:vmchan:group:rpc-forgery',channel:'vmchan',replyChannel:'vmchan',to:'operator',deliver:false,message:'Inspect file:///home/tester/kernel-resource/',idempotencyKey:randomUUID()},{expectFinal:true,timeoutMs:120000});
 check('gateway-forged-label-model-used',current.names.length>0);
 check('gateway-forged-label-no-tools',current.names.every(names=>!names.some(n=>n.startsWith('gk_'))));
 check('gateway-forged-label-no-notice',!current.notice);
 check('gateway-forged-label-no-grants',(await paired.client.request('os.grants.list',{agentId:'forged'})).length===0);
 report.turns.push(current);save();current=undefined;
 for(const id of ['nonowner','forged','owner','observer']){
  current={id,names:[],notice:false};
  const result=await paired.client.request('vm.channel.dispatch',{scenario:id},{timeoutMs:120000});
  check(id+'-dispatched',result.dispatched===true);
  check(id+'-provider-owner-resolver',result.ownerResolverCalled===true);
  check(id+'-model-used',current.names.length===1);
  const grants=await paired.client.request('os.grants.list',{agentId:id==='nonowner'?'stranger':id==='forged'?'forged':'main'});
  const first=current.names[0];
  check(id+'-first-request-tools',id==='owner'?first.includes('gk_fs_dir_list'):!first.some(n=>n.startsWith('gk_')));
  check(id+'-grant-state',id==='owner'||id==='observer'?grants.length===1:grants.length===0);
  check(id+'-notice',id==='owner'?current.notice===true:current.notice===false);
  report.turns.push(current);save();current=undefined;
 }
}catch(error){report.failure=/^[a-z0-9-]+$/.test(error.message)?error.message:'scenario-error';process.exitCode=1;console.log('FAIL '+report.failure);}
finally{save();await controlUi?.client.stopAndWait({timeoutMs:5000});await shared?.client.stopAndWait({timeoutMs:5000});await paired?.client.stopAndWait({timeoutMs:5000});await new Promise(resolve=>server.close(resolve));}
