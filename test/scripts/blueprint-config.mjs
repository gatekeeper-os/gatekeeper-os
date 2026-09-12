// Disposable VM fixture. Does not reuse or modify the installed default cell's global policy.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
if(process.env.OPENCLAW_STATE_DIR!=='/home/tester/.openclaw-blueprint-test'||process.cwd()!=='/home/tester/src')throw new Error('VM required');
const state=process.env.OPENCLAW_STATE_DIR,configPath=process.env.OPENCLAW_CONFIG_PATH;
mkdirSync(join(state,'os/config.d'),{recursive:true,mode:0o700});
const {fsTools}=await import('../../packages/gatekeeper-fs/src/tools.ts'),{fsResources}=await import('../../packages/gatekeeper-fs/src/resources.ts');
writeFileSync(join(state,'os/gatekeepers.json'),JSON.stringify({version:1,gatekeepers:[{pluginId:'gatekeeper-fs',vendor:'fs',apiVersion:1,root:resolve('packages/gatekeeper-fs'),tools:fsTools,resources:fsResources}]}),{mode:0o600});
const config={gateway:{mode:'local',bind:'loopback',port:19100,auth:{mode:'token',token:randomBytes(32).toString('hex')},reload:{mode:'hybrid'}},update:{auto:{enabled:false}},
 models:{providers:{spike:{baseUrl:'http://127.0.0.1:19101/v1',api:'openai-completions',apiKey:randomBytes(32).toString('hex'),models:[{id:'spike',name:'Local synthetic model',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1024}]}}},
 agents:{defaults:{workspace:join(state,'workspace'),model:{primary:'spike/spike'},skipBootstrap:true},entries:{main:{default:true}}},
 tools:{profile:'messaging',elevated:{enabled:false}},
 plugins:{allow:['clawos-kernel','gatekeeper-fs'],load:{paths:['packages/clawos-kernel','packages/gatekeeper-fs'].map(p=>resolve(p))},entries:{'clawos-kernel':{enabled:true,hooks:{allowConversationAccess:true},config:{operators:[],install:{allowSources:[]}}},'gatekeeper-fs':{enabled:true,config:{roots:[]}}}}};
writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
writeFileSync(join(state,'os/config.d/30-agents.json5'),'{"agents":{"entries":{}}}\n',{mode:0o600});
const registry='/home/tester/.clawos/cells.json',rows=JSON.parse(readFileSync(registry,'utf8')).filter(r=>r.name!=='blueprint-test');rows.push({name:'blueprint-test',port:19100,stateDir:state,unit:'openclaw-gateway-blueprint-test.service',createdAt:new Date().toISOString()});writeFileSync(registry,JSON.stringify(rows),{mode:0o600});
