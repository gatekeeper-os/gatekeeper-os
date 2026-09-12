/** Disposable negative control: installed metadata is copied, never modified in place. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCellFromRegistry } from '../../packages/clawos-cli/src/util/cell.js';
import { readLockfile } from '../../packages/clawos-cli/src/util/lockfile.js';
import { updateEffects } from '../../packages/clawos-cli/src/commands/update.js';
import { executeUpdate, readUpdate, type UpdateJournal } from '../../packages/clawos-cli/src/util/update-transaction.js';
if(process.env.HOME!=='/home/tester'||process.cwd()!=='/home/tester/src')throw new Error('DISPOSABLE_VM_REQUIRED');
const cell=resolveCellFromRegistry(),lock=readLockfile(cell)!;
const target=spawnSync('npm',['view','openclaw@latest','version'],{encoding:'utf8'}).stdout.trim();
if(target===lock.upstream.version)throw new Error('DISTINCT_TARGET_REQUIRED');
const root='/home/tester/.clawos/update-compat';mkdirSync(root,{recursive:true,mode:0o700});
const original=readFileSync(cell.configPath,'utf8'),config=JSON.parse(original),paths=[];
for(const path of config.plugins.load.paths){const manifest=JSON.parse(readFileSync(join(path,'openclaw.plugin.json'),'utf8'));if(!Object.hasOwn(lock.plugins,manifest.id))continue;const pkg=JSON.parse(readFileSync(join(path,'package.json'),'utf8'));if(manifest.id==='clawos-kernel')pkg.openclaw.compat.pluginApi='='+lock.upstream.version;const copied=join(root,manifest.id);mkdirSync(copied,{recursive:true,mode:0o700});writeFileSync(join(copied,'package.json'),JSON.stringify(pkg));writeFileSync(join(copied,'openclaw.plugin.json'),JSON.stringify(manifest));paths.push(copied);}
const fake={...cell,configPath:join(root,'config.json')};writeFileSync(fake.configPath,JSON.stringify({plugins:{load:{paths}}}),{mode:0o600});
const j:UpdateJournal={format:1,id:randomBytes(16).toString('hex'),cell:cell.name,from:lock.upstream.version,target,kernelSchema:1,state:'preparing',step:1,completed:[],startedAt:new Date().toISOString(),previousBinary:'/not-invoked',candidateBinary:'/not-invoked',previousDropIn:null};
const effects=updateEffects(fake,lock,j,'/not-invoked');effects.backup=async()=>{throw new Error('UNEXPECTED_BACKUP');};
const journal=join(root,'negative-journal.json');try{await executeUpdate(journal,j,effects);throw new Error('UNEXPECTED_SUCCESS');}catch{if(readUpdate(journal).step!==2||readUpdate(journal).state!=='blocked')throw new Error('WRONG_FAILURE_STAGE');}
if(readFileSync(cell.configPath,'utf8')!==original)throw new Error('ACTIVE_CONFIG_CHANGED');
writeFileSync('/home/tester/phase-7-evidence/compatibility-rejection.json',JSON.stringify({ok:true,step:2,target,activeConfigUnchanged:true,metadataCopiesOnly:true,fullPhaseAcceptance:false})+'\n');
