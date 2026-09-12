// Disposable VM fixture: cell create owns policy; only add a local synthetic model.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
const policy = process.env.CLAWOS_BLUEPRINT_POLICY;
const state = `/home/tester/.openclaw-blueprint-${policy}`;
if (!['runtime', 'messaging'].includes(policy) || process.env.OPENCLAW_STATE_DIR !== state || process.cwd() !== '/home/tester/src') throw new Error('Disposable blueprint VM required');
const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
const baseline = join(state, 'os/config.d/00-baseline.json5');
if (readFileSync(baseline, 'utf8') !== readFileSync('config/config.d/00-baseline.json5', 'utf8')) throw new Error('Installed baseline differs');
if (existsSync(join(state, 'os/config.d/05-policy-runtime.json5')) !== (policy === 'runtime')) throw new Error('Wrong installed policy fragment set');
if (policy === 'runtime' && config.agents?.defaults?.sandbox?.mode !== 'all') throw new Error('Runtime default sandbox not all');
// Do not write policy, plugin, ownership, auth or cell identity fields.
writeFileSync(join(state, 'os/config.d/90-local.json5'), JSON.stringify({
  models: { providers: { spike: { baseUrl: 'http://127.0.0.1:19101/v1', api: 'openai-completions', apiKey: randomBytes(32).toString('hex'), models: [{ id: 'spike', name: 'Local synthetic model', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 }] } } },
  agents: { defaults: { model: { primary: 'spike/spike' }, skipBootstrap: true } },
}) + '\n', { mode: 0o600 });
