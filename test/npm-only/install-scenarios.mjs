import {selectCell,configGet} from './selector.mjs';
// Real pinned CLI installs and policy decisions. Only structural flags are exported.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
if(process.env.HOME!=='/home/tester'||process.cwd()!=='/home/tester/npm-acceptance'||process.env.OPENCLAW_STATE_DIR!=='/home/tester/.openclaw-kernel-test')throw new Error('VM required');
const cell=selectCell(),state=cell.stateDir, checks={};
const invoke=(cmd,args,input)=>spawnSync(cmd,args,{encoding:'utf8',input,timeout:120000,maxBuffer:1024*1024});
const assert=(name,value)=>{checks[name]=!!value;if(!value){process.stdout.write(JSON.stringify({runId:process.env.GKOS_TEST_START,checks,failure:name})+'\n');process.exit(1);}};
const fixture='/home/tester/reviewed-install-fixture';mkdirSync(fixture,{recursive:true});
writeFileSync(join(fixture,'package.json'),JSON.stringify({name:'gkos-install-fixture',version:'1.0.0',type:'module',openclaw:{extensions:['./index.js']}}));
writeFileSync(join(fixture,'openclaw.plugin.json'),JSON.stringify({id:'gkos-install-fixture',name:'Inert install fixture',configSchema:{type:'object',additionalProperties:false,properties:{}}}));
writeFileSync(join(fixture,'index.js'),'export default { id:"gkos-install-fixture",register(){} };\n');
const projected={plugins:configGet('plugins'),security:configGet('security')};
assert('no-filesystem-roots',projected.plugins.entries['gkos-gatekeeper-fs'].config.roots.length===0);
assert('primary-policy-enabled',projected.security.installPolicy.enabled===true);
assert('cell-local-artifacts',projected.plugins.load.paths.every(p=>p.startsWith(join(state,'os/plugins')+'/')&&existsSync(join(p,'dist/index.js'))));
const target=join(state,'extensions/gkos-install-fixture');
assert('reviewed-fixture-present',['package.json','openclaw.plugin.json','index.js'].every(name=>existsSync(join(fixture,name))));
let result=invoke('openclaw',['plugins','install',fixture,'--force','--accept-capabilities']);
writeFileSync('/home/tester/install-blocked.log',result.stdout+result.stderr,{mode:0o600});
assert('real-cli-blocks-unlisted-source',result.status!==0&&!existsSync(target)&&/not authorized by cell policy/.test(result.stdout+result.stderr));
// The operator changes an ordinary local fragment. config apply must preserve the install boundary.
const local=join(state,'os/config.d/90-local.json5'),saved=readFileSync(local,'utf8');
writeFileSync(local,JSON.stringify({plugins:{entries:{'gkos-kernel':{config:{install:{allowSources:[fixture]}}}}}}),{mode:0o600});
result=invoke('gkos',['config','apply','--cell','kernel-test','--json']);
writeFileSync('/home/tester/install-allow-config.log',result.stdout+result.stderr,{mode:0o600});
assert('operator-policy-reconciles',result.status===0);
const effective={plugins:configGet('plugins')};
const rules=effective.plugins.entries['gkos-kernel'].config.install;
assert('reviewed-policy-reconciled-to-selected-cell',rules.allowSources?.length===1&&rules.allowSources[0]===fixture&&rules.allowHashes?.length===0);
result=invoke('openclaw',['plugins','install',fixture,'--force','--accept-capabilities']);
writeFileSync('/home/tester/install-allowed.log',result.stdout+result.stderr,{mode:0o600});
assert('real-cli-allows-reviewed-source',result.status===0&&existsSync(join(target,'openclaw.plugin.json')));
// Invalid protocol and source/hash lookalikes must never become authority.
const command=projected.security.installPolicy.exec;
const probe={protocolVersion:1,targetType:'plugin',sourcePath:fixture,sourcePathKind:'directory',request:{kind:'plugin-install',mode:'install',requestedSpecifier:'/unreviewed'},source:fixture,hash:'reviewed'};
for(const [name,input] of [['forged-labels',JSON.stringify(probe)],['invalid-protocol',JSON.stringify({...probe,protocolVersion:2})],['malformed-json','{']]){
  result=invoke(command.command,command.args,input);assert(name,JSON.parse(result.stdout).decision==='block');
}
// Use a fresh, exactly allowed fixture so an already-installed or unlisted source cannot explain denial.
const unavailableFixture='/home/tester/unavailable-policy-fixture',unavailableTarget=join(state,'extensions/gkos-unavailable-fixture');
mkdirSync(unavailableFixture,{recursive:true});
writeFileSync(join(unavailableFixture,'package.json'),JSON.stringify({name:'gkos-unavailable-fixture',version:'1.0.0',type:'module',openclaw:{extensions:['./index.js']}}));
writeFileSync(join(unavailableFixture,'openclaw.plugin.json'),JSON.stringify({id:'gkos-unavailable-fixture',configSchema:{type:'object',additionalProperties:false,properties:{}}}));
writeFileSync(join(unavailableFixture,'index.js'),'export default { id:"gkos-unavailable-fixture",register(){} };\n');
assert('unavailable-fixture-not-installed',!existsSync(unavailableTarget));
const cfg=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH,'utf8'));
cfg.plugins.entries['gkos-kernel'].config.install.allowSources.push(unavailableFixture);
cfg.security.installPolicy.exec.command='/nonexistent/gkos-policy';writeFileSync(process.env.OPENCLAW_CONFIG_PATH,JSON.stringify(cfg),{mode:0o600});
result=invoke('openclaw',['plugins','install',unavailableFixture,'--force','--accept-capabilities']);
writeFileSync('/home/tester/install-unavailable.log',result.stdout+result.stderr,{mode:0o600});
assert('unavailable-policy-fails-closed',result.status!==null&&result.status!==0&&!existsSync(unavailableTarget)&&/install policy/i.test(result.stdout+result.stderr));
// Restore the original policy by normal ownership-aware reconciliation. Keep fixture installation evidence; no snapshot refresh.
writeFileSync(local,saved,{mode:0o600});
result=invoke('gkos',['config','apply','--cell','kernel-test','--force','--json']);
writeFileSync('/home/tester/install-restore-config.log',result.stdout+result.stderr,{mode:0o600});
assert('policy-restored',result.status===0);
process.stdout.write(JSON.stringify({runId:process.env.GKOS_TEST_START,checks,fullPhaseAcceptance:false})+'\n');
