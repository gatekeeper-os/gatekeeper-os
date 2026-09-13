import {afterEach,expect,it,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {selectCell,configGet} from '../../../test/npm-only/selector.mjs';
vi.mock('node:child_process',()=>({spawnSync:vi.fn()}));
const state='/home/tester/.openclaw-kernel-test';
function setup({port=19100,unitPort=19100,name='kernel-test'}={}) {
 vi.spyOn(process,'cwd').mockReturnValue('/home/tester/npm-acceptance');
 for(const [k,v]of Object.entries({GKOS_KERNEL_VM:'1',GKOS_CELL:'kernel-test',OPENCLAW_STATE_DIR:state,OPENCLAW_CONFIG_PATH:state+'/openclaw.json',OPENCLAW_GATEWAY_PORT:String(port)}))vi.stubEnv(k,v);
 vi.stubEnv('GKOS_GATEKEEPER_CATALOG','');
 vi.mocked(spawnSync).mockImplementation((binary,args)=>{
  let stdout='';
  if(binary==='gkos')stdout=JSON.stringify([{name,port,stateDir:state,unit:'openclaw-gateway-kernel-test.service'}]);
  else if(binary==='systemctl'&&args.includes('--property=Environment'))stdout=`OPENCLAW_STATE_DIR=${state} OPENCLAW_CONFIG_PATH=${state}/openclaw.json GKOS_CELL=kernel-test`;
  else if(binary==='systemctl')stdout=`{ argv[]=node openclaw gateway run --port ${unitPort} ; }`;
  else if(binary==='openclaw')stdout='{"profile":"messaging","exec":{"mode":"deny"}}';
  else throw Error('unexpected-selector-command');
  return {status:0,stdout,stderr:'',pid:1,output:[],signal:null};
 });
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it('uses registry and unit port without reading raw gateway.port',()=>{setup();expect(selectCell().port).toBe(19100);expect(selectCell().ws).toBe('ws://127.0.0.1:19100');});
it('follows a different consistent cell port instead of hardcoding 19100',()=>{setup({port:19102,unitPort:19102});expect(selectCell().http).toBe('http://127.0.0.1:19102');});
it('refuses a mismatched service port',()=>{setup({unitPort:18789});expect(()=>selectCell()).toThrow('unit-port-mismatch');});
it('cannot silently select the default cell',()=>{setup({name:'default'});expect(()=>selectCell()).toThrow('selected-cell-missing');});
it('reads policy from upstream config surface',()=>{setup();expect(configGet('tools').exec.mode).toBe('deny');expect(spawnSync).toHaveBeenCalledWith('openclaw',['config','get','tools','--json'],expect.anything());});
