import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each(['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'])('rejects synthetic GitHub credential prefix %s without printing its value', prefix => {
  const dir = mkdtempSync(join(tmpdir(), 'clawos-secrecy-'));
  const token = prefix + 'notreal'.repeat(8);
  try {
    writeFileSync(join(dir, 'log.txt'), token);
    const result = spawnSync('bash', [fileURLToPath(new URL('../../../../scripts/check-secrets.sh', import.meta.url))], { cwd: dir, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('values withheld');
    expect(result.stdout + result.stderr).not.toContain(token);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
