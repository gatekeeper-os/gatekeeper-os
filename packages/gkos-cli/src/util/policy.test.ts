import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseCellPolicy, policyFragments, runtimeCell } from './policy.js';
import { mergeFragments } from '../commands/config-apply.js';
const configRoot=resolve(import.meta.dirname,'../../../../config/config.d');
function stage(policy:'messaging'|'runtime') {
  const root=mkdtempSync(join(tmpdir(),'gkos-policy-'));
  for(const name of policyFragments(['00-baseline.json5','05-policy-runtime.json5','20-sandbox.json5'],policy))writeFileSync(join(root,name),readFileSync(join(configRoot,name)));
  return root;
}
describe('cell policy profiles',()=>{
  it('rejects unknown policy before any installation',()=>expect(()=>parseCellPolicy('runtmie')).toThrow(/messaging or runtime/));
  it('messaging retains exact baseline denial and sandbox defaults, runtime is opt-in',()=>{
    const cfg=mergeFragments(stage('messaging'));
    expect(runtimeCell(cfg)).toBe(false);
    expect(cfg).toMatchObject({tools:{profile:'messaging',deny:['group:runtime','group:fs','group:automation','browser'],exec:{mode:'deny'}},agents:{defaults:{sandbox:{mode:'non-main'}}}});
  });
  it('runtime replaces deny list and retains all-turn Docker sandbox after fragment ordering',()=>{
    const cfg=mergeFragments(stage('runtime'));expect(runtimeCell(cfg)).toBe(true);
    expect(cfg).toMatchObject({tools:{exec:{host:'sandbox',mode:'allowlist'},elevated:{enabled:false}},agents:{defaults:{sandbox:{mode:'all',docker:{network:'none',readOnlyRoot:true}}}}});
  });
  it.each(['off','non-main'])('rejects runtime widening with %s sandbox in its own fragment, even repaired later',mode=>{
    const dir=stage('runtime');writeFileSync(join(dir,'05-policy-runtime.json5'),JSON.stringify({tools:{allow:['exec']},agents:{defaults:{sandbox:{mode}}}}));
    writeFileSync(join(dir,'90-local.json5'),JSON.stringify({agents:{defaults:{sandbox:{mode:'all'}}}}));
    expect(()=>mergeFragments(dir)).toThrow(/05-policy-runtime requires/);
  });
  it('rejects later local sandbox weakening',()=>{const dir=stage('runtime');writeFileSync(join(dir,'90-local.json5'),'{agents:{defaults:{sandbox:{mode:"off"}}}}');expect(()=>mergeFragments(dir)).toThrow(/05-policy-runtime requires/);});
  it('refuses a per-agent sandbox escape while fs or exec stays permitted',()=>{const dir=stage('runtime');writeFileSync(join(dir,'30-agents.json5'),'{agents:{entries:{escape:{sandbox:{mode:"off"},tools:{exec:{mode:"deny"}}}}}}');expect(()=>mergeFragments(dir)).toThrow(/deny exec and filesystem/);});
  it('does not treat agent sandbox or allow as permission to exceed the global ceiling',()=>{
    expect(runtimeCell({tools:{allow:['group:fs','exec'],deny:['group:runtime'],exec:{host:'sandbox',mode:'full'}},agents:{defaults:{sandbox:{mode:'all'}}}})).toBe(false);
  });
});
