// Resolved from package-smoke/node_modules: the exact installed kit archive, not workspace sources.
import { defineGatekeeper } from '@gatekeeper-os/gatekeeper-kit';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginId, resources, resourceUrl, tools, toolName } from './metadata.mjs';
const description = () => ({ title: 'Synthetic record', description: 'Record one CI decision.', implementsRevert: false, autoApprovable: false, preview: { fixture: true } });
const fixture = defineGatekeeper({
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


// Test-only fault injection. No product plugin gets this RPC. The registered tool
// still comes from the real packed kit; the unsafe execute copy tests the host
// backstop independently of the kit's delegation and kernel execution checks.
export default { ...fixture, register(api) {
  fixture.register(api);
  if (api.registrationMode !== 'full') return;
  api.registerGatewayMethod('packed.backstop', async ({ client, respond }) => {
    try {
      if (!client?.isDeviceTokenAuth || !client.connect?.scopes?.includes('operator.admin')) throw new Error();
      const { getPluginRuntimeGatewayRequestScope } = await import('openclaw/plugin-sdk/plugin-runtime');
      const { wrapToolWithBeforeToolCallHook, getBeforeToolCallPolicyDiagnosticState } = await import('openclaw/plugin-sdk/agent-harness-runtime');
      const registry = getPluginRuntimeGatewayRequestScope()?.pluginRegistry;
      const registrations = registry?.tools.filter(entry => entry.names.includes(toolName)) ?? [];
      if (registrations.length !== 1 || registrations[0].pluginId !== pluginId) throw new Error();
      const ctx = { agentId:'main', sessionKey:'agent:main:packed-backstop', config:api.config };
      const tool = await registrations[0].factory({ ...ctx, sandboxed:false });
      if (!tool || Array.isArray(tool) || tool.name !== toolName) throw new Error();
      const policies = getBeforeToolCallPolicyDiagnosticState().trustedToolPolicies;
      if (!policies.some(p => p.pluginId === 'gkos-kernel' && p.id === 'gkos-capability-policy')) throw new Error();
      const normal = await wrapToolWithBeforeToolCallHook(tool, ctx, {emitDiagnostics:false}).execute('packed-backstop-normal', {});
      let executions = 0;
      const unsafe = { ...tool, execute:async () => {
        executions++; return {content:[{type:'text',text:'Synthetic canary executed.'}]};
      } };
      await unsafe.execute(); // positive control: the bypass is executable without the host boundary
      const controlExecutions = executions; executions = 0;
      const bypassed = await wrapToolWithBeforeToolCallHook(unsafe, ctx, {emitDiagnostics:false}).execute('packed-backstop-bypassed', {});
      const denied = result => result.details?.status === 'blocked' && result.details?.reason === 'No such grant.';
      respond(true, {registeredBy:registrations[0].pluginId, policies,
        normalDenied:denied(normal), bypassDenied:denied(bypassed), controlExecutions, unsafeExecutions:executions});
    } catch { respond(false, undefined, {code:'BACKSTOP_FAILED',message:'Packed backstop assertion failed.'}); }
  });
} };
