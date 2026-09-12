import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAudit } from './blueprint-audit-gate.mjs';
const messaging = { policy: 'messaging', exitCode: 0, bind: 'loopback', messagingExecDenied: true };
const runtime = { policy: 'runtime', exitCode: 0, bind: 'loopback', defaultSandboxAll: true, allAgentsSandboxAll: true };
function report(...codes) { return { summary: { critical: 0, warn: codes.length }, findings: codes.map(checkId => ({ checkId, severity: 'warn' })), deep: { gateway: { attempted: true, ok: true } } }; }
test('accepted warnings are scoped to cell type and verified predicates', () => {
  assert.equal(evaluateAudit(report('gateway.trusted_proxies_missing', 'tools.exec.host_sandbox_no_sandbox_agents'), messaging), true);
  assert.equal(evaluateAudit(report('gateway.trusted_proxies_missing', 'tools.exec.security_full_configured'), runtime), true);
  assert.equal(evaluateAudit(report('tools.exec.host_sandbox_no_sandbox_agents'), runtime), false);
  assert.equal(evaluateAudit(report('tools.exec.security_full_configured'), messaging), false);
  for (const key of ['defaultSandboxAll', 'allAgentsSandboxAll']) assert.equal(evaluateAudit(report('tools.exec.security_full_configured'), { ...runtime, [key]: false }), false);
  assert.equal(evaluateAudit(report('gateway.trusted_proxies_missing'), { ...messaging, bind: 'lan' }), false);
  assert.equal(evaluateAudit(report('tools.exec.host_sandbox_no_sandbox_agents'), { ...messaging, messagingExecDenied: false }), false);
});
test('unknown codes, suffixes, criticals, suppressions and probe failures never pass', () => {
  for (const code of ['gateway.probe_failed', 'gateway.trusted_proxies_missing.extra', 'unexpected']) assert.equal(evaluateAudit(report(code), messaging), false);
  const critical = report('tools.exec.security_full_configured'); critical.findings[0].severity = 'critical'; critical.summary = { critical: 1, warn: 0 };
  assert.equal(evaluateAudit(critical, runtime), false);
  const failed = report(); failed.deep.gateway.ok = false; assert.equal(evaluateAudit(failed, messaging), false);
  const suppressed = report(); suppressed.suppressedFindings = [{ checkId: 'unexpected', severity: 'warn' }]; assert.equal(evaluateAudit(suppressed, messaging), false);
  assert.equal(evaluateAudit(undefined, messaging), false);
  assert.equal(evaluateAudit(report(), { ...messaging, exitCode: 1 }), false);
});
