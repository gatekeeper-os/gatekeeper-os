// Test-only additions to a real npm-created messaging cell. Never constructs/replaces its baseline.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {selectCell,configGet} from './selector.mjs';
import {checkedCatalogTools} from './catalog-policy.mjs';
const cell=selectCell(),state=cell.stateDir,file=cell.file;
if(process.env.GKOS_KERNEL_VM!=='1'||process.cwd()!=='/home/tester/npm-acceptance'||process.env.OPENCLAW_STATE_DIR!==state||process.env.OPENCLAW_CONFIG_PATH!==file)throw new Error('VM required');
const cfg=JSON.parse(readFileSync(file,'utf8')),mode=process.argv[2]??'normal';
const entry=cfg.plugins?.entries?.['gkos-kernel'];
const liveTools=configGet('tools'), livePlugins=configGet('plugins'), liveSecurity=configGet('security');
if(!livePlugins.entries?.['gkos-kernel']?.enabled||!livePlugins.entries?.['gkos-gatekeeper-fs']?.enabled||liveTools.profile!=='messaging'||liveTools.exec?.mode!=='deny'||!['group:runtime','group:fs','group:automation','browser'].every(x=>liveTools.deny?.includes(x)))throw new Error('installed messaging cell required');
if(cfg.gateway.auth.token?.source!=='env'||cfg.gateway.auth.token.id!=='GKOS_GATEWAY_TOKEN'||!process.env.GKOS_GATEWAY_TOKEN)throw new Error('canonical cell token required');
if(!liveSecurity.installPolicy?.enabled||!liveSecurity.installPolicy.exec.command||!existsSync(cell.catalog))throw new Error('installed policy and catalog required');
const protect=()=>JSON.stringify({tools:cfg.tools,token:cfg.gateway.auth,installPolicy:cfg.security.installPolicy,install:entry.config.install,defaultsSandbox:cfg.agents.defaults.sandbox});
let protectedBefore=protect();
function addPlugin(id,folder){
 cfg.plugins.allow=[...new Set([...cfg.plugins.allow,id])];
 cfg.plugins.load.paths=[...new Set([...cfg.plugins.load.paths,resolve(folder)])];
 cfg.plugins.entries[id]={enabled:true,hooks:{allowConversationAccess:true}};
}
function agent(id,isDefault=false){
 // This matches the messaging assistant blueprint's sandbox choice; global fs/exec denial is intact.
 const value={...(!cfg.agents.entries&&isDefault?{default:true}:{}),workspace:join(state,'agents',id,'workspace'),model:{primary:'spike/spike'},sandbox:{mode:'off'}};
 mkdirSync(value.workspace,{recursive:true,mode:0o700});
 if(cfg.agents.entries){if(cfg.agents.entries[id]&&id!=='main')throw new Error('fixture-agent-collision');cfg.agents.entries[id]={...cfg.agents.entries[id],...value};}
 else{cfg.agents.list??=[];const existing=cfg.agents.list.find(a=>a.id===id);if(existing){if(id!=='main')throw new Error('fixture-agent-collision');Object.assign(existing,value);}else cfg.agents.list.push({id,...value});}
}
if(mode==='normal'){
 for(const dir of [join(state,'os'),'/home/tester/kernel-resource','/home/tester/kernel-outside'])mkdirSync(dir,{recursive:true,mode:0o700});
 writeFileSync('/home/tester/kernel-resource/example.txt','inside-fixture-content\n',{mode:0o600});
 writeFileSync('/home/tester/kernel-outside/outside.txt','outside-fixture-content\n',{mode:0o600});
 cfg.models??={};cfg.models.providers??={};
 cfg.models.providers.spike={baseUrl:'http://127.0.0.1:19101/v1',api:'openai-completions',apiKey:randomBytes(32).toString('hex'),models:[{id:'spike',name:'VM deterministic model',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1024}]};
 cfg.agents.defaults.model={primary:'spike/spike'};
 // A fixture-created multi-agent entries roster needs explicit ownership; the
 // installer's original single-agent config legitimately omitted this field.
 if(cfg.agents.entries)cfg.agents.ownership='explicit';
 agent('main',true);agent('stranger');
 addPlugin('gkos-kernel-monitor','kernel-monitor');
 cfg.plugins.entries['gkos-gatekeeper-fs'].config={...cfg.plugins.entries['gkos-gatekeeper-fs'].config,roots:['/home/tester/kernel-resource']};
}else if(mode==='no-hooks'){
 entry.hooks.allowConversationAccess=false;
}else if(mode==='restore'){
 entry.hooks.allowConversationAccess=true;
}else if(mode==='owner'){
 entry.hooks.allowConversationAccess=true;
 addPlugin('gkos-channel-ingress','channel-ingress');
 entry.config.operators=[...entry.config.operators,{channel:'vmchan',senderId:'operator'}];
 entry.config.egress={...entry.config.egress,denyPatterns:[...new Set([...(entry.config.egress?.denyPatterns??[]),'phase-three-denied-marker'])]};
 cfg.commands={...cfg.commands,ownerAllowFrom:[...(cfg.commands?.ownerAllowFrom??[]),'vmchan:operator']};
 for(const id of ['main','stranger','forged','console','group-new','command','command-group','command-forged','egress'])agent('audience-'+id);
}else if(mode==='approvals'){
 entry.hooks.allowConversationAccess=true;
 addPlugin('gkos-gatekeeper-fixture','approval-driver');
 agent('approval-fixture');
 const {tools,resources}=await import('./approval-driver/metadata.mjs');
 const catalogFile=join(state,'os/gatekeepers.json'),catalog=JSON.parse(readFileSync(catalogFile,'utf8'));
 if(catalog.gatekeepers.some(e=>e.vendor==='fixture'))throw new Error('approval fixture collision');
 catalog.gatekeepers.push({pluginId:'gkos-gatekeeper-fixture',vendor:'fixture',apiVersion:1,root:resolve('approval-driver'),tools,resources});
 writeFileSync(catalogFile,JSON.stringify(catalog,null,2)+'\n',{mode:0o600});
 // Use the actual installed CLI's catalog derivation, not a fixture-authored allowance.
 // This previews product reconciliation; it is not a claim that config apply ran here.
 const {mergeFragments}=await import('/home/tester/npm-acceptance-prefix/lib/node_modules/@gatekeeper-os/cli/dist/index.js');
 const derived=mergeFragments(join(state,'os/config.d')).tools;
 cfg.tools=checkedCatalogTools(cfg.tools,derived,'gkos-gatekeeper-fixture');
 const expected=JSON.parse(protectedBefore);expected.tools=cfg.tools;protectedBefore=JSON.stringify(expected);
 writeFileSync(resolve('approval-effects.jsonl'),'',{mode:0o600});
}else throw new Error('unknown fixture mode');
if(protect()!==protectedBefore)throw new Error('protected messaging policy changed');
writeFileSync(file,JSON.stringify(cfg,null,2)+'\n',{mode:0o600});
const receipt={mode,cell,rawGatewayPortPresent:cfg.gateway.port!==undefined,baselineToolsUnchanged:mode!=='approvals',catalogPolicyDerived:mode==='approvals',nativePolicyUnchanged:true,installPolicyUnchanged:true,authUnchanged:true,defaultsSandboxUnchanged:true,toolsHash:createHash('sha256').update(JSON.stringify(cfg.tools)).digest('hex'),productPluginPaths:cfg.plugins.load.paths.filter(p=>!p.startsWith('/home/tester/npm-acceptance/')),catalogSha256:createHash('sha256').update(readFileSync(join(state,'os/gatekeepers.json'))).digest('hex')};
writeFileSync(join(dirname(process.env.GKOS_SCENARIO_REPORT),'config-'+mode+'-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
console.log('PASS fixture-config-'+mode+'-protected-baseline');
