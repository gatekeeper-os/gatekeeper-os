// Actual Gateway console, file/rotated and kernel audit sinks, after shutdown.
// Neither account journals nor model session history are diagnostic logs.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { absentFromLogs } from './github-real-evidence.mjs';
const state = '/home/tester/.openclaw-kernel-test';
if (process.env.CLAWOS_KERNEL_VM !== '1' || process.env.CLAWOS_TEST_MODE !== 'full' || process.cwd() !== '/home/tester/src' ||
    process.env.OPENCLAW_STATE_DIR !== state || process.env.OPENCLAW_CONFIG_PATH !== state + '/openclaw.json') throw new Error('VM required');
const reportPath = process.env.CLAWOS_SCENARIO_REPORT;
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
if (report.runId !== process.env.CLAWOS_SCENARIO_RUN || report.realProvider !== true || report.mode !== 'full' || report.provider !== 'github.com') throw new Error('Current real report required');
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []); }
try {
  const markers = JSON.parse(readFileSync('/run/user/1000/clawos-phase4-canaries.json', 'utf8'));
  const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
  const required = ['/home/tester/github-real-deferred-gateway.log', '/home/tester/github-real-native-gateway.log',
    join(state, 'logs/github-real-deferred.jsonl'), join(state, 'logs/github-real-native.jsonl')];
  const audit = files(join(state, 'os/audit'));
  const paths = [...new Set([...required, ...files(join(state, 'logs')), ...audit])];
  report.checks['log-sinks-exist-and-nonempty'] = required.every(path => statSync(path).size > 0) && audit.some(path => statSync(path).size > 0);
  const contents = paths.map(path => readFileSync(path, 'utf8'));
  const absent = values => absentFromLogs(contents, values);
  const knownSecrets = [process.env.CLAWOS_TEST_APP_SECRET, process.env.CLAWOS_TEST_OBSERVER_TOKEN,
    config.gateway.auth.token, config.models.providers.spike.apiKey].filter(Boolean);
  const credentialsClean = absent(knownSecrets) && contents.every(bytes => !/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(bytes));
  report.checks['native-denial-log-secrecy'] = report.nativeDenial === true && absent([markers.denied]);
  report.checks['approval-route-failure-log-secrecy'] = report.nativeApprovalRouteFailure === true && absent([markers.route]);
  report.checks['failed-tool-log-secrecy'] = report.failedToolExecuted === true && report.providerFailureProvenance === true && absent([markers.failure]);
  report.checks['failed-tool-request-log-clean'] = report.failedToolExecuted === true && absent([markers.failure]);
  report.checks['log-credentials-clean'] = credentialsClean;
  report.checks['secret-scan-clean'] = credentialsClean && absent(Object.values(markers));
  report.logging = { filesScanned: paths.length, auditFilesScanned: audit.length, postShutdown: true,
    providerFailureProvenance: report.providerFailureProvenance === true };
  const requiredChecks = ['account-connected', 'grant-introduced', 'action-pending', 'pending-overlay-visible',
    'remote-unchanged-before-approval', 'apply-remote-confirmed', 'reject-overlay-removed', 'reject-remote-unchanged',
    'revert-remote-confirmed', 'audit-complete', 'secret-scan-clean', 'failed-tool-log-secrecy',
    'await-decision-requested', 'unauthorized-decision-denied', 'operator-approval-resumes', 'resolved-once',
    'approval-route-failure-log-secrecy', 'native-denial-log-secrecy'];
  report.checks['full-required-evidence-present'] = requiredChecks.every(key => report.checks[key] === true);
  if (report.failure || Object.values(report.checks).some(value => value !== true)) throw new Error('incomplete');
  report.fullPhaseAcceptance = true;
  console.log('PASS real-provider-log-secrecy-and-required-evidence');
} catch {
  report.fullPhaseAcceptance = false;
  report.failure ??= 'real-provider-evidence-incomplete';
  console.log('FAIL real-provider-evidence-incomplete');
  process.exitCode = 1;
} finally {
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  writeFileSync('/home/tester/phase-4-evidence/scope.json', JSON.stringify({ mode: 'full', provider: 'github.com', realProvider: true,
    status: report.fullPhaseAcceptance === true ? 'passed' : 'failed', fullPhaseAcceptance: report.fullPhaseAcceptance === true }) + '\n', { mode: 0o600 });
}
