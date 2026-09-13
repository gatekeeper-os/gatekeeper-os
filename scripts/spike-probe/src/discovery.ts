// S-1 only: catalog-selected metadata plus a live slot, never an upstream registry mutation.
import { createPluginRuntimeStore } from 'openclaw/plugin-sdk/runtime-store';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
interface FixtureRuntime {
  pluginId: string; apiVersion: number; stateDir: string; root: string;
  describe(): string;
}
/** Probe the supported runtime-store fallback between two independent plugin entries. */
export function inspectAttachment(state: string, enabled: boolean) {
  const catalog = JSON.parse(readFileSync(join(state, 'os', 'probe-catalog.json'), 'utf8'));
  const root = realpathSync(catalog.root);
  const manifest = JSON.parse(readFileSync(join(root, 'openclaw.plugin.json'), 'utf8'));
  const manifestMatched = manifest.id === catalog.id && manifest.gkos?.gatekeeper?.vendor === catalog.vendor &&
    manifest.gkos?.gatekeeper?.apiVersion === catalog.apiVersion;
  const slot = createPluginRuntimeStore<FixtureRuntime>({ pluginId: catalog.id, errorMessage: 'Fixture unavailable' });
  const runtime = slot.tryGetRuntime();
  const resolve = (expectedState: string) => {
    if (!enabled || !manifestMatched || !runtime || runtime.pluginId !== catalog.id || runtime.apiVersion !== catalog.apiVersion ||
      runtime.stateDir !== expectedState || realpathSync(runtime.root) !== root) throw new Error('Fixture unavailable');
    return runtime.describe();
  };
  let attached = false;
  try { attached = resolve(state) === 'fixture-ok'; } catch { /* only booleans leave the probe */ }
  let wrongCellDenied = false;
  try { resolve(state + '-other'); } catch { wrongCellDenied = true; }
  return { manifestMatched, loaded: Boolean(runtime), attached, wrongCellDenied, disabledDenied: !enabled && !attached && runtime === null };
}
