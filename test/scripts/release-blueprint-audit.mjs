// Audit each actual cell and its own authenticated Gateway, not a projected identity.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluateAudit } from './blueprint-audit-gate.mjs';
const policy = process.env.GKOS_BLUEPRINT_POLICY;
const state = `/home/tester/.openclaw-blueprint-${policy}`;
if (!['runtime', 'messaging'].includes(policy) || process.env.OPENCLAW_STATE_DIR !== state || process.cwd() !== '/home/tester/src') throw new Error('Disposable blueprint VM required');
function configGet(path) {
  const result = spawnSync('openclaw', ['config', 'get', path, '--json'], { env: process.env, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Upstream config inspection failed');
  try { return JSON.parse(result.stdout); } catch { throw new Error('Upstream config inspection invalid'); }
}
// Public, redacted config surface read in this same run establishes exception predicates.
const agents = configGet('agents'), tools = configGet('tools'), gateway = configGet('gateway');
const token = readFileSync(`${state}/.env`, 'utf8').split('\n').find(line => line.startsWith('GKOS_GATEWAY_TOKEN='))?.slice('GKOS_GATEWAY_TOKEN='.length);
if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Cell token unavailable');
// Resolve the existing gateway.auth.token SecretRef through its canonical env
// provider. OPENCLAW_GATEWAY_TOKEN would introduce a competing credential source.
const auditEnv = { ...process.env, GKOS_GATEWAY_TOKEN: token };
delete auditEnv.OPENCLAW_GATEWAY_TOKEN;
const run = spawnSync('openclaw', ['security', 'audit', '--deep', '--json'], {
  env: auditEnv,
  encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
});
let report; try { report = JSON.parse(run.stdout); } catch {}
const entries = Array.isArray(agents.entries) ? agents.entries : Object.values(agents.entries ?? {});
const context = {
  policy, exitCode: run.status, bind: gateway.bind,
  defaultSandboxAll: agents.defaults?.sandbox?.mode === 'all',
  allAgentsSandboxAll: entries.every(entry => (entry.sandbox?.mode ?? agents.defaults?.sandbox?.mode) === 'all'),
  messagingExecDenied: tools.exec?.mode === 'deny' && tools.deny?.includes('group:runtime') && tools.deny?.includes('group:fs'),
};
const passed = evaluateAudit(report, context);
const findings = Array.isArray(report?.findings) ? report.findings.map(row => ({
  id: typeof row.checkId === 'string' && /^[a-zA-Z0-9_.-]+$/.test(row.checkId) ? row.checkId : 'unrecognized',
  severity: ['critical', 'warn', 'info'].includes(row.severity) ? row.severity : 'unknown',
})) : [];
writeFileSync(`/home/tester/phase-6-evidence/release-audits-${policy}.json`, JSON.stringify({
  passed, ...context, parsedReport: Boolean(report), findings,
  deepProbeAttempted: report?.deep?.gateway?.attempted === true,
  deepProbeAuthenticated: report?.deep?.gateway?.ok === true,
  configuration: 'actual applied cell, same-state token-authenticated Gateway', fullPhaseAcceptance: false,
}, null, 2) + '\n', { mode: 0o600 });
console.log(`${passed ? 'PASS' : 'FAIL'} deep-audit-${policy}`);
if (!passed) process.exitCode = 1;
