import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {checkedCatalogTools} from '../../../test/npm-only/catalog-policy.mjs';
import {tools} from '../../../test/npm-only/approval-driver/metadata.mjs';
const id='gkos-gatekeeper-fixture';
const baseline={profile:'messaging',alsoAllow:['gkos-kernel','gkos-gatekeeper-fs'],deny:['group:runtime','group:fs','group:automation','browser'],exec:{mode:'deny'}};
const derived={...baseline,alsoAllow:[...baseline.alsoAllow,id]};
it('accepts exactly the installed CLI catalog plugin admission without changing baseline',()=>{
 expect(checkedCatalogTools(baseline,derived,id)).toBe(derived);
 expect(baseline.alsoAllow).not.toContain(id);
});
it.each([
 {...derived,deny:[]}, {...derived,exec:{mode:'full'}},
 {...derived,alsoAllow:[...derived.alsoAllow,'unrelated']},
 {...derived,alsoAllow:[id]}, {...derived,profile:'full'},
 baseline,
])('refuses unrelated policy changes or absent catalog admission: %j',candidate=>{
 expect(()=>checkedCatalogTools(baseline,candidate,id)).toThrow();
});
it('approval fixture manifest owns exactly the defineGatekeeper tool metadata',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../../test/npm-only/approval-driver/openclaw.plugin.json',import.meta.url),'utf8'));
 expect(manifest.id).toBe(id);
 expect(manifest.contracts.tools).toEqual(tools.map(tool=>tool.name));
});
