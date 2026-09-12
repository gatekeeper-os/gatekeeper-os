/** Cell-scoped operator RPC. The installed SDK runs out-of-process, never in the development host CLI process. */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveCellFromRegistry, type Cell } from './cell.js';
import { run, StepError } from './proc.js';
import { committedRuntime } from './runtime.js';

/** Send structured parameters through stdin; select destination exclusively from the chosen cell. */
export function kernelRpc(cellName: string, method: string, params: Record<string, unknown>): unknown {
  return kernelRpcForCell(resolveCellFromRegistry(cellName), method, params);
}

/** Installer health checks use the explicit new cell before its registry entry is committed. */
export function kernelRpcForCell(cell: Cell, method: string, params: Record<string, unknown>, explicitBinary?: string): unknown {
  if (!Number.isInteger(cell.port) || cell.port < 1 || cell.port > 65535) throw new StepError('Invalid cell Gateway port');
  const selected=explicitBinary??committedRuntime(cell);
  const binary = selected?{code:0,stdout:selected}:run('sh', ['-c', 'command -v openclaw']);
  if (binary.code !== 0) throw new StepError('openclaw is not on PATH');
  const base=dirname(fileURLToPath(import.meta.url));
  const helper=[join(base,'bin','gateway-rpc.mjs'),join(base,'..','bin','gateway-rpc.mjs'),join(base,'..','..','bin','gateway-rpc.mjs')].find(existsSync);
  if(!helper)throw new StepError('Installed kernel RPC helper missing');
  const result = spawnSync(process.execPath, [helper, binary.stdout.trim()], {
    env: { ...process.env, ...cell.env }, input: JSON.stringify({ method, params }), encoding: 'utf8',
    timeout: 85000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw new StepError('Kernel RPC unavailable or unauthorized; verify this cell and its device pairing');
  try {
    const reply = JSON.parse(result.stdout);
    if (reply.ok === true && Object.hasOwn(reply, 'result')) return reply.result;
  } catch { /* never expose raw upstream output */ }
  throw new StepError('Kernel RPC returned an invalid response');
}
