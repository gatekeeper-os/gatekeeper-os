import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
if(process.env.CLAWOS_SPIKE_VM!=='1') throw new Error('VM required');
const path=process.env.OPENCLAW_CONFIG_PATH;
const cfg=JSON.parse(readFileSync(path,'utf8'));
cfg.security={...cfg.security,installPolicy:{enabled:true,targets:['plugin'],exec:{
 source:'exec',command:resolve('scripts/spike-policy.mjs'),args:[process.argv[2]],
 passEnv:['OPENCLAW_STATE_DIR'],trustedDirs:[resolve('scripts')],timeoutMs:10000,
}}};
writeFileSync(path,JSON.stringify(cfg,null,2)+'\n',{mode:0o600});
