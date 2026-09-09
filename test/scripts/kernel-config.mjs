// VM-only configuration for real installed kernel + filesystem plugins; production state is never selected.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
if (process.env.CLAWOS_KERNEL_VM !== '1' || process.env.OPENCLAW_STATE_DIR !== '/home/tester/.openclaw-kernel-test' || process.env.OPENCLAW_CONFIG_PATH !== '/home/tester/.openclaw-kernel-test/openclaw.json' || process.cwd() !== '/home/tester/src') throw new Error('VM required');
const state=process.env.OPENCLAW_STATE_DIR, file=process.env.OPENCLAW_CONFIG_PATH;
if (process.argv[2] === 'no-hooks') {
  const cfg=JSON.parse(readFileSync(file,'utf8'));
  cfg.plugins.entries['clawos-kernel'].hooks.allowConversationAccess=false;
  writeFileSync(file,JSON.stringify(cfg),{mode:0o600});
} else {
  for (const path of [join(state,'os'),'/home/tester/kernel-resource','/home/tester/kernel-outside']) mkdirSync(path,{recursive:true,mode:0o700});
  writeFileSync('/home/tester/kernel-resource/example.txt','inside-fixture-content\n',{mode:0o600});
  writeFileSync('/home/tester/kernel-outside/outside.txt','outside-fixture-content\n',{mode:0o600});
  const {fsTools}=await import('../../packages/gatekeeper-fs/src/tools.ts');
  const {fsResources}=await import('../../packages/gatekeeper-fs/src/resources.ts');
  writeFileSync(join(state,'os/gatekeepers.json'),JSON.stringify({version:1,gatekeepers:[{pluginId:'gatekeeper-fs',vendor:'fs',apiVersion:1,root:resolve('packages/gatekeeper-fs'),tools:fsTools,resources:fsResources}]}),{mode:0o600});
  const config={gateway:{mode:'local',bind:'loopback',port:19100,auth:{mode:'token',token:randomBytes(32).toString('hex')}},update:{auto:{enabled:false}},
    models:{providers:{spike:{baseUrl:'http://127.0.0.1:19101/v1',api:'openai-completions',apiKey:randomBytes(32).toString('hex'),models:[{id:'spike',name:'VM deterministic model',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1024}]}}},
    agents:{defaults:{workspace:join(state,'workspace'),model:{primary:'spike/spike'}},list:[{id:'main',default:true},{id:'stranger'}]},tools:{profile:'full'},
    plugins:{allow:['clawos-kernel','gatekeeper-fs','clawos-kernel-monitor'],load:{paths:['packages/clawos-kernel','packages/gatekeeper-fs','test/fixtures/kernel-monitor'].map(p=>resolve(p))},entries:{
      'clawos-kernel':{enabled:true,hooks:{allowConversationAccess:true},config:{operators:[],install:{allowSources:[]}}},
      'gatekeeper-fs':{enabled:true,config:{roots:['/home/tester/kernel-resource']}},
      'clawos-kernel-monitor':{enabled:true,hooks:{allowConversationAccess:true}},
    }}};
  writeFileSync(file,JSON.stringify(config),{mode:0o600});
  mkdirSync('/home/tester/.clawos',{recursive:true,mode:0o700});
  const registryPath='/home/tester/.clawos/cells.json';
  const registry=JSON.parse(readFileSync(registryPath,'utf8')).filter(row=>row.name!=='kernel-test');
  registry.push({name:'kernel-test',port:19100,stateDir:state,unit:'openclaw-gateway-kernel-test.service',createdAt:new Date().toISOString()});
  writeFileSync(registryPath,JSON.stringify(registry),{mode:0o600});
}
