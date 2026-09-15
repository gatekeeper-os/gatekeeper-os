import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertPluginList, packedRegistry } from './packed-load.mjs';
import { pluginId, resources, tools, toolName } from './packed-fixture/metadata.mjs';

test('packed third-party gatekeeper has its own exact contract and cannot hide in the kernel surface', () => {
  const fixture = JSON.parse(readFileSync(new URL('./packed-fixture/openclaw.plugin.json', import.meta.url), 'utf8'));
  const kernel = JSON.parse(readFileSync(new URL('../packages/gkos-kernel/openclaw.plugin.json', import.meta.url), 'utf8'));
  assert.equal(fixture.id, pluginId);
  assert.deepEqual(fixture.contracts.tools, tools.map(tool => tool.name));
  assert.equal(tools[0].name, toolName);
  assert.equal(kernel.contracts.tools.includes(toolName), false);
  assert.deepEqual(resources.flatMap(resource => resource.tools), [toolName]);
  assert.match(toolName, /^gk_[a-z]+_[a-z]+_[a-z]+$/);
});

test('packed plugin gate fails closed for missing, disabled, duplicate and diagnostic reports', () => {
  const clean = { plugins: [{ id: 'driver', enabled: true, status: 'loaded' }], diagnostics: [], registry: { diagnostics: [] } };
  assert.doesNotThrow(() => assertPluginList(clean, ['driver']));
  for (const report of [
    {}, { ...clean, plugins: [] },
    { ...clean, plugins: [{ id: 'driver', enabled: false }] },
    { ...clean, plugins: [...clean.plugins, ...clean.plugins] },
    { ...clean, plugins: [{ ...clean.plugins[0], status: 'error' }] },
    { ...clean, plugins: [{ ...clean.plugins[0], diagnostics: [{ level: 'info' }] }] },
    { ...clean, diagnostics: [{ level: 'warning' }] },
    { ...clean, registry: { diagnostics: [{ level: 'info' }] } },
  ]) assert.throws(() => assertPluginList(report, ['driver']));
});

test('prepublication registry serves exact bytes with integrity and rejects writes/unknown packages', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gkos-packed-registry-test-'));
  const bytes = Buffer.from('unchanged packed artifact fixture');
  const archive = join(root, 'package.tgz');
  writeFileSync(archive, bytes);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@gatekeeper-os/shared', version: '0.1.0-beta.1' }));
  const registry = await packedRegistry([{ root, archive, name: '@gatekeeper-os/shared' }]);
  try {
    const metadata = await (await fetch(registry.url + '/@gatekeeper-os%2fshared')).json();
    const { dist } = metadata.versions['0.1.0-beta.1'];
    assert.equal(dist.integrity, 'sha512-' + createHash('sha512').update(bytes).digest('base64'));
    assert.deepEqual(Buffer.from(await (await fetch(dist.tarball)).arrayBuffer()), bytes);
    assert.equal((await fetch(registry.url + '/@gatekeeper-os/shared', { method: 'PUT', body: '{}' })).status, 405);
    assert.equal((await fetch(registry.url + '/unknown')).status, 404);
  } finally { await registry.close(); rmSync(root, { force: true, recursive: true }); }
});
