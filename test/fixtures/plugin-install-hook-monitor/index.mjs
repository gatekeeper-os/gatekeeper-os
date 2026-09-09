// Observe the real hook runner before/after the kernel. Never return a policy decision.
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
export default definePluginEntry({id:'clawos-install-hook-monitor',register(api){
  if(process.env.CLAWOS_KERNEL_VM!=='1'||process.env.OPENCLAW_STATE_DIR!=='/home/tester/.openclaw-kernel-test')throw new Error('VM required');
  if(api.registrationMode!=='full')return;
  const fixture=JSON.parse(readFileSync(new URL('./candidate.json',import.meta.url),'utf8'));
  for(const [stage,priority] of [['before',1000],['after',-1000]])api.on('before_install',(e)=>{
    let exactMaterial=false;
    if(e.targetType==='plugin'&&e.sourcePathKind==='directory'){
      try{
        const pkg=JSON.parse(readFileSync(resolve(e.sourcePath,'package.json'),'utf8'));
        const manifest=JSON.parse(readFileSync(resolve(e.sourcePath,'openclaw.plugin.json'),'utf8'));
        exactMaterial=pkg.name===fixture.packageName&&pkg.version===fixture.version&&manifest.id===fixture.pluginId&&pkg.openclaw.extensions.length>0&&pkg.openclaw.extensions.every(p=>existsSync(resolve(e.sourcePath,p)));
      }catch{}
    }
    appendFileSync('/home/tester/.openclaw-kernel-test/os/install-events.jsonl',JSON.stringify({stage,exactMaterial,targetPlugin:e.targetType==='plugin',directory:e.sourcePathKind==='directory',pluginRequest:typeof e.request?.kind==='string'&&e.request.kind.startsWith('plugin-')})+'\n',{mode:0o600});
  },{priority});
}});
