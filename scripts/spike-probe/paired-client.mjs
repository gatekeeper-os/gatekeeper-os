// VM-only public SDK client. Auth stays in memory; output contains presence flags only.
import { readFileSync, writeFileSync } from 'node:fs';
import { GatewayClient } from 'openclaw/plugin-sdk/gateway-runtime';
if (process.env.CLAWOS_SPIKE_VM !== '1' || process.env.OPENCLAW_STATE_DIR !== '/home/tester/clawos-spike-state' || process.env.OPENCLAW_CONFIG_PATH !== '/home/tester/clawos-spike-state/openclaw.json') throw new Error('Isolated VM required');
const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
const observations = [];
async function connect(auth) {
  let client;
  try {
    return await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('paired-client-timeout')), 30000);
      client = new GatewayClient({
        url: 'ws://127.0.0.1:19100', ...auth,
        hostDeps: { logDebug() {}, logError() {} },
        clientName: 'cli', mode: 'cli', role: 'operator', scopes: ['operator.admin'],
        onHelloOk: async hello => {
          try {
            const report = await client.request('os-spike.report', {});
            const identity = report.records.filter(row => row.q === 'g:gateway-client').at(-1)?.data;
            observations.push({ identity, deviceTokenIssued: Boolean(hello.auth?.deviceToken) });
            clearTimeout(deadline);
            if (!identity?.hasDeviceId || identity.role !== 'operator') reject(new Error('paired-client-identity-absent'));
            else resolve(hello.auth?.deviceToken);
          } catch { clearTimeout(deadline); reject(new Error('paired-client-rpc-failed')); }
        },
        onConnectError: () => { clearTimeout(deadline); reject(new Error('paired-client-connect-failed')); },
      });
      client.start();
    });
  } finally { await client?.stopAndWait({ timeoutMs: 5000 }); }
}
let ok = false;
try {
  const deviceToken = await connect({ token: config.gateway.auth.token });
  if (!deviceToken) throw new Error('paired-client-token-not-issued');
  await connect({ deviceToken });
  ok = observations.at(-1)?.identity.isDeviceTokenAuth === true;
  if (!ok) throw new Error('paired-client-token-auth-absent');
  console.log('PASS paired-client-identity-and-device-token-reconnect');
} catch (error) {
  console.log('FAIL '+(error.message.startsWith('paired-client-') ? error.message : 'paired-client-unexpected'));
  process.exitCode = 1;
} finally {
  writeFileSync('/home/tester/phase-0-evidence/paired-client.json', JSON.stringify({ ok, observations }, null, 2)+'\n');
}
