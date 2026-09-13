// Test-only readback of product selectors. No defaults, workspace fallbacks, or auth output.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function command(binary,args){
 const r=spawnSync(binary,args,{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
 if(r.status!==0)throw new Error('selector-command-failed');
 return r.stdout;
}
export function configGet(key){return JSON.parse(command('openclaw',['config','get',key,'--json']));}
export function selectCell(){
 if(process.env.GKOS_KERNEL_VM!=='1'||process.cwd()!=='/home/tester/npm-acceptance')throw new Error('vm-required');
 const rows=JSON.parse(command('gkos',['cell','list','--json']));
 const matches=rows.filter(r=>r.name===process.env.GKOS_CELL);
 if(matches.length!==1)throw new Error('selected-cell-missing');
 const cell=matches[0],file=join(cell.stateDir,'openclaw.json');
 if(cell.name!=='kernel-test'||cell.stateDir!=='/home/tester/.openclaw-kernel-test'||file!==process.env.OPENCLAW_CONFIG_PATH||cell.stateDir!==process.env.OPENCLAW_STATE_DIR||String(cell.port)!==process.env.OPENCLAW_GATEWAY_PORT)throw new Error('cell-selector-mismatch');
 if(!Number.isInteger(cell.port)||cell.port<1024||cell.port>65535)throw new Error('cell-port-invalid');
 const env=command('systemctl',['--user','show',cell.unit,'--property=Environment','--value']);
 // Inspect only selector fields; never emit the unit environment or token values.
 for(const [key,value]of Object.entries({OPENCLAW_STATE_DIR:cell.stateDir,OPENCLAW_CONFIG_PATH:file,GKOS_CELL:cell.name})){
  if(!env.split(/\s+/).map(s=>s.replace(/^"|"$/g,'')).includes(key+'='+value))throw new Error('unit-selector-mismatch');
 }
 const start=command('systemctl',['--user','show',cell.unit,'--property=ExecStart','--value']);
 if(!start.includes('--port '+cell.port))throw new Error('unit-port-mismatch');
 const catalog=process.env.GKOS_GATEKEEPER_CATALOG||join(cell.stateDir,'os/gatekeepers.json');
 if(catalog!==join(cell.stateDir,'os/gatekeepers.json'))throw new Error('catalog-selector-mismatch');
 return {name:cell.name,stateDir:cell.stateDir,file,unit:cell.unit,port:cell.port,catalog,http:'http://127.0.0.1:'+cell.port,ws:'ws://127.0.0.1:'+cell.port};
}
if(process.argv[2]==='receipt'){
 const cell=selectCell();
 writeFileSync('/home/tester/npm-acceptance-evidence/cell-selector.json',JSON.stringify(cell,null,2)+'\n',{mode:0o600});
 console.log('PASS effective-cell-registry-unit-environment');
}
