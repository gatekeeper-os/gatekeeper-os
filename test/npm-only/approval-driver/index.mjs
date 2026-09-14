// Test-only provider, using the actual registry-published kit. Never substitutes for filesystem acceptance.
import {appendFileSync} from 'node:fs';
import {defineGatekeeper} from '/home/tester/npm-acceptance-prefix/lib/node_modules/@gatekeeper-os/gatekeeper-kit/dist/index.js';
import {resources,tools} from './metadata.mjs';
const effects='/home/tester/npm-acceptance/approval-effects.jsonl';
const description=()=>({title:'Synthetic approval record',description:'Test-only recorded decision',implementsRevert:false,autoApprovable:false,preview:{fixture:true}});
export default defineGatekeeper({id:'gkos-gatekeeper-fixture',vendor:'fixture',apiVersion:1,name:'Npm acceptance approval fixture',description:'Test-only approval decision fixture',tools,resources,actions:{gk_fixture_record_write:{describe:description}},createVendor(){
 if(process.env.GKOS_KERNEL_VM!=='1'||process.env.OPENCLAW_STATE_DIR!=='/home/tester/.openclaw-kernel-test')throw new Error('VM required');
 let serial=0;
 const record=(kind,id)=>appendFileSync(effects,JSON.stringify({kind,id})+'\n',{mode:0o600});
 const gatekeeper={applyAction:async id=>record('apply',id),rejectAction:async id=>record('reject',id),startSession:async()=>({call:async(_tool,_params,ctx)=>{
  if(ctx.dryRun)return{kind:'action',description:description()};
  const id=++serial;await ctx.queue.submitAction(id,description());record('submit',id);
  return{content:[{type:'text',text:'Fixture recorded.'}]};
 },close:async()=>{}})};
 const account={getGatekeeperFor:async key=>{if(key!=='https://npm-acceptance.invalid/record')throw new Error('Unknown fixture');return{resource:resources[0],resourceKey:key,gatekeeper};}};
 return{vendor:'fixture',apiVersion:1,getAccount:async()=>account,createAccount:async()=>account};
}});
