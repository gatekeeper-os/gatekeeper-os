// Inert attachment fixture: no tools, credentials, sessions or external service.
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { createPluginRuntimeStore } from 'openclaw/plugin-sdk/runtime-store';
import { appendFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export default definePluginEntry({
  id: 'spike-vendor-fixture', name: 'S-1 attachment fixture',
  register(api) {
    if (api.registrationMode !== 'full') return;
    const stateDir = process.env.OPENCLAW_STATE_DIR;
    if (process.env.CLAWOS_SPIKE_VM !== '1' || stateDir !== '/home/tester/clawos-spike-state') throw new Error('Isolated VM required');
    const store = createPluginRuntimeStore({ pluginId: api.id, errorMessage: 'Fixture unavailable' });
    let active = false;
    const runtime = { pluginId: api.id, apiVersion: 1, stateDir,
      root: realpathSync(dirname(fileURLToPath(import.meta.url))),
      describe() { if (!active) throw new Error('Fixture stopped'); return 'fixture-ok'; },
    };
    api.registerService({
      id: 'spike-vendor-fixture',
      start() {
        if (store.tryGetRuntime()) throw new Error('Duplicate fixture runtime');
        active = true;
        store.setRuntime(runtime);
      },
      stop() {
        active = false;
        if (store.tryGetRuntime() === runtime) store.clearRuntime();
        let retainedDenied = false;
        try { runtime.describe(); } catch { retainedDenied = true; }
        appendFileSync(join(stateDir, 'os', 'spike-S1.jsonl'), JSON.stringify({q:'j:fixture-stop',data:{cleared:store.tryGetRuntime() === null,retainedDenied}})+'\n', {mode:0o600});
      },
    });
  },
});
