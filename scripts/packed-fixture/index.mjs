// Resolved from package-smoke/node_modules: the exact installed kit archive, not workspace sources.
import { defineGatekeeper } from '@gatekeeper-os/gatekeeper-kit/plugin';
import driver from './driver.mjs';
import { pluginId, toolName } from './metadata.mjs';
const fixture = defineGatekeeper(driver);


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
