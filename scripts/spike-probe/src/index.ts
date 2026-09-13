// Throwaway runtime probe. Records only names, presence flags, counts and local outcomes.
import { definePluginEntry, type OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import { createPluginRuntimeStore } from 'openclaw/plugin-sdk/runtime-store';
import { getGlobalHookRunner } from 'openclaw/plugin-sdk/plugin-runtime';
import { Type } from 'typebox';
import { inspectAttachment } from './discovery.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, isAbsolute } from 'node:path';

export default definePluginEntry({
  id: 'spike-probe', name: 'Spike Probe', description: 'Empirical S-1 compatibility checks.',
  register(api: OpenClawPluginApi) {
    if (!['full', 'discovery', 'tool-discovery'].includes(api.registrationMode)) return;
    const state = process.env.OPENCLAW_STATE_DIR;
    if (process.env.GKOS_SPIKE_VM !== '1' || !state || !isAbsolute(state))
      throw new Error('Probe requires an explicitly isolated test VM state directory');
    const out = join(state, 'os');
    const records: Array<{ q: string; data: unknown }> = [];
    const rec = (q: string, data: unknown) => {
      mkdirSync(out, { recursive: true, mode: 0o700 });
      const entry = { q, data };
      records.push(entry);
      appendFileSync(join(out, 'spike-S1.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 });
    };
    const hookState = () => {
      const runner = getGlobalHookRunner();
      return { pid: process.pid, mode: api.registrationMode, runnerPresent: Boolean(runner),
        counts: Object.fromEntries((['before_prompt_build', 'before_tool_call', 'llm_input', 'gateway_start'] as const)
          .map(name => [name, runner?.getHookCount(name) ?? 0])) };
    };
    // Discovery declares inert capabilities; filesystem writes start only in callbacks.
    if (api.registrationMode === 'full') {
      rec('j:api-keys', Object.keys(api));
      rec('j:runtime-keys', Object.keys(api.runtime));
    }
    let calls = 0;
    const callStore = createPluginRuntimeStore<{ state: string; seen: Set<string> }>({
      pluginId: 'spike-probe', errorMessage: 'Probe runtime not initialized',
    });
    if (api.registrationMode === 'full' && !callStore.tryGetRuntime())
      callStore.setRuntime({ state, seen: new Set() });
    const sharedCalls = () => {
      const runtime = callStore.getRuntime();
      if (runtime.state !== state) throw new Error('Probe runtime state mismatch');
      return runtime.seen;
    };
    const tool = (name: string) => ({
      name, label: name, description: 'Return a fixed test result.', parameters: Type.Object({}),
      execute: async (toolCallId: string) => {
        rec('diagnostic:execute-hooks', hookState());
        const correlated = sharedCalls().delete(toolCallId);
        rec('f:execute', { name, hasToolCallId: Boolean(toolCallId), correlated });
        if (!correlated) throw new Error('Probe call identity missing');
        calls++;
        return { content: [{ type: 'text' as const, text: 'probe-ok' }], details: { ok: true } };
      },
    });
    for (const name of ['probe_echo', 'gk_a_b_c', 'n'.repeat(64), 'n'.repeat(65), 'probe.dotted']) {
      try { api.registerTool(tool(name)); if (api.registrationMode === 'full') rec('c:register', { name, length: name.length, accepted: true }); }
      catch { if (api.registrationMode === 'full') rec('c:register', { name, length: name.length, accepted: false }); }
    }
    api.on('before_prompt_build', (_event, ctx) => {
      rec('diagnostic:prompt-hook', hookState());
      return { toolsAllow: ctx.agentId === 'naming' ? ['gk_a_b_c', 'n'.repeat(64)] : ['probe_echo', 'probe_late'] };
    });
    api.on('before_tool_call', (event, ctx) => {
      if (event.toolCallId && ctx.agentId && ctx.sessionKey) sharedCalls().add(event.toolCallId);
      rec('f:before_tool_call', { tool: event.toolName, hasToolCallId: Boolean(event.toolCallId),
        hasAgentId: Boolean(ctx.agentId), hasSessionKey: Boolean(ctx.sessionKey),
        eventKeys: Object.keys(event), contextKeys: Object.keys(ctx) });
      return event.toolCallId && ctx.agentId && ctx.sessionKey ? {} : { block: true, blockReason: 'Probe call identity missing' };
    }, { matcher: ['probe_echo', 'probe_late'] });
    api.on('llm_input', event => {
      const names = event.tools?.map(item => {
        if (!item || typeof item !== 'object') return null;
        const value = item as { name?: string; function?: { name?: string } };
        return value.name ?? value.function?.name ?? null;
      });
      rec('e:llm_input', { hasTools: Array.isArray(event.tools), names });
    });
    if (api.registrationMode !== 'full') return;
    api.on('gateway_start', () => {
      rec('diagnostic:startup-hooks', hookState());
      try { api.registerTool(tool('probe_late')); rec('i:late-register', { accepted: true }); }
      catch { rec('i:late-register', { accepted: false }); }
      try {
        const { DatabaseSync } = createRequire(join(state, 'probe.cjs'))('node:sqlite') as typeof import('node:sqlite');
        const db = new DatabaseSync(join(out, 'probe.sqlite'));
        db.exec('CREATE TABLE IF NOT EXISTS probe(x INTEGER); INSERT INTO probe VALUES(1)');
        rec('h:sqlite', { ok: db.prepare('SELECT count(*) AS n FROM probe').get()?.n === 1 });
        db.close();
      } catch { rec('h:sqlite', { ok: false }); }
    });
    api.registerGatewayMethod('os-spike.discovery', ({ respond }) => {
      const enabled = api.config.plugins?.entries?.['spike-vendor-fixture']?.enabled === true;
      respond(true, inspectAttachment(state, enabled));
    }, { profileAccess: 'independent' });
    api.registerGatewayMethod('os-spike.report', ({ client, respond }) => {
      rec('diagnostic:rpc-hooks', hookState());
      rec('g:gateway-client', { present: Boolean(client), keys: Object.keys(client ?? {}),
        hasPairedClientId: Boolean(client?.pairedClientId), hasAuthenticatedUserId: Boolean(client?.authenticatedUserId),
        role: client?.connect?.role, scopes: client?.connect?.scopes,
        hasDevice: Boolean(client?.connect?.device), hasDeviceId: Boolean(client?.connect?.device?.id),
        isDeviceTokenAuth: client?.isDeviceTokenAuth === true });
      respond(true, { records, calls });
    }, { profileAccess: 'independent' });
  },
});
