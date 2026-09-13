/** Cell policy is a global ceiling, not an agent-level permission escalation. */
import type { Json } from './json5.js';
import { getPath } from './merge.js';
import { StepError } from './proc.js';
export type CellPolicy = 'messaging' | 'runtime';
/** Reject typos before installation side effects. */
export function parseCellPolicy(value: string): CellPolicy {
  if (value !== 'messaging' && value !== 'runtime') throw new StepError('--policy must be messaging or runtime');
  return value;
}
/** Select an inseparable policy fragment set; the default is byte-identical messaging behavior. */
export function policyFragments(names: string[], policy: CellPolicy): string[] {
  return names.filter(name => policy === 'runtime' ? name !== '20-sandbox.json5' : name !== '05-policy-runtime.json5');
}
/** Conservative supported-profile recognition, using upstream config values, never local fragments. */
export function runtimeCell(config: Json): boolean {
  const allow = getPath(config, 'tools.allow'), deny = getPath(config, 'tools.deny');
  if (!Array.isArray(allow) || !Array.isArray(deny)) return false;
  return getPath(config, 'agents.defaults.sandbox.mode') === 'all'
    && getPath(config, 'tools.exec.host') === 'sandbox'
    && ['allowlist', 'ask', 'auto', 'full'].includes(String(getPath(config, 'tools.exec.mode')))
    && allow.includes('exec') && allow.includes('group:fs')
    && !deny.some(x => typeof x === 'string' && ['*', 'exec', 'bash', 'group:runtime', 'group:fs', 'read', 'write', 'edit', 'apply_patch'].includes(x));
}
/** Refuse separation of runtime authority from its all-turn sandbox, even by a later local fragment. */
export function assertRuntimeSandbox(config: Json): void {
  if (getPath(config, 'agents.defaults.sandbox.mode') !== 'all') {
    throw new StepError('05-policy-runtime requires agents.defaults.sandbox.mode all; nothing applied');
  }
  const entries = getPath(config, 'agents.entries');
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    for (const entry of Object.values(entries)) {
      const mode = getPath(entry, 'sandbox.mode');
      const deny = getPath(entry, 'tools.deny');
      const denied = getPath(entry, 'tools.exec.mode') === 'deny' && Array.isArray(deny) && deny.includes('group:fs');
      if (mode !== undefined && mode !== 'all' && !denied) {
        throw new StepError('runtime cell agent overriding sandbox.mode all must deny exec and filesystem tools; nothing applied');
      }
    }
  }
}
