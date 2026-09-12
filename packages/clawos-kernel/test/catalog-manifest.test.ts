import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fsTools } from '../../gatekeeper-fs/src/tools.js';
import { tools as githubTools } from '../../gatekeeper-github/src/tools.js';

const manifest = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
describe('registering-kernel tool contracts', () => {
  it('declares every shipped gatekeeper tool on the kernel, not on the driver', () => {
    const kernel = manifest('../openclaw.plugin.json');
    const expected = ['os_request_access', 'os_list_grants', ...fsTools.map(t => t.name), ...githubTools.map(t => t.name)];
    expect(kernel.contracts.tools).toHaveLength(new Set(kernel.contracts.tools).size);
    expect([...kernel.contracts.tools].sort()).toEqual(expected.sort());
    expect(manifest('../../gatekeeper-fs/openclaw.plugin.json').contracts.tools).toEqual([]);
    expect(manifest('../../gatekeeper-github/openclaw.plugin.json').contracts.tools).toEqual([]);
  });
});
