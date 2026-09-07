// Disable only the fixture in the disposable VM; preserve all other config.
import { readFileSync, writeFileSync } from 'node:fs';
if (process.env.CLAWOS_SPIKE_VM !== '1' || process.env.OPENCLAW_CONFIG_PATH !== '/home/tester/clawos-spike-state/openclaw.json') throw new Error('Isolated VM required');
const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
config.plugins.entries['spike-vendor-fixture'].enabled = false;
writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(config,null,2)+'\n', {mode:0o600});
