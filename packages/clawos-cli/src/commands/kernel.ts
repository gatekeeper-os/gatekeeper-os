/** Operator command grammar. No caller-supplied operator identity or arbitrary RPC dispatch. */
import { approvalView } from './approvals-view.js';
import type { GlobalOptions } from '../options.js';
import { kernelRpc } from '../util/kernel-rpc.js';
import { StepError } from '../util/proc.js';

interface Request { method: string; params: Record<string, unknown> }
/** Strict parsing keeps ambiguous, duplicated and unsupported options away from mutating RPCs. */
export function kernelRequest(command: string, args: string[]): Request {
  const [action, ...rest] = args;
  const params: Record<string, unknown> = {};
  const positional: string[] = [];
  const flags = command === 'grant' ? ['--agent', '--title', '--audience'] : command === 'audit' ? ['--limit'] : [];
  for (let i = 0; i < rest.length; i++) {
    const value = rest[i]!;
    if (value.startsWith('--')) {
      const key = value.slice(2);
      if (!flags.includes(value) || Object.hasOwn(params, key) || !rest[i + 1] || rest[i + 1]!.startsWith('--')) throw new StepError('Invalid or duplicate kernel command option');
      params[key] = rest[++i]!;
    } else positional.push(value);
  }
  const exact = (keys: string[], count: number) => {
    if (Object.keys(params).some(k => !keys.includes(k)) || positional.length !== count) throw new StepError('Invalid kernel command arguments');
  };
  if (command === 'grant' && action === 'add') {
    exact(['agent', 'title', 'audience'], 1);
    if (!params.agent || (params.audience && params.audience !== 'owner-only')) throw new StepError('grant add requires --agent and a valid audience');
    try { const url = new URL(positional[0]!); if (url.username || url.password || url.search || url.hash) throw new Error(); }
    catch { throw new StepError('Resource URL must be absolute and contain no credentials, query or fragment'); }
    return { method: 'os.grants.introduce', params: { agentId: params.agent, url: positional[0], ...(params.title ? { title: params.title } : {}), ...(params.audience ? { audience: params.audience } : {}) } };
  }
  if (command === 'grant' && action === 'list') {
    exact(['agent'], 0); return { method: 'os.grants.list', params: params.agent ? { agentId: params.agent } : {} };
  }
  if (command === 'grant' && action === 'revoke') {
    exact([], 1); if (!/^grant:[a-z0-9]{8}$/.test(positional[0]!)) throw new StepError('Invalid grant handle');
    return { method: 'os.grants.revoke', params: { handle: positional[0] } };
  }
  if (command === 'audit' && action === 'tail') {
    exact(['limit'], 0); const limit = Number(params.limit ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new StepError('audit --limit must be 1–1000');
    return { method: 'os.audit.query', params: { limit } };
  }
  if (command === 'approvals' && action === 'preview') { exact([], 1); const ids = positional[0]!; if (ids !== 'all' && (!/^[1-9][0-9]*(?:,[1-9][0-9]*)*$/.test(ids) || ids.split(',').length > 100 || ids.split(',').some(id => !Number.isSafeInteger(Number(id))) || new Set(ids.split(',')).size !== ids.split(',').length)) throw new StepError('Use positive, distinct action IDs or all'); return { method: 'os.approvals.list', params: { includeDecided: true } }; }
  if (command === 'approvals' && action === 'list') { exact([], 0); return { method: 'os.approvals.list', params: {} }; }
  if (command === 'approvals' && ['apply', 'reject', 'revert', 'grant', 'reject-request'].includes(action ?? '')) {
    exact([], 1); const ids = positional[0] === 'all' ? 'all' : positional[0]!.split(',').map(Number);
    if (ids !== 'all' && (!/^[1-9][0-9]*(?:,[1-9][0-9]*)*$/.test(positional[0]!) || ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length)) throw new StepError('Use positive, distinct action IDs or all');
    return { method: action === 'grant' ? 'os.requests.approve' : action === 'reject-request' ? 'os.requests.reject' : `os.approvals.${action}`, params: { ids } };
  }
  if (command === 'gatekeeper' && action === 'connect') { exact([], 1); if (!/^[a-z][a-z0-9_]{0,63}$/.test(positional[0]!)) throw new StepError('Invalid vendor'); return { method: 'os.gatekeepers.connect', params: {vendor: positional[0]} }; }
  if (command === 'gatekeeper' && action === 'list') { exact([], 0); return { method: 'os.gatekeepers.list', params: {} }; }
  if (command === 'kernel' && action === 'maintenance') { exact([],1); if(!['on','off'].includes(positional[0]!)) throw new StepError('kernel maintenance on|off'); return {method:'os.maintenance.set',params:{enabled:positional[0]==='on'}}; }
  if (command === 'kernel' && action === 'status') { exact([], 0); return { method: 'os.status', params: {} }; }
  throw new StepError('usage: clawos grant add|list|revoke; audit tail [--limit 1–1000]; approvals list|apply|reject|revert; gatekeeper list|connect; kernel status');
}

/** Execute one operator command and print only the kernel's credential-free response, never transport diagnostics. */
export async function kernelCommand(command: string, args: string[], globals: GlobalOptions): Promise<number> {
  const request = kernelRequest(command, args);
  let result = kernelRpc(globals.cell, request.method, request.params);
  if (command === 'approvals' && args[0] === 'preview' && args[1] !== 'all') {
    if (!result || typeof result !== 'object' || !('actions' in result) || !Array.isArray(result.actions)) throw new StepError('Invalid approval response');
    const ids = args[1]!.split(',').map(Number);
    const actions = result.actions.filter((row: {id:number}) => ids.includes(row.id));
    if (actions.length !== ids.length) throw new StepError('Requested action is unavailable in this bounded response');
    result = {...result, actions};
  }
  console.log(command === 'approvals' && ['list', 'preview'].includes(args[0] ?? '') && !globals.json ? approvalView(result, args[0] === 'preview') : JSON.stringify(result, null, globals.json ? undefined : 2));
  return 0;
}
