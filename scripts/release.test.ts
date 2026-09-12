import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { versionPlan } from './release.js';

test('release bump preserves excluded plugin pins and is preview-only until applied', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawkeeper-version-test-'));
  const put = (path: string, value: unknown) => writeFileSync(join(root, path), JSON.stringify(value));
  try {
    mkdirSync(join(root, 'config')); mkdirSync(join(root, 'packages/kernel'), { recursive: true });
    put('config/release-packages.json', { packages: ['kernel'] });
    put('package.json', { version: '0.1.0' });
    put('packages/kernel/package.json', { name: '@clawkeepers/kernel', version: '0.1.0', private: false, publishConfig: { access: 'public' } });
    put('packages/kernel/openclaw.plugin.json', { id: 'clawos-kernel', version: '0.1.0' });
    put('clawos.lock.json', { plugins: { 'clawos-kernel': '0.1.0', 'gatekeeper-github': '0.1.0' }, upstream: { version: '2026.9.2' } });
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    const plan = versionPlan(root, '0.1.0-beta.1', 'Reviewed release notes.');
    assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), before);
    const lock = JSON.parse(plan.get(join(root, 'clawos.lock.json'))!);
    assert.equal(lock.plugins['clawos-kernel'], '0.1.0-beta.1');
    assert.equal(lock.plugins['gatekeeper-github'], '0.1.0');
    assert.equal(lock.upstream.version, '2026.9.2');
    assert.match(plan.get(join(root, 'CHANGELOG.md'))!, /## 0\.1\.0-beta\.1/);
    assert.throws(() => versionPlan(root, '../bad', 'notes'));
    assert.throws(() => versionPlan(root, '0.1.0', ''));
    put('packages/kernel/package.json', { name: '@clawkeepers/kernel', private: true });
    assert.throws(() => versionPlan(root, '0.1.0', 'notes'), /explicitly publishable/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
