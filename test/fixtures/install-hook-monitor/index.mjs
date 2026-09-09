// Observe the real hook runner before/after the kernel. Never return a policy decision.
import { appendFileSync } from 'node:fs';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
export default definePluginEntry({id:'clawos-install-hook-monitor',register(api){
  if(process.env.CLAWOS_KERNEL_VM!=='1'||process.env.OPENCLAW_STATE_DIR!=='/home/tester/.openclaw-kernel-test')throw new Error('VM required');
  if(api.registrationMode!=='full')return;
  for(const [stage,priority] of [['before',1000],['after',-1000]])api.on('before_install',(e)=>{
    appendFileSync('/home/tester/.openclaw-kernel-test/os/install-events.jsonl',JSON.stringify({stage,targetSkill:e.targetType==='skill',directory:e.sourcePathKind==='directory',upload:e.request?.kind==='skill-install'&&e.request?.requestedSpecifier?.startsWith('upload:')===true})+'\n',{mode:0o600});
  },{priority});
}});
