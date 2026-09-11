import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const verdict = existsSync('verdict-compatibility.json') ? read('verdict-compatibility.json') : {
  status: 'failed', reason: 'Upstream resolution failed', scope: 'compatibility-smoke', fullConformance: false,
};
const smoke = existsSync('verdict-smoke.json') ? read('verdict-smoke.json') : undefined;
if (process.env.JOB_STATUS !== 'success') verdict.status = 'failed';
else if (verdict.supported) verdict.status = smoke?.ok === true ? 'passed' : 'failed';
if (smoke) verdict.smoke = smoke;
writeFileSync('verdict-compatibility.json', JSON.stringify(verdict, null, 2) + '\n');
appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  `### ${verdict.tag ?? 'unresolved'}: ${verdict.status}\n\n` +
  `Upstream: ${verdict.version ?? 'unresolved'}; declared range: ${verdict.range ?? 'unknown'}.\n\n` +
  (verdict.status === 'unsupported' ? 'Not compatible with the declared range; live tests were NOT run.\n\n' : '') +
  'Scope: plugin metadata, live kernel/filesystem startup, health and read-only operator RPCs. ' +
  '**Not full scenario conformance or Phase 7 update/rollback acceptance.**\n');
if (verdict.status === 'failed') process.exitCode = 1;
