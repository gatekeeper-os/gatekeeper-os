/** VM-only throwaway Gateway lifecycle; production state is never inherited. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.env.CLAWOS_SPIKE_VM !== '1') throw new Error('Run dev:gateway inside the test VM');
const port = Number(process.env.CLAWOS_DEV_PORT ?? 19110);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid development port');
const state = mkdtempSync(join(tmpdir(), 'clawos-dev-'));
const config = join(state, 'openclaw.json');
mkdirSync(join(state, 'workspace'), { mode: 0o700 });
writeFileSync(config, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port,
  auth: { mode: 'token', token: randomBytes(32).toString('hex') } },
  agents: { defaults: { workspace: join(state, 'workspace') } },
  plugins: { enabled: false }, update: { auto: { enabled: false } } }), { mode: 0o600 });
const env = { ...process.env, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: config,
  OPENCLAW_GATEWAY_PORT: String(port), OPENCLAW_NO_AUTO_UPDATE: '1' };
delete env.OPENCLAW_PROFILE;
delete env.OPENCLAW_GATEWAY_TOKEN;
let stopping = false;
// Never relay raw Gateway output into acceptance artifacts.
const child = spawn('openclaw', ['gateway', 'run'], { env, stdio: 'ignore' });
const stop = () => { stopping = true; child.kill('SIGTERM'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('error', () => { console.error('[dev-gateway] spawn failed'); process.exitCode = 1; });
child.on('exit', code => process.exit(stopping ? 0 : (code ?? 1)));
const deadline = Date.now() + 120_000;
while (!stopping && child.exitCode === null) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(1000) });
    if (response.ok) { console.log(`[dev-gateway] ready port=${port}`); break; }
  } catch { /* Startup may not have bound the socket yet. */ }
  if (Date.now() > deadline) {
    console.error('[dev-gateway] readiness deadline exceeded'); child.kill('SIGTERM'); process.exitCode = 1; break;
  }
  await new Promise(resolve => setTimeout(resolve, 500));
}
