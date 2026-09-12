/** Versioned, operator-owned workspace provisioning. Never emits file contents or grants capabilities. */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optionValue, type GlobalOptions } from '../options.js';
import { resolveCellFromRegistry, type Cell } from '../util/cell.js';
import { writeJson, writeFileIfChanged } from '../util/fsx.js';
import { digest } from '../util/lockfile.js';
import { canonicalize, getPath } from '../util/merge.js';
import { parseFragment, type Json } from '../util/json5.js';
import { configRevision, openclaw, readOwnedConfig } from '../util/openclaw.js';
import { StepError } from '../util/proc.js';
import { reconcile, mergeFragments } from './config-apply.js';

const ID = /^(?!constructor$|prototype$)[a-z][a-z0-9-]{0,31}$/;
const object = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string') && new Set(v).size === v.length;
const keys = (v: Record<string, Json>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
function fail(code: string): never { throw new StepError(`blueprint: ${code}`); }
/** Validated blueprint; policy supports explicit names/groups, never wildcard authority. */
export interface Blueprint {
  name: string; version: string; description?: string; workspaceFiles: string[]; skills: string[];
  toolPolicy: {profile: 'minimal'|'messaging'|'coding'; allow: string[]; deny: string[]};
  sandbox: {mode: 'off'|'non-main'|'all'; workspaceAccess?: 'none'|'ro'|'rw'};
  expectedGatekeepers: string[]; model?: string; bindingsHint?: string;
}
/** Reject malformed schema, unsafe profiles and unsupported references before any side effect. */
export function validateBlueprint(value: unknown, catalog: string[]): Blueprint {
  if (!object(value) || !keys(value,['name','version','description','workspaceFiles','skills','toolPolicy','sandbox','expectedGatekeepers','model','bindingsHint'])) return fail('invalid schema');
  if (typeof value.name !== 'string' || !ID.test(value.name) || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version)) return fail('invalid name/version');
  for(const k of ['description','bindingsHint','model']) if(value[k] !== undefined && (typeof value[k] !== 'string' || (value[k] as string).length > 2000)) return fail('invalid text field');
  if(!strings(value.workspaceFiles) || !value.workspaceFiles.includes('AGENTS.md') || !value.workspaceFiles.includes('SOUL.md') || !value.workspaceFiles.every(x => ['AGENTS.md','SOUL.md','USER.md','IDENTITY.md','BOOT.md','README.md'].includes(x))) return fail('invalid workspace files');
  if(!strings(value.skills) || !value.skills.every(x=>ID.test(x))) return fail('invalid skills');
  if(!strings(value.expectedGatekeepers) || !value.expectedGatekeepers.every(x=>catalog.includes(x))) return fail('unknown gatekeeper');
  const t=value.toolPolicy,s=value.sandbox;
  if(!object(t)||!keys(t,['profile','allow','deny'])||!['minimal','messaging','coding'].includes(String(t.profile))||!strings(t.allow)||!strings(t.deny)||![...t.allow,...t.deny].every(x=>/^[a-z][a-z0-9_:-]*$/.test(x))) return fail('invalid tool policy');
  if([...t.allow,...t.deny].some(x=>x.startsWith('group:')&&!['group:runtime','group:fs','group:memory','group:sessions','group:web','group:ui','group:automation','group:messaging'].includes(x)))return fail('unsupported tool group');
  if(!object(s)||!keys(s,['mode','workspaceAccess'])||!['off','non-main','all'].includes(String(s.mode))||(s.workspaceAccess!==undefined&&!['none','ro','rw'].includes(String(s.workspaceAccess))))return fail('invalid sandbox');
  const runtime=t.profile==='coding'||t.allow.some(x=>['exec','bash','process','code_execution','group:runtime'].includes(x));
  const fs=runtime||t.allow.some(x=>['read','write','edit','apply_patch','ls','group:fs'].includes(x));
  if(runtime&&s.mode!=='all')return fail('exec requires sandbox.mode all');
  if(fs&&s.mode==='off')return fail('filesystem requires sandbox');
  return value as unknown as Blueprint;
}
/** Refuse symlink traversal in authored trees and managed destinations, including ancestor components. */
export function assertPlainPath(path: string): void {
  const absolute=resolve(path); let cursor=absolute;
  for(;;){try{if(lstatSync(cursor).isSymbolicLink())fail('symlink refused');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;}
}
/** Load only declared text files; README always participates, skills are local SKILL.md trees. */
export function loadBlueprint(root: string, catalog: string[]): {blueprint: Blueprint; files: Record<string,string>; fingerprint:string} {
  assertPlainPath(root);
  const read=(name:string)=>{const path=join(root,name);assertPlainPath(path);if(!lstatSync(path).isFile()||lstatSync(path).size>262144)fail('invalid template file');return readFileSync(path,'utf8');};
  let value:unknown;try{value=JSON.parse(read('blueprint.json'));}catch{return fail('unreadable blueprint');}
  const blueprint=validateBlueprint(value,catalog),files:Record<string,string>={};
  for(const name of new Set([...blueprint.workspaceFiles,'README.md']))files[name]=read(name);
  if(!/no access|access to nothing/i.test(files['AGENTS.md']!)||!files['AGENTS.md']!.includes('os_request_access'))fail('missing capability instructions');
  // Upstream bootstrap-extra-files rejects README basenames; include its text in AGENTS instead.
  files['AGENTS.md']+='\n## Blueprint guide\n\n'+files['README.md'];
  const visit=(dir:string)=>{for(const child of readdirSync(join(root,dir))){if(!/^[A-Za-z0-9_.-]+$/.test(child)||['.','..'].includes(child))fail('invalid skill path');const rel=dir+'/'+child;assertPlainPath(join(root,rel));if(lstatSync(join(root,rel)).isDirectory())visit(rel);else files[rel]=read(rel);}};
  for(const skill of blueprint.skills){read(`skills/${skill}/SKILL.md`);visit(`skills/${skill}`);}
  return {blueprint,files,fingerprint:digest(JSON.stringify({blueprint,files}))};
}
/** Agent-scoped safety policy; neither grants nor bindings nor credentials are copied. */
export function blueprintEntry(b: Blueprint, workspace: string): Record<string,Json> {
  const runtime=b.toolPolicy.profile==='coding'||b.toolPolicy.allow.some(x=>['exec','bash','process','code_execution','group:runtime'].includes(x));
  return {workspace,skills:b.skills,...(b.model?{model:{primary:b.model}}:{}),tools:{profile:b.toolPolicy.profile,
    alsoAllow:[...new Set(['clawos-kernel',...b.toolPolicy.allow])],deny:b.toolPolicy.deny,
    ...(b.sandbox.mode!=='off'?{sandbox:{tools:{alsoAllow:[...new Set(['clawos-kernel',...b.toolPolicy.allow])]}}}:{}),
    elevated:{enabled:false},exec:{host:'sandbox',mode:runtime?'full':'deny'}},
    sandbox:{...b.sandbox,...(b.sandbox.mode!=='off'?{scope:'agent',backend:'docker',docker:{network:'none',readOnlyRoot:true,capDrop:['ALL']}}:{})}};
}
interface Snapshot {version:1; blueprint:string; fingerprint:string; workspace:string; files:Record<string,string>; entry:Record<string,Json>}
/** Values are never included in drift reports. Missing files and agent policy are distinct paths. */
export function blueprintDrift(snapshot: Snapshot, liveEntry: Json|undefined): string[] {
  const paths:string[]=[];
  for(const [name,expected] of Object.entries(snapshot.files)) {const path=join(snapshot.workspace,name);assertPlainPath(path);if(!existsSync(path)||digest(readFileSync(path,'utf8'))!==expected)paths.push('workspace/'+name);}
  for(const [key,value] of Object.entries(snapshot.entry))if(canonicalize(object(liveEntry)?liveEntry[key]:undefined)!==canonicalize(value))paths.push('config/'+key);
  return paths;
}
function templateRoot():string {
  const packaged=join(dirname(fileURLToPath(import.meta.url)),'templates');
  if(existsSync(join(packaged,'blueprints')))return packaged;
  if(process.env.CLAWOS_FROM_SOURCE)return resolve(process.env.CLAWOS_FROM_SOURCE);
  return fail('templates unavailable');
}
function catalogAt(root:string):string[]{const file=existsSync(join(root,'gatekeepers.json'))?join(root,'gatekeepers.json'):join(root,'config/gatekeepers.json');const data=JSON.parse(readFileSync(file,'utf8'));if(!object(data.gatekeepers))return fail('invalid catalog');return Object.keys(data.gatekeepers);}
function blueprintRoot(root:string,name:string):string {if(!ID.test(name))return fail('invalid blueprint name');return existsSync(join(root,'blueprints'))?join(root,'blueprints',name):join(root,'packages/clawos-blueprints',name);}
function liveEntry(config:Json,id:string):Json|undefined {const entries=getPath(config,'agents.entries');if(object(entries))return entries[id];const list=getPath(config,'agents.list');return Array.isArray(list)?list.find(e=>object(e)&&e.id===id):undefined;}
/** Identify known catalog dependencies independently from whether the runtime has loaded them. */
function dependencyStatus(cell:Cell,b:Blueprint):string[] {
  try{const registry=JSON.parse(readFileSync(join(cell.osDir,'gatekeepers.json'),'utf8'));const rows=registry.gatekeepers;
    if(!Array.isArray(rows))return b.expectedGatekeepers;return b.expectedGatekeepers.filter(v=>!rows.some(r=>r.vendor===v));
  }catch{return b.expectedGatekeepers;}
}
/** Provision once, then refuse drift instead of overwriting operator edits. Failure journals require review. */
export async function applyBlueprint(cell:Cell,root:string,id:string,catalog:string[],applyConfig=()=>reconcile(cell.name)) {
  if(!ID.test(id)||id==='main')return fail('invalid or reserved agent id');
  const loaded=loadBlueprint(root,catalog),b=loaded.blueprint;
  const workspace=join(cell.stateDir,'agents',id,'workspace'),snapshotDir=join(cell.osDir,'blueprints',id),snapshotPath=join(snapshotDir,'snapshot.json');
  const fragment=join(cell.osDir,'config.d','30-agents.json5');
  for(const path of [workspace,snapshotDir,fragment])assertPlainPath(path);
  const before=configRevision(cell),config=readOwnedConfig(cell);if(configRevision(cell)!==before)fail('config changed during preflight');
  const existing=liveEntry(config,id),entry=blueprintEntry(b,workspace);
  const inheritedBinds=getPath(config,'agents.defaults.sandbox.docker.binds');
  if(b.sandbox.mode!=='off'&&Array.isArray(inheritedBinds)&&inheritedBinds.length)fail('inherited Docker bind mounts require explicit review');
  const dependencyPending=dependencyStatus(cell,b);
  const globalDeny=getPath(config,'tools.deny');
  const policyConflicts=Array.isArray(globalDeny)?globalDeny.filter(x=>typeof x==='string'&&(
    b.toolPolicy.allow.includes(x)||x==='*'||(x==='group:runtime'&&b.toolPolicy.allow.some(t=>['exec','process'].includes(t)))||
    (x==='group:automation'&&b.toolPolicy.allow.includes('cron')))):[];
  const receipt={blueprint:b.name,agent:id,dependencyPending,policyConflicts,fullAcceptance:false};
  if(existsSync(snapshotPath)) {
    const snapshot=JSON.parse(readFileSync(snapshotPath,'utf8')) as Snapshot;
    if(snapshot.version!==1||snapshot.workspace!==workspace||snapshot.blueprint!==b.name||snapshot.fingerprint!==loaded.fingerprint)fail('snapshot version differs; explicit migration required');
    const drift=blueprintDrift(snapshot,existing);
    const desired=parseFragment(readFileSync(fragment,'utf8'),fragment);
    if(canonicalize(getPath(desired,`agents.entries.${id}`))!==canonicalize(snapshot.entry))drift.push('fragment/agent');
    if(drift.length)fail('drift detected; inspect blueprint diff');
    return {...receipt,changed:false};
  }
  const intent=join(snapshotDir,'pending.json');
  if(existsSync(intent))fail('incomplete provisioning; inspect pending journal before retry');
  if(existing||existsSync(workspace))fail('agent or workspace already exists; adoption refused');
  if(!existsSync(fragment))fail('cell not installed');
  const fragmentBefore=readFileSync(fragment,'utf8');
  const desired=parseFragment(fragmentBefore,fragment);
  if(!object(desired.agents)||!object(desired.agents.entries)||desired.agents.entries[id])fail('agent fragment collision');
  const entries=desired.agents.entries;
  mkdirSync(snapshotDir,{recursive:true,mode:0o700});
  // OS-side lock serializes blueprint writers, never bypasses the SDK's config revision guard.
  const lock=join(cell.osDir,'.blueprint-lock');try{mkdirSync(lock,{mode:0o700});}catch{return fail('another blueprint writer is active');}
  try {
    if(configRevision(cell)!==before)fail('config changed before provisioning');
    writeJson(intent,{version:1,agent:id,blueprint:b.name,stage:'registering'});
    const add=openclaw(cell,['agents','add',id,'--workspace',workspace,'--non-interactive','--json']);
    if(add.code!==0)fail('agents add failed; pending journal retained');
    assertPlainPath(workspace);
    for(const [name,content] of Object.entries(loaded.files)){assertPlainPath(join(workspace,name));writeFileIfChanged(join(workspace,name),content);}
    if(readFileSync(fragment,'utf8')!==fragmentBefore)fail('agent fragment changed during provisioning; pending journal retained');
    entries[id]=entry;
    writeJson(fragment,desired);
    if(canonicalize(getPath(mergeFragments(join(cell.osDir,'config.d')),`agents.entries.${id}`))!==canonicalize(entry))fail('later fragment overrides blueprint policy; pending journal retained');
    writeJson(intent,{version:1,agent:id,blueprint:b.name,stage:'reconciling'});
    const result=await applyConfig();if(result.conflicts?.length)fail('configuration conflicts; pending journal retained');
    const after=liveEntry(readOwnedConfig(cell),id);
    const snapshot:Snapshot={version:1,blueprint:b.name,fingerprint:loaded.fingerprint,workspace,files:Object.fromEntries(Object.entries(loaded.files).map(([k,v])=>[k,digest(v)])),entry};
    if(blueprintDrift(snapshot,after).length)fail('verification failed; pending journal retained');
    writeJson(snapshotPath,snapshot);rmSync(intent);return {...receipt,changed:true};
  }finally{rmSync(lock,{recursive:true});}
}
/** `clawos blueprint list|lint|apply|diff`, no automatic grant, install, binding or approval. */
export async function blueprint(args:string[],globals:GlobalOptions):Promise<number> {
  const [command,name]=args,root=templateRoot(),catalog=catalogAt(root);
  const rest=command==='apply'?args.slice(2):command==='diff'?args.slice(1):[];
  if(command==='list'&&args.length!==1||command==='lint'&&args.length!==2)fail('invalid command arguments');
  if(command==='apply'||command==='diff'){
    const flags=rest.filter(x=>x.startsWith('--'));
    if(flags.some(x=>x!=='--agent')||flags.length>1||rest.length!==(flags.length?2:command==='diff'&&name?1:0)||flags.length&&rest[0]!=='--agent')fail('invalid or duplicate command arguments');
  }
  let result:unknown;
  if(command==='list'){result=readdirSync(existsSync(join(root,'blueprints'))?join(root,'blueprints'):join(root,'packages/clawos-blueprints')).filter(n=>ID.test(n)&&existsSync(join(blueprintRoot(root,n),'blueprint.json'))).sort().map(n=>{const {blueprint:b}=loadBlueprint(blueprintRoot(root,n),catalog);return {name:b.name,version:b.version,expectedGatekeepers:b.expectedGatekeepers};});}
  else if(command==='lint'&&name){loadBlueprint(isAbsolute(name)||name.includes('/')?resolve(name):blueprintRoot(root,name),catalog);result={valid:true};}
  else if(command==='apply'&&name){if(!globals.yes)fail('apply requires --yes');const id=optionValue(args,'--agent');if(!id)fail('--agent required');result=await applyBlueprint(resolveCellFromRegistry(globals.cell),blueprintRoot(root,name),id,catalog);}
  else if(command==='diff'){const id=optionValue(args,'--agent')??name;if(!id||!ID.test(id))fail('--agent required');const cell=resolveCellFromRegistry(globals.cell),path=join(cell.osDir,'blueprints',id,'snapshot.json');assertPlainPath(path);if(!existsSync(path))fail('no applied snapshot');const snapshot=JSON.parse(readFileSync(path,'utf8')) as Snapshot;if(snapshot.workspace!==join(cell.stateDir,'agents',id,'workspace'))fail('invalid snapshot workspace');const paths=blueprintDrift(snapshot,liveEntry(readOwnedConfig(cell),id));const fragment=parseFragment(readFileSync(join(cell.osDir,'config.d','30-agents.json5'),'utf8'),'30-agents.json5');if(canonicalize(getPath(fragment,`agents.entries.${id}`))!==canonicalize(snapshot.entry))paths.push('fragment/agent');result={changed:paths.length>0,paths};}
  else return 2;
  console.log(JSON.stringify(result));return 0;
}
