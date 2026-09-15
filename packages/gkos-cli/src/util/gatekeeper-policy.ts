/** Catalog-derived admission only; kernel grant narrowing remains a separate mandatory ceiling. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Json } from './json5.js';
import { getPath } from './merge.js';
import { StepError } from './proc.js';
const object = (x: Json | undefined): x is Record<string, Json> => !!x && typeof x === 'object' && !Array.isArray(x);
const ID = /^gkos-gatekeeper-[a-z][a-z0-9_]*$/;
/** Derive fresh from source fragments, never append to yesterday's generated policy. Runtime/explicit allows stay untouched. */
export function reconcileGatekeeperPolicy(config: Json, catalogPath: string): Json {
  const out = structuredClone(config);
  if (!object(out) || getPath(out, 'tools.profile') !== 'messaging' || getPath(out, 'tools.allow') !== undefined) return out;
  const ids: string[] = [];
  if (existsSync(catalogPath)) {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    if (catalog.version !== 1 || !Array.isArray(catalog.gatekeepers)) throw new StepError('Invalid gatekeeper catalog');
    const seen = new Set<string>();
    for (const entry of catalog.gatekeepers) {
      if (typeof entry.pluginId !== 'string' || !ID.test(entry.pluginId) || entry.pluginId !== `gkos-gatekeeper-${entry.vendor}` || seen.has(entry.pluginId)) throw new StepError('Invalid gatekeeper catalog identity');
      seen.add(entry.pluginId);
      if (entry.enabled === false) continue;
      if (typeof entry.root !== 'string' || !Array.isArray(entry.tools)) throw new StepError('Invalid gatekeeper catalog metadata');
      const manifest = JSON.parse(readFileSync(join(entry.root, 'openclaw.plugin.json'), 'utf8'));
      const names = entry.tools.map((tool: { name: string }) => tool.name), declared = manifest.contracts?.tools;
      if (manifest.id !== entry.pluginId || !Array.isArray(declared) || declared.length !== names.length || new Set(declared).size !== declared.length || new Set(names).size !== names.length ||
          names.some((name: unknown) => typeof name !== 'string' || !name.startsWith(`gk_${entry.vendor}_`) || !declared.includes(name))) throw new StepError('Gatekeeper manifest id/contracts.tools mismatch');
      if (getPath(out, `plugins.entries.${entry.pluginId}.enabled`) === false ||
          (getPath(out, 'plugins.deny') as Json[] | undefined)?.includes(entry.pluginId)) continue;
      ids.push(entry.pluginId);
    }
  }
  const admit = (tools: Json | undefined) => {
    if (!object(tools) || tools.profile !== 'messaging' || tools.allow !== undefined) return;
    const prior = tools.alsoAllow ?? [];
    if (!Array.isArray(prior) || prior.some(id => typeof id !== 'string')) throw new StepError('Invalid messaging alsoAllow');
    // Gatekeeper ids are catalog-owned; preserve unrelated explicit additions and every denial.
    tools.alsoAllow = [...new Set([...prior.filter(id => !ID.test(String(id))), ...ids])];
  };
  admit(out.tools);
  const entries = getPath(out, 'agents.entries');
  if (object(entries)) for (const agent of Object.values(entries)) if (object(agent)) admit(agent.tools);
  return out;
}
