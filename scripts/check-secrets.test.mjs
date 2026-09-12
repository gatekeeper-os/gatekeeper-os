import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
test('secret gate distinguishes clean, detected, and incomplete scans without printing values', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawkeeper-secret-gate-'));
  const scan = () => spawnSync('bash', [fileURLToPath(new URL('./check-secrets.sh', import.meta.url))], { cwd: root, encoding: 'utf8' });
  const blocked = join(root, 'unreadable');
  try {
    writeFileSync(join(root, 'plain.txt'), 'ordinary content'); assert.equal(scan().status, 0);
    const marker = ['gh', 'p_', 'a'.repeat(24)].join('');
    writeFileSync(join(root, 'fixture.txt'), marker);
    const found = scan(); assert.equal(found.status, 1); assert.ok(!found.stdout.includes(marker));
    rmSync(join(root, 'fixture.txt')); mkdirSync(blocked, { mode: 0 });
    if (process.getuid?.() !== 0) { const incomplete = scan(); assert.notEqual(incomplete.status, 0); assert.match(incomplete.stderr, /scan incomplete/); }
  } finally { chmodSync(blocked, 0o700); rmSync(root, { recursive: true, force: true }); }
});
