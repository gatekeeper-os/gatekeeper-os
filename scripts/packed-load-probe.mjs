// Run in a child so SDK state lookup inherits only the isolated cell environment.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(process.argv[2]);
const { GatewayClient } = await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
const clients = [];
async function connect(auth) {
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Packed probe connection timeout')), 30000);
      const client = new GatewayClient({ url: process.argv[3], ...auth, env: process.env,
        clientName: 'cli', mode: 'cli', role: 'operator', scopes: ['operator.admin'], requestTimeoutMs: 30000,
        hostDeps: { logDebug() {}, logError() {} },
        onHelloOk: hello => resolve({ client, deviceToken: hello.auth?.deviceToken }),
        onConnectError: () => reject(new Error('Packed probe connection failed')) });
      clients.push(client); client.start();
    });
  } finally { clearTimeout(timer); }
}
try {
  const shared = await connect({ token: process.env.OPENCLAW_GATEWAY_TOKEN });
  if (!shared.deviceToken) throw new Error('Packed probe did not receive device authentication');
  const paired = await connect({ deviceToken: shared.deviceToken });
  const status = await paired.client.request('os.status', {});
  // Only structural evidence leaves the probe. Never print tokens or RPC payloads.
  console.log(JSON.stringify({ healthy: status.healthy === true, kernelVersion: status.kernelVersion }));
} catch { console.error('Packed authenticated live kernel probe failed'); process.exitCode = 1; }
finally { for (const client of clients) await client.stopAndWait({ timeoutMs: 5000 }); }
