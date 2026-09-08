// Passive evidence only: no tools, policy decisions, identity injection or kernel calls.
import { appendFileSync } from 'node:fs';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
export default definePluginEntry({ id: 'clawos-kernel-monitor', name: 'Kernel monitor', register(api) {
  if (process.env.CLAWOS_KERNEL_VM !== '1' || process.env.OPENCLAW_STATE_DIR !== '/home/tester/clawos-kernel-state') throw new Error('VM required');
  if (!['full', 'discovery', 'tool-discovery'].includes(api.registrationMode)) return;
  const record = (hook, e, ctx) => appendFileSync('/home/tester/clawos-kernel-state/os/hooks.jsonl', JSON.stringify({hook,
    agentId:ctx.agentId, sessionKey:ctx.sessionKey, runId:ctx.runId,
    tool:e.toolName, callId:e.toolCallId, senderIsOwner:e.senderIsOwner, error:typeof e.error === 'string' && e.error.length > 0,
  })+'\n', {mode:0o600});
  for (const name of ['before_agent_run','before_prompt_build','before_tool_call','after_tool_call','agent_end'])
    api.on(name, (e,ctx) => { record(name,e,ctx); }, {priority:-1000});
} });
