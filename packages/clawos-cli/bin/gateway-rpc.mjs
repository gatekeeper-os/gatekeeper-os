// Target-cell subprocess: only the installed public SDK is imported. No tokens or RPC bodies in argv/logs.
import { createRequire } from 'node:module';
import { realpathSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const [upstreamBin] = process.argv.slice(2);
let client;
try {
  const state = process.env.OPENCLAW_STATE_DIR;
  if (!state || process.env.OPENCLAW_CONFIG_PATH !== join(state, 'openclaw.json')) throw new Error();
  const port = Number(process.env.OPENCLAW_GATEWAY_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 65536) throw new Error(); }
  const { method, params } = JSON.parse(input);
  if (!['os.status', 'os.grants.list', 'os.grants.introduce', 'os.grants.revoke', 'os.audit.query', 'os.approvals.list', 'os.approvals.apply', 'os.approvals.reject', 'os.approvals.revert', 'os.gatekeepers.list', 'os.gatekeepers.connect', 'os.requests.approve', 'os.requests.reject'].includes(method)) throw new Error();
  // Installer-created cells use an env SecretRef. Resolve only that exact local field, never arbitrary providers.
  const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
  const auth = config.gateway?.auth;
  let token;
  if (auth?.mode !== 'token') throw new Error();
  if (typeof auth.token === 'string') token = auth.token;
  else if (auth.token?.source === 'env' && auth.token.provider === 'default' && auth.token.id === 'CLAWOS_GATEWAY_TOKEN') {
    token = readFileSync(join(state, '.env'), 'utf8').split('\n').find(line => line.startsWith('CLAWOS_GATEWAY_TOKEN='))?.slice('CLAWOS_GATEWAY_TOKEN='.length);
  }
  if (!token) throw new Error();
  const require = createRequire(realpathSync(upstreamBin));
  const { GatewayClient } = await import(pathToFileURL(require.resolve('openclaw/plugin-sdk/gateway-runtime')).href);
  async function connect(credentials) {
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error()), 30000);
        client = new GatewayClient({ url: `ws://127.0.0.1:${port}`, ...credentials, env: process.env,
          clientName: 'cli', mode: 'cli', role: 'operator', scopes: ['operator.admin'], requestTimeoutMs: 30000,
          hostDeps: { logDebug() {}, logError() {} }, onHelloOk: resolve,
          onConnectError: () => reject(new Error()), onClose: () => reject(new Error()) });
        client.start();
      });
    } finally { clearTimeout(timer); }
  }
  const hello = await connect({ token });
  if (!hello.auth?.deviceToken) throw new Error();
  await client.stopAndWait({ timeoutMs: 5000 });
  await connect({ deviceToken: hello.auth.deviceToken });
  let result = await client.request(method, params);
  if (method === 'os.gatekeepers.connect') {
    if (typeof result?.url !== 'string' || !/^\/os\/gatekeeper\/[a-z][a-z0-9_]{0,63}\/oauth\/start\?state=[A-Za-z0-9_-]{32}$/.test(result.url)) throw new Error();
    result = { url: new URL(result.url, `http://127.0.0.1:${port}`).href };
  }
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch {
  process.stderr.write('Kernel RPC unavailable or unauthorized; verify this cell and its device pairing.\n');
  process.exitCode = 1;
} finally {
  try { await client?.stopAndWait({ timeoutMs: 5000 }); } catch { process.exitCode = 1; }
}
