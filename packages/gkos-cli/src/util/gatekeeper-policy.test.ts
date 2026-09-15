import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { mergeFragments } from '../commands/config-apply.js';
import { getPath } from './merge.js';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'gkos-policy-'));roots.push(root);const dir=join(root,'config.d');mkdirSync(dir);
 writeFileSync(join(dir,'00-baseline.json5'),readFileSync(resolve(import.meta.dirname,'../../../../config/config.d/00-baseline.json5')));
 const plugin=join(root,'fixture');mkdirSync(plugin);const id='gkos-gatekeeper-fixture';
 writeFileSync(join(plugin,'openclaw.plugin.json'),JSON.stringify({id,contracts:{tools:['gk_fixture_record_write']}}));
 const entry={pluginId:id,vendor:'fixture',apiVersion:1,root:plugin,tools:[{name:'gk_fixture_record_write'}]};
 const catalog=(entries:unknown[])=>writeFileSync(join(root,'gatekeepers.json'),JSON.stringify({version:1,gatekeepers:entries}));
 return{root,dir,entry,catalog,id,read:()=>mergeFragments(dir)};
}
it('reconciles add/remove/disable from merged policy without native or sandbox changes',()=>{
 const f=fixture();writeFileSync(join(f.dir,'90-local.json'),JSON.stringify({tools:{alsoAllow:['gkos-kernel','web_search']},agents:{defaults:{sandbox:{mode:'off'}},entries:{assistant:{tools:{profile:'messaging',alsoAllow:['gkos-kernel'],deny:['browser']}}}}}));
 f.catalog([]);const before=f.read();f.catalog([f.entry]);const added=f.read();
 expect(getPath(added,'tools.alsoAllow')).toEqual(['gkos-kernel','web_search',f.id]);
 expect(getPath(added,'agents.entries.assistant.tools.alsoAllow')).toEqual(['gkos-kernel',f.id]);
 for(const key of ['tools.deny','tools.exec','tools.elevated','agents.defaults.sandbox'])expect(getPath(added,key)).toEqual(getPath(before,key));
 f.catalog([]);expect(f.read()).toEqual(before);f.catalog([{...f.entry,enabled:false}]);expect(f.read()).toEqual(before);
});
it('leaves runtime explicit allow and sandbox byte-equivalent, including agent policies',()=>{
 const f=fixture();writeFileSync(join(f.dir,'05-policy-runtime.json5'),readFileSync(resolve(import.meta.dirname,'../../../../config/config.d/05-policy-runtime.json5')));
 f.catalog([]);const before=f.read();f.catalog([f.entry]);expect(f.read()).toEqual(before);
});
it('preserves explicit messaging ceilings and plugin denials',()=>{
 const f=fixture();f.catalog([f.entry]);writeFileSync(join(f.dir,'90-local.json'),JSON.stringify({plugins:{deny:[f.id]}}));
 expect(getPath(f.read(),'tools.alsoAllow')).toEqual(['gkos-kernel']);
 writeFileSync(join(f.dir,'90-local.json'),JSON.stringify({tools:{allow:['os_list_grants']}}));
 expect(getPath(f.read(),'tools.alsoAllow')).toEqual(['gkos-kernel']);
});
it('rejects mismatched manifests and duplicate catalog identity before admitting tools',()=>{
 const f=fixture();f.catalog([f.entry,f.entry]);expect(f.read).toThrow(/identity/);
 f.catalog([f.entry]);writeFileSync(join(f.entry.root,'openclaw.plugin.json'),JSON.stringify({id:f.id,contracts:{tools:[]}}));
 expect(f.read).toThrow(/contracts.tools/);
});
