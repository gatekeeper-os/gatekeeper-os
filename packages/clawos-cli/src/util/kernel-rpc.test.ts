/** Protocol tests use a fake public SDK package; no real upstream code or host state is opened. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function invoke(mode: string, method = 'os.status', badPort = false) {
  const root = mkdtempSync(join(tmpdir(), 'clawos-rpc-')); roots.push(root);
  const sdk = join(root, 'node_modules', 'openclaw'); mkdirSync(sdk, { recursive: true });
  writeFileSync(join(root, 'upstream.js'), '');
  writeFileSync(join(sdk, 'package.json'), JSON.stringify({ name: 'openclaw', type: 'module', exports: { './plugin-sdk/gateway-runtime': './client.js' } }));
  writeFileSync(join(sdk, 'client.js'), `
    let opens=0,stops=0;
    export class GatewayClient {
      constructor(options){ this.o=options; opens++; }
      start(){ queueMicrotask(()=>{
        if(process.env.TEST_MODE==='connect-failure') return this.o.onConnectError(new Error('DO_NOT_ECHO_TRANSPORT_PAYLOAD'));
        this.o.onHelloOk({auth:process.env.TEST_MODE==='no-pairing'?{}:{deviceToken:'fixture-device-credential'}});
      }); }
      async request(method,params){
        if(process.env.TEST_MODE==='request-failure')throw new Error('DO_NOT_ECHO_TRANSPORT_PAYLOAD');
        return {opens,stops,method,params,paired:this.o.deviceToken==='fixture-device-credential',sharedTokenAbsent:!this.o.token,url:this.o.url,role:this.o.role};
      }
      async stopAndWait(){stops++;}
    }
  `);
  const state = join(root, 'cell'); mkdirSync(state);
  writeFileSync(join(state, 'openclaw.json'), JSON.stringify({ gateway: { auth: { mode: 'token', token: { source: 'env', provider: 'default', id: 'CLAWOS_GATEWAY_TOKEN' } } } }));
  writeFileSync(join(state, '.env'), 'CLAWOS_GATEWAY_TOKEN=fixture-local-credential\n');
  return spawnSync(process.execPath, [fileURLToPath(new URL('../../bin/gateway-rpc.mjs', import.meta.url)), join(root, 'upstream.js')], {
    env: { ...process.env, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: join(state, 'openclaw.json'), OPENCLAW_GATEWAY_PORT: badPort ? '0' : '19100', TEST_MODE: mode },
    input: JSON.stringify({ method, params: { limit: 17 } }), encoding: 'utf8', timeout: 5000,
  });
}
describe('paired operator client protocol', () => {
  it('closes shared bootstrap, then dispatches only with device authentication to the selected cell', () => {
    const run = invoke('ok'); expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ ok: true, result: { opens: 2, stops: 1, method: 'os.status', params: { limit: 17 }, paired: true, sharedTokenAbsent: true, url: 'ws://127.0.0.1:19100', role: 'operator' } });
    expect(run.stdout + run.stderr).not.toContain('fixture-local-credential');
    expect(run.stdout + run.stderr).not.toContain('fixture-device-credential');
  });
  it.each(['no-pairing', 'connect-failure', 'request-failure'])('fails closed and suppresses raw diagnostics for %s', mode => {
    const run = invoke(mode); expect(run.status).toBe(1); expect(run.stdout).toBe('');
    expect(run.stderr).toContain('unavailable or unauthorized'); expect(run.stderr).not.toContain('DO_NOT_ECHO');
  });
  it('rejects arbitrary RPC dispatch before opening the SDK', () => {
    const run = invoke('ok', 'config.set');
    expect(run.status).toBe(1); expect(run.stdout).toBe('');
    expect(run.stderr).toContain('unavailable or unauthorized');
    expect(run.stderr).not.toContain('MODULE_NOT_FOUND');
  });
  it('rejects an invalid destination before opening the SDK', () => {
    const run = invoke('ok', 'os.status', true);
    expect(run.status).toBe(1); expect(run.stdout).toBe('');
    expect(run.stderr).toContain('unavailable or unauthorized');
    expect(run.stderr).not.toContain('MODULE_NOT_FOUND');
  });
});
