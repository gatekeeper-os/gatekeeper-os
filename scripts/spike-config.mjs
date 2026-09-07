// Creates an isolated VM-only config; generated authentication material never reaches stdout.
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
if(process.env.CLAWOS_SPIKE_VM !== '1') throw new Error('Test VM required');
const state = process.env.OPENCLAW_STATE_DIR;
if (!state || resolve(state) !== state || process.env.OPENCLAW_CONFIG_PATH !== join(state,'openclaw.json')) throw new Error('Explicit isolated paths required');
mkdirSync(join(state,'os'),{recursive:true,mode:0o700});
const config = {
  gateway:{mode:'local',bind:'loopback',port:19100,auth:{mode:'token',token:randomBytes(32).toString('hex')}},
  update:{auto:{enabled:false}},
  models:{providers:{spike:{baseUrl:'http://127.0.0.1:19101/v1',api:'openai-completions',apiKey:randomBytes(32).toString('hex'),models:[{id:'spike',name:'Deterministic test model',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:1024}]}}},
  agents:{defaults:{workspace:join(state,'workspace'),model:{primary:'spike/spike'}},list:[{id:'main',default:true},{id:'naming'}]},
  tools:{profile:'full'},
  plugins:{allow:['spike-probe','spike-vendor-fixture'],load:{paths:[resolve('scripts/spike-probe'),resolve('scripts/spike-probe/fixture-vendor')]},entries:{'spike-probe':{enabled:true,hooks:{allowConversationAccess:true}},'spike-vendor-fixture':{enabled:true}}}
};
writeFileSync(process.env.OPENCLAW_CONFIG_PATH,JSON.stringify(config,null,2)+'\n',{mode:0o600});

writeFileSync(join(state,'os','probe-catalog.json'),JSON.stringify({id:'spike-vendor-fixture',vendor:'spike',apiVersion:1,root:resolve('scripts/spike-probe/fixture-vendor')})+'\n',{mode:0o600});
