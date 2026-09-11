// Scan actual log sinks after both Gateways stop; emit only structural verdicts.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const state = '/home/tester/.openclaw-kernel-test';
if (process.env.CLAWOS_KERNEL_VM !== '1' || process.env.CLAWOS_TEST_MODE !== 'gateway-integration' ||
    process.env.OPENCLAW_STATE_DIR !== state || process.env.OPENCLAW_CONFIG_PATH !== state + '/openclaw.json' ||
    process.cwd() !== '/home/tester/src') throw new Error('VM required');
const reportPath = process.env.CLAWOS_SCENARIO_REPORT;
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
if (report.runId !== process.env.CLAWOS_SCENARIO_RUN || report.realProvider !== false) throw new Error('Current fixture report required');
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []); }
try {
  const required = ['/home/tester/github-gateway.log', '/home/tester/github-native-gateway.log',
    join(state, 'logs/github-deferred.jsonl'), join(state, 'logs/github-native.jsonl')];
  const paths = [...new Set([...required, ...files(join(state, 'logs')), ...files(join(state, 'os/audit'))])];
  const markers = ['phase-four-first-comment', 'phase-four-rejected-comment', 'phase-four-private-failure',
    'private-tail-marker', 'phase-four-private-provider-response', 'offline-app-secret-marker',
    'offline-access-token-marker', 'fixture-short-code'];
  report.checks['log-sinks-exist-and-nonempty'] = required.every(path => statSync(path).size > 0);
  const contents = paths.map(path => readFileSync(path));
  const absent = values => contents.every(bytes => values.every(value => !bytes.includes(Buffer.from(value))));
  report.checks['log-sinks-no-fixture-bodies-or-secrets'] = absent(markers);
  report.checks['provider-failure-log-secrecy'] = absent(markers.slice(2, 5));
  report.checks['native-denial-log-secrecy'] = absent([markers[1]]);
  report.checks['log-sinks-no-fixture-credentials'] = absent(markers.slice(5));
  report.logging = { filesScanned: paths.length, postShutdown: true, providerFailure: true,
    nativeApprovalRouteFailureCovered: false };
  if (Object.values(report.checks).some(value => value !== true)) throw new Error('check-failed');
  console.log('PASS log-sinks-exist-and-nonempty');
  console.log('PASS log-sinks-no-fixture-bodies-or-secrets');
} catch {
  report.failure = 'log-secrecy-check-failed';
  console.log('FAIL log-secrecy-check-failed');
  process.exitCode = 1;
} finally {
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
