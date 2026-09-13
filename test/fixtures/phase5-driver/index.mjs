// VM-only synthetic provider; the fs identity reuses an existing kernel contract, not filesystem acceptance.
import { appendFileSync } from 'node:fs';
import { defineGatekeeper } from '../../../packages/gatekeeper-kit/dist/index.js';
const file='/home/tester/phase5-effects.jsonl';
const record=(kind,id)=>appendFileSync(file,JSON.stringify({kind,id,ts:Date.now()})+'\n',{mode:0o600});
export const resources=[{type:'dir',urlPattern:'file:///:path+',title:'Synthetic resource',description:'VM fixture only',grantable:true,observerStrategy:'low-stakes',tools:['gk_fs_file_write']}];
export const tools=[{name:'gk_fs_file_write',resourceType:'dir',kind:'action',description:'Record a fixture operation.',parameters:{type:'object',additionalProperties:false,properties:{grant:{type:'string'},eligible:{type:'boolean'},tag:{type:'string'},count:{type:'integer',minimum:1,maximum:2},delay:{type:'boolean'}},required:['grant','eligible','tag','count','delay']}}];
const description=p=>({title:'Synthetic action',description:'VM-only recorded effect',implementsRevert:true,autoApprovable:p.eligible,actionKind:{tag:p.tag,label:'Fixture'},preview:{fixture:true,operation:'record'}});
let serial=0;const instances=new Map();
export default defineGatekeeper({id:'gkos-gatekeeper-fs',vendor:'fs',apiVersion:1,name:'Phase5 synthetic driver',description:'VM-only acceptance fixture',tools,resources,actions:{gk_fs_file_write:{describe:description}},createVendor(){
 if(process.env.GKOS_KERNEL_VM!=='1'||process.env.OPENCLAW_STATE_DIR!=='/home/tester/.openclaw-kernel-test')throw new Error('VM required');
 const account={getGatekeeperFor:async key=>{
  if(key!=='file:///phase5-fixture/')throw new Error('Unknown fixture');
  if(!instances.has(key))instances.set(key,{applyAction:async id=>record('apply',id),rejectAction:async id=>{record('reject',id);},revertAction:async id=>record('revert',id),startSession:async()=>({call:async(_tool,p,ctx)=>{
   const d=description(p);if(ctx.dryRun)return{kind:'action',description:d};
   const submit=async()=>{for(let i=0;i<p.count;i++){const id=++serial;await ctx.queue.submitAction(id,d);record('submit',id);}};
   if(p.delay)setTimeout(()=>void submit().catch(()=>record('error',0)),2500);else await submit();
   return{content:[{type:'text',text:'Fixture recorded.'}]};
  },close:async()=>{}})});
  return{resource:resources[0],resourceKey:key,gatekeeper:instances.get(key)};
 }};
 return{vendor:'fs',apiVersion:1,getAccount:async()=>account,createAccount:async()=>account};
}});
