// Configure only the isolated disposable Gateway; no upstream files or production state.
import { readFileSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
const state='/home/tester/.openclaw-kernel-test';
if(process.env.GKOS_KERNEL_VM!=='1'||process.env.OPENCLAW_STATE_DIR!==state||process.cwd()!=='/home/tester/src')throw new Error('VM required');
const cfg=JSON.parse(readFileSync(state+'/openclaw.json','utf8'));
if(process.argv[2]==='allow'){
  const saved=JSON.parse(readFileSync(state+'/os/upload-fixture.json','utf8'));
  cfg.plugins.entries['gkos-kernel'].config.install.allowSources=['upload:'+saved.uploadId];
}else{
  cfg.skills={install:{allowUploadedArchives:true}};
  cfg.plugins.allow=cfg.plugins.allow.filter(x=>x!=='gkos-kernel-monitor');cfg.plugins.allow.push('gkos-install-hook-monitor');
  cfg.plugins.load.paths=cfg.plugins.load.paths.filter(x=>!x.endsWith('/kernel-monitor'));cfg.plugins.load.paths.push(resolve('test/fixtures/install-hook-monitor'));
  delete cfg.plugins.entries['gkos-kernel-monitor'];cfg.plugins.entries['gkos-install-hook-monitor']={enabled:true};
  cfg.plugins.entries['gkos-gatekeeper-fs'].config.roots=[];
  copyFileSync('/home/tester/install-hook-build/install-hook-primary.js',state+'/os/install-hook-primary.mjs');chmodSync(state+'/os/install-hook-primary.mjs',0o600);
  cfg.security={installPolicy:{enabled:true,exec:{source:'exec',command:process.execPath,args:[state+'/os/install-hook-primary.mjs'],passEnv:['HOME']}}};
  writeFileSync(state+'/os/primary-rules.json',JSON.stringify({allowSources:[]}),{mode:0o600});
}
writeFileSync(state+'/openclaw.json',JSON.stringify(cfg),{mode:0o600});
