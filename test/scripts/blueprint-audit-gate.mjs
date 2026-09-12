// Exact-code release policy. Never suppress upstream findings in configuration.
export function evaluateAudit(report, context) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const runtimeSafe = context.policy === 'runtime' && context.defaultSandboxAll === true && context.allAgentsSandboxAll === true;
  const accepted = finding => finding.severity === 'info' || (finding.severity === 'warn' && (
    (finding.checkId === 'gateway.trusted_proxies_missing' && context.bind === 'loopback') ||
    (finding.checkId === 'tools.exec.host_sandbox_no_sandbox_agents' && context.policy === 'messaging' && context.messagingExecDenied === true) ||
    (finding.checkId === 'tools.exec.security_full_configured' && runtimeSafe)
  ));
  return context.exitCode === 0 && report?.summary?.critical === 0 &&
    Number.isInteger(report?.summary?.warn) && report.summary.warn === findings.filter(row => row.severity === 'warn').length &&
    report?.deep?.gateway?.attempted === true && report.deep.gateway.ok === true &&
    (!report.suppressedFindings || (Array.isArray(report.suppressedFindings) && report.suppressedFindings.length === 0)) &&
    Array.isArray(report?.findings) && findings.every(accepted) &&
    (context.policy === 'messaging' ? context.messagingExecDenied === true : runtimeSafe);
}
