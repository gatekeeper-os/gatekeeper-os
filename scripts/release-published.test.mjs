import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { archivePublished } from './release-published.mjs';

const version = '0.1.0-beta.1';
function fixture(registry, name = '@clawkeepers/kernel') {
  const calls = [];
  return { calls, run(command, args) {
    calls.push([command, args]);
    if (command === 'tar') return { status: 0, stdout: JSON.stringify({ name, version }) };
    assert.deepEqual([command, args], ['npm', ['view', `${name}@${version}`, 'version', '--json']]);
    return registry;
  } };
}
test('all five published archives skip without any publication call', () => {
  let skipped = 0;
  for (const name of ['shared', 'gatekeeper-kit', 'kernel', 'gatekeeper-fs', 'cli']) {
    const f = fixture({ status: 0, stdout: JSON.stringify(version) }, `@clawkeepers/${name}`);
    assert.equal(archivePublished(`/tmp/${name}.tgz`, f.run).published, true);
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every(([cmd, args]) => cmd !== 'npm' || args[0] === 'view'));
    skipped++;
  }
  assert.equal(skipped, 5);
});
test('only E404 permits the existing publish step', () => {
  const f = fixture({ status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) });
  assert.equal(archivePublished('/tmp/kernel.tgz', f.run).published, false);
});
test('auth, network, malformed, killed and mismatched responses fail closed', () => {
  for (const response of [
    { status: 1, stdout: JSON.stringify({ error: { code: 'E401' } }) },
    { status: 1, stdout: JSON.stringify({ error: { code: 'EAI_AGAIN' } }) },
    { status: 1, stdout: 'not JSON' },
    { status: null, stdout: JSON.stringify({ error: { code: 'E404' } }) },
    { status: 0, stdout: JSON.stringify('0.2.0') },
    { error: new Error('timeout') },
  ]) assert.throws(() => archivePublished('/tmp/kernel.tgz', fixture(response).run));
});
test('unsafe archive identity is rejected before registry access', () => {
  const f = fixture({}, '--registry=other');
  assert.throws(() => archivePublished('/tmp/kernel.tgz', f.run));
  assert.equal(f.calls.length, 1);
});
test('workflow keeps publish flags and checks every archive inside the loop', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /while IFS= read -r archive; do\n\s+if node scripts\/release-published\.mjs "\$archive"; then\n\s+continue/);
  assert.match(workflow, /test "\$lookup_status" -eq 1 \|\| exit "\$lookup_status"/);
  assert.match(workflow, /npm publish "\$archive" --access public --tag "\$dist_tag" --provenance/);
});

test('actual workflow shell exits zero when all archives exist and never invokes publish', () => {
  const root = mkdtempSync(join(tmpdir(), 'release-skip-test-'));
  try {
    const packageDir = join(root, 'package');
    const bin = join(root, 'bin');
    const release = join(root, 'clawkeeper-release');
    for (const path of [packageDir, bin, release]) mkdirSync(path);
    const archives = [];
    for (const name of ['shared', 'gatekeeper-kit', 'kernel', 'gatekeeper-fs', 'cli']) {
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: `@clawkeepers/${name}`, version }));
      const archive = join(root, `${name}.tgz`);
      assert.equal(spawnSync('tar', ['-czf', archive, '-C', root, 'package/package.json']).status, 0);
      archives.push(archive);
    }
    writeFileSync(join(release, 'archives.txt'), archives.join('\n') + '\n');
    writeFileSync(join(bin, 'npm'), "#!/bin/sh\n[ \"$1\" = view ] || exit 97\nprintf '\"0.1.0-beta.1\"\\n'\n", { mode: 0o700 });
    const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
    const script = workflow.split('      - name: Trusted publish with provenance')[1].split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((result.stdout.match(/already published, skipping/g) ?? []).length, 5);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
