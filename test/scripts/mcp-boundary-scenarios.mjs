import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
if(process.cwd()!=='/home/tester/src'||process.env.OPENCLAW_STATE_DIR!=='/home/tester/.openclaw-kernel-test')throw new Error('VM required');
const require=createRequire(resolve('packages/clawos-conformance/package.json'));
const {GatewayClient}=await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
const cfg=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8')),report={checks:{},fullPhaseAcceptance:false,realMcpProvider:false,toolExecutionEnabled:false};
function check(name,value){report.checks[name]=value===true;writeFileSync('/home/tester/phase-8-boundary-evidence/gateway.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});if(!value)throw new Error(name);console.log('PASS '+name);}
async function connect(auth){let client,timer;try{const hello=await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('connection-timeout')),30000);client=new GatewayClient({url:'ws://127.0.0.1:19100',...auth,env:process.env,clientName:'cli',mode:'cli',role:'operator',scopes:['operator.admin'],requestTimeoutMs:30000,hostDeps:{logDebug(){},logError(){}},onHelloOk:resolve,onConnectError:()=>reject(new Error('connection-failed'))});client.start();});return {client,deviceToken:hello.auth?.deviceToken};}finally{clearTimeout(timer);}}
async function denied(client,method,params){try{await client.request(method,params);return false;}catch{return true;}}
let shared,paired;
try{
 shared=await connect({token:cfg.gateway.auth.token});check('paired-device-issued',typeof shared.deviceToken==='string');paired=await connect({deviceToken:shared.deviceToken});
 const status=await paired.client.request('os.status',{});
 check('mcp-lifecycle-healthy',status.gatekeepers.some(g=>g.vendor==='mcp'&&g.healthy));
 check('filesystem-lifecycle-preserved',status.gatekeepers.some(g=>g.vendor==='fs'&&g.healthy));
 check('unconfigured-account-denied',await denied(paired.client,'os.gatekeepers.connect',{vendor:'mcp'}));
 check('unconfigured-server-denied',await denied(paired.client,'os.grants.introduce',{agentId:'main',url:'https://mcp.clawkeeper.invalid/servers/demo'}));
 check('shared-token-introduction-denied',await denied(shared.client,'os.grants.introduce',{agentId:'main',url:'https://mcp.clawkeeper.invalid/servers/demo'}));
 const list=await paired.client.request('os.grants.list',{});
 check('no-mcp-grants-created',!JSON.stringify(list).includes('"vendor":"mcp"'));
 const manifest=JSON.parse(readFileSync('packages/gatekeeper-mcp/openclaw.plugin.json','utf8'));
 check('no-model-tools-registered',manifest.contracts.tools.length===0);
}catch{process.exitCode=1;}finally{await paired?.client.stopAndWait({timeoutMs:5000});await shared?.client.stopAndWait({timeoutMs:5000});}
