// Inspect only disposable-VM logs; publish booleans/counts, never raw lines.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
if(process.cwd()!=='/home/tester/src'||process.env.OPENCLAW_STATE_DIR!=='/home/tester/.openclaw-kernel-test')throw new Error('VM required');
const files=['/home/tester/mcp-boundary-gateway.log','/home/tester/mcp-fixture-gateway.log'];
for(const dir of ['/tmp/openclaw','/home/tester/.openclaw-kernel-test/os/audit'])if(existsSync(dir))for(const name of readdirSync(dir))if(/\.jsonl?$|\.log$/.test(name))files.push(join(dir,name));
const needles=['fixture-base','-fixture-change','synthetic-private-error-body','synthetic-fixture-credential-not-real'];
const report={syntheticOnly:true,nativeDenialNotTested:true,files:0,clean:true};
for(const file of files)if(existsSync(file)){report.files++;const body=readFileSync(file,'utf8');if(needles.some(value=>body.includes(value)))report.clean=false;}
writeFileSync('/home/tester/phase-8-boundary-evidence/secrecy.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
if(!report.clean||report.files<2)process.exitCode=1;
