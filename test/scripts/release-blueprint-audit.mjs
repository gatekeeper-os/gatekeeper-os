// VM-only audit of each applied blueprint's configuration; retain structural findings only.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
if (process.env.OPENCLAW_STATE_DIR !== '/home/tester/.openclaw-blueprint-test' || process.cwd() !== '/home/tester/src') throw new Error('Disposable blueprint VM required');
const original = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
const results = [];
for (const role of ['assistant', 'coder', 'ops', 'researcher']) {
  const id = `bp-${role}`, entry = original.agents.entries[id];
  if (!entry) throw new Error('Applied blueprint missing');
  const state = `/home/tester/.openclaw-blueprint-audit-${role}`, configPath = join(state, 'openclaw.json');
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const config = structuredClone(original);
  config.agents.entries = { [id]: { ...entry, default: true } };
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const run = spawnSync('openclaw', ['security', 'audit', '--deep', '--json'], {
    env: { ...process.env, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath },
    encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  let report; try { report = JSON.parse(run.stdout); } catch {}
  const findings = Array.isArray(report?.findings) ? report.findings.map(row => ({
    id: typeof row.checkId === 'string' && /^[a-zA-Z0-9_.-]+$/.test(row.checkId) ? row.checkId : 'unrecognized',
    severity: ['critical', 'warn', 'info'].includes(row.severity) ? row.severity : 'unknown',
  })) : [];
  const clean = run.status === 0 && report?.summary?.critical === 0 && report?.summary?.warn === 0;
  results.push({ role, clean, exitCode: run.status, findings, configuration: 'one applied blueprint projected per isolated audit config', deepGateway: 'shared disposable Gateway' });
}
writeFileSync('/home/tester/phase-6-evidence/release-audits.json', JSON.stringify({ results, allClean: results.every(row => row.clean), fullPhaseAcceptance: false }, null, 2) + '\n');
for (const result of results) console.log(`${result.clean ? 'PASS' : 'FAIL'} deep-audit-${result.role}`);
if (results.some(row => !row.clean)) process.exitCode = 1;
