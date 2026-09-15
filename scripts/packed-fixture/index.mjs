// Resolved from package-smoke/node_modules: the exact installed kit archive, not workspace sources.
import { defineGatekeeper } from '@gatekeeper-os/gatekeeper-kit';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginId, resources, resourceUrl, tools, toolName } from './metadata.mjs';
const description = () => ({ title: 'Synthetic record', description: 'Record one CI decision.', implementsRevert: false, autoApprovable: false, preview: { fixture: true } });
export default defineGatekeeper({
  id: pluginId, vendor: 'fixture', apiVersion: 1, name: 'Packed fixture', description: 'Synthetic packed gatekeeper',
  tools, resources, actions: { [toolName]: { describe: description } },
  createVendor({ stateDir }) {
    let serial = 0;
    const record = (kind, id) => appendFileSync(join(stateDir, 'packed-fixture-effects.jsonl'), JSON.stringify({ kind, id }) + '\n', { mode: 0o600 });
    const gatekeeper = {
      applyAction: async id => record('apply', id), rejectAction: async id => record('reject', id),
      startSession: async () => ({
        call: async (_tool, _params, ctx) => {
          if (ctx.dryRun) return { kind: 'action', description: description() };
          const id = ++serial;
          await ctx.queue.submitAction(id, description()); record('submit', id);
          return { content: [{ type: 'text', text: 'Fixture recorded.' }] };
        }, close: async () => {},
      }),
    };
    const account = { getGatekeeperFor: async key => {
      if (key !== resourceUrl) throw new Error('Unknown fixture');
      return { resource: resources[0], resourceKey: key, gatekeeper };
    } };
    return { vendor: 'fixture', apiVersion: 1, getAccount: async () => account, createAccount: async () => account };
  },
});
