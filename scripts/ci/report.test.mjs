import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./report.mjs', import.meta.url));
for (const [name, supported, job, smoke, expected] of [
  ['supported pass needs live evidence', true, 'success', { ok: true }, 'passed'],
  ['missing evidence fails closed', true, 'success', undefined, 'failed'],
  ['failed live evidence fails closed', true, 'success', { ok: false }, 'failed'],
  ['metadata failure cannot be hidden by a smoke pass', true, 'failure', { ok: true }, 'failed'],
  ['out-of-range is unsupported, not passed', false, 'success', undefined, 'unsupported'],
  ['cancellation is not unsupported success', false, 'cancelled', undefined, 'failed'],
]) {
  test(name, () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawos-ci-report-'));
    try {
      writeFileSync(join(dir, 'verdict-compatibility.json'), JSON.stringify({ supported, status: supported ? 'pending' : 'unsupported' }));
      if (smoke) writeFileSync(join(dir, 'verdict-smoke.json'), JSON.stringify(smoke));
      const result = spawnSync(process.execPath, [script], { cwd: dir,
        env: { ...process.env, JOB_STATUS: job, GITHUB_STEP_SUMMARY: join(dir, 'summary') } });
      assert.equal(result.status, expected === 'failed' ? 1 : 0);
      assert.equal(JSON.parse(readFileSync(join(dir, 'verdict-compatibility.json'))).status, expected);
      assert.match(readFileSync(join(dir, 'summary'), 'utf8'), /Not full scenario conformance/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
