import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { applyBlueprint, blueprintDrift, assertPlainPath, blueprintEntry, loadBlueprint, validateBlueprint } from './blueprint.js';
import { resolveCell, type Cell } from '../util/cell.js';
import { openclaw, readOwnedConfig, configRevision } from '../util/openclaw.js';
vi.mock('../util/openclaw.js', async importOriginal => ({...await importOriginal<typeof import('../util/openclaw.js')>(),openclaw:vi.fn(),readOwnedConfig:vi.fn(),configRevision:vi.fn()}));
const templates=resolve(import.meta.dirname,'../../../gkos-blueprints'),catalog=['fs','github','http','mcp'];
const load=(name='coder')=>loadBlueprint(join(templates,name),catalog);
let cell:Cell,config:any;
beforeEach(()=>{vi.clearAllMocks();const root=mkdtempSync(join(tmpdir(),'blueprint-'));cell={...resolveCell('blueprint-test'),stateDir:root,osDir:join(root,'os'),configPath:join(root,'openclaw.json')};mkdirSync(join(cell.osDir,'config.d'),{recursive:true});writeFileSync(join(cell.osDir,'config.d/30-agents.json5'),'{"agents":{"entries":{}}}');config={agents:{entries:{},defaults:{sandbox:{mode:'all'}}},tools:{profile:'full',allow:['group:fs','exec','gkos-kernel','session_status'],deny:['group:automation','browser','process','code_execution'],exec:{host:'sandbox',mode:'allowlist'}}};vi.mocked(readOwnedConfig).mockImplementation(()=>config);vi.mocked(configRevision).mockReturnValue('a'.repeat(64));vi.mocked(openclaw).mockImplementation((_cell,args)=>{const id=args[2]!;const path=args[4]!;mkdirSync(path,{recursive:true});config.agents.entries[id]={workspace:path};return{code:0,stdout:'{}',stderr:''};});});
afterEach(()=>vi.restoreAllMocks());
const applyConfig=async()=>{const fragment=JSON.parse(readFileSync(join(cell.osDir,'config.d/30-agents.json5'),'utf8'));Object.assign(config.agents.entries,fragment.agents.entries);return{changed:true,changes:[],fingerprint:'x',restarted:false};};
describe('blueprint safety and provisioning',()=>{
  it('refuses coder in messaging cell before files or upstream writes, even if fragments claim runtime',async()=>{
    config.tools={profile:'messaging',deny:['group:runtime','group:fs'],exec:{mode:'deny'}};
    writeFileSync(join(cell.osDir,'config.d/05-policy-runtime.json5'),JSON.stringify({agents:{defaults:{sandbox:{mode:'all'}}},tools:{allow:['group:fs','exec']}}));
    await expect(applyBlueprint(cell,join(templates,'coder'),'dev',catalog,applyConfig)).rejects.toThrow('gkos cell create blueprint-test-runtime --port 18790 --policy runtime');
    expect(openclaw).not.toHaveBeenCalled();expect(existsSync(join(cell.osDir,'blueprints/dev'))).toBe(false);
  });
  it('requires all sandbox on runtime blueprint even without an exec tool entry',()=>{const b=load().blueprint;b.toolPolicy.allow=[];b.sandbox.mode='non-main';expect(()=>validateBlueprint(b,catalog)).toThrow(/sandbox.mode all/);});
  it('researcher exposes only native web tools, not messaging, fs, shell or kernel tools',()=>{
    expect(blueprintEntry(load('researcher').blueprint,'/workspace').tools).toMatchObject({profile:'minimal',alsoAllow:['web_search','web_fetch'],deny:expect.arrayContaining(['session_status']),exec:{mode:'deny'}});
  });

  it.each(['assistant','coder','ops','researcher'])('loads complete %s template without changing dependencies',name=>{const result=load(name);expect(result.files['README.md']).toBeTruthy();expect(result.files['AGENTS.md']).toContain('os_request_access');expect(result.blueprint.expectedGatekeepers).not.toContain('http');expect(result.blueprint.policy).toBe(name==='coder'?'runtime':'messaging');});
  it.each(['exec','process','group:runtime'])('requires all-turn sandbox for %s',tool=>{const b=load('assistant').blueprint;b.toolPolicy.allow=[tool];expect(()=>validateBlueprint(b,catalog)).toThrow(/sandbox.mode all/);});
  it('rejects native fs with sandbox off',()=>{const b=load('assistant').blueprint;b.toolPolicy.allow=['read'];expect(()=>validateBlueprint(b,catalog)).toThrow(/filesystem requires sandbox/);});
  it('rejects unknown gatekeeper instead of removing the dependency',()=>expect(()=>loadBlueprint(join(templates,'coder'),['fs'])).toThrow(/unknown gatekeeper/));
  it('rejects inherited Docker mounts before creating an agent',async()=>{config.agents.defaults={sandbox:{mode:'all',docker:{binds:['/host:/host:rw']}}};await expect(applyBlueprint(cell,join(templates,'coder'),'dev',catalog,applyConfig)).rejects.toThrow(/inherited Docker/);expect(openclaw).not.toHaveBeenCalled();});
  it('rejects wildcards, unknown keys, and path escape',()=>{const b=load().blueprint;expect(()=>validateBlueprint({...b,unknown:true},catalog)).toThrow();expect(()=>validateBlueprint({...b,toolPolicy:{...b.toolPolicy,allow:['group:openclaw']}},catalog)).toThrow(/unsupported tool group/);expect(()=>validateBlueprint({...b,workspaceFiles:['AGENTS.md','SOUL.md','../secret']},catalog)).toThrow();expect(()=>validateBlueprint({...b,toolPolicy:{...b.toolPolicy,allow:['*']}},catalog)).toThrow();});
  it('pins sandbox host, network:none, drop all and disables elevated execution',()=>{const entry=blueprintEntry(load().blueprint,'/workspace');expect(entry).toMatchObject({sandbox:{mode:'all',backend:'docker',scope:'agent',docker:{network:'none',readOnlyRoot:true,capDrop:['ALL']}},tools:{exec:{host:'sandbox'},elevated:{enabled:false}}});});
  it('rejects source symlinks before reading content',()=>{const dir=join(cell.stateDir,'link');symlinkSync(join(templates,'coder'),dir);expect(()=>loadBlueprint(dir,catalog)).toThrow(/symlink/);});
  it('rejects destination ancestor symlinks',()=>{symlinkSync(tmpdir(),join(cell.stateDir,'agents'));expect(()=>assertPlainPath(join(cell.stateDir,'agents/a/workspace'))).toThrow(/symlink/);});
  it('applies once, preserves other agents, reports missing dependencies and policy ceilings',async()=>{config.agents.entries.other={workspace:'/unrelated'};const first=await applyBlueprint(cell,join(templates,'coder'),'dev',catalog,applyConfig);expect(first).toMatchObject({changed:true,dependencyPending:['fs','github'],policyConflicts:[],fullAcceptance:false});expect(config.agents.entries.other).toEqual({workspace:'/unrelated'});const second=await applyBlueprint(cell,join(templates,'coder'),'dev',catalog,applyConfig);expect(second.changed).toBe(false);expect(openclaw).toHaveBeenCalledTimes(1);});
  it('refuses workspace drift and never prints its content',async()=>{await applyBlueprint(cell,join(templates,'coder'),'dev',catalog,applyConfig);const path=join(cell.stateDir,'agents/dev/workspace/SOUL.md');writeFileSync(path,'PRIVATE-CONTENT');await expect(applyBlueprint(cell,join(templates,'coder'),'dev',catalog,applyConfig)).rejects.toThrow('drift detected');expect(readFileSync(path,'utf8')).toBe('PRIVATE-CONTENT');});
  it('refuses live config drift',async()=>{await applyBlueprint(cell,join(templates,'coder'),'dev',catalog,applyConfig);config.agents.entries.dev.sandbox.mode='off';await expect(applyBlueprint(cell,join(templates,'coder'),'dev',catalog,applyConfig)).rejects.toThrow(/drift/);});
  it('refuses collisions without adoption',async()=>{config.agents.entries.dev={workspace:'/mine'};await expect(applyBlueprint(cell,join(templates,'coder'),'dev',catalog,applyConfig)).rejects.toThrow(/adoption refused/);expect(openclaw).not.toHaveBeenCalled();});
  it('retains interrupted operation evidence and refuses blind retries',async()=>{await expect(applyBlueprint(cell,join(templates,'coder'),'dev',catalog,async()=>{throw new Error('simulated crash');})).rejects.toThrow('simulated crash');expect(existsSync(join(cell.osDir,'blueprints/dev/pending.json'))).toBe(true);expect(existsSync(join(cell.osDir,'blueprints/dev/snapshot.json'))).toBe(false);await expect(applyBlueprint(cell,join(templates,'coder'),'dev',catalog,applyConfig)).rejects.toThrow(/incomplete provisioning/);});
  it('refuses concurrent config revision changes before any mutation',async()=>{vi.mocked(configRevision).mockReturnValueOnce('a'.repeat(64)).mockReturnValue('b'.repeat(64));await expect(applyBlueprint(cell,join(templates,'coder'),'dev',catalog,applyConfig)).rejects.toThrow(/config changed/);expect(openclaw).not.toHaveBeenCalled();});
  it('refuses main and traversal agent ids',async()=>{for(const id of ['main','../other','constructor']){await expect(applyBlueprint(cell,join(templates,'coder'),id,catalog,applyConfig)).rejects.toThrow(/agent id/);}});
});

it('treats only catalog messaging ids as derived; native policy drift still blocks',()=>{
 const entry=blueprintEntry(load('assistant').blueprint,'/fixture');
 const snapshot={version:1 as const,blueprint:'assistant',fingerprint:'test',workspace:'/fixture',files:{},entry};
 const live=structuredClone(entry) as any;live.tools.alsoAllow.push('gkos-gatekeeper-fixture');
 expect(blueprintDrift(snapshot,live)).toEqual([]);
 live.tools.deny=[];expect(blueprintDrift(snapshot,live)).toContain('config/tools');
 const explicit=structuredClone(entry) as any;explicit.tools.allow=['os_list_grants'];
 const changed=structuredClone(explicit);changed.tools.alsoAllow.push('gkos-gatekeeper-fixture');
 expect(blueprintDrift({...snapshot,entry:explicit},changed)).toContain('config/tools');
});
