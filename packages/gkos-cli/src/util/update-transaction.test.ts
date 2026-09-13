import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { exactVersion, executeUpdate, readUpdate, type UpdateEffects, type UpdateJournal } from './update-transaction.js';
import { forwardVersion, validateUpdateVerdict } from '../commands/update.js';
function fixture(fail?: number, rollbackFails = false) {
    const path = join(mkdtempSync(join(tmpdir(), 'update-transaction-')), 'journal.json');
    const journal: UpdateJournal = { format: 1, id: 'a'.repeat(32), cell: 'fixture', from: '2026.9.2', target: '2026.9.4', kernelSchema: 1, state: 'preparing', step: 1, completed: [], startedAt: new Date().toISOString(), previousBinary: '/old/openclaw', candidateBinary: '/new/openclaw', previousDropIn: null };
    const effects = Object.fromEntries(['resolve', 'compatibility', 'backup', 'stage', 'conformance', 'maintenance', 'activate', 'verify', 'commit'].map((name, i) => [name, vi.fn(async () => { const disk = readUpdate(path); expect(disk.step).toBe(i + 1); if (i === 6)
            expect(disk.state).toBe('activating'); if (fail === i + 1)
            throw new Error('private body MUST NOT be persisted'); })])) as unknown as UpdateEffects;
    effects.rollback = vi.fn(async () => { if (rollbackFails)
        throw new Error('vendor private error'); });
    effects.cancelMaintenance = vi.fn(async () => { });
    effects.resume = vi.fn(async () => { });
    return { path, journal, effects };
}
describe('durable update transaction (unit effects, not live acceptance)', () => {
    it('records every successful step and commits only after verification', async () => { const f = fixture(); await executeUpdate(f.path, f.journal, f.effects); expect(readUpdate(f.path)).toMatchObject({ state: 'committed', completed: [1, 2, 3, 4, 5, 6, 7, 8, 9] }); expect(f.effects.rollback).not.toHaveBeenCalled(); });
    it('does not roll back a verified commit when reopening admission fails', async () => { const f = fixture(); f.effects.resume = vi.fn(async () => { expect(readUpdate(f.path).state).toBe('committed'); throw new Error('resume failed'); }); await expect(executeUpdate(f.path, f.journal, f.effects)).rejects.toThrow(); expect(readUpdate(f.path).state).toBe('committed'); expect(f.effects.rollback).not.toHaveBeenCalled(); });
    it.each([1, 2, 3, 4, 5])('rejects step %i before activation without rollback', async (step) => { const f = fixture(step); await expect(executeUpdate(f.path, f.journal, f.effects)).rejects.toThrow(); expect(readUpdate(f.path)).toMatchObject({ state: 'blocked', failedStep: step }); expect(f.effects.activate).not.toHaveBeenCalled(); expect(f.effects.rollback).not.toHaveBeenCalled(); expect(readFileSync(f.path, 'utf8')).not.toContain('private'); });
    it('reopens admission if draining fails before activation', async () => { const f = fixture(6); await expect(executeUpdate(f.path, f.journal, f.effects)).rejects.toThrow(); expect(f.effects.cancelMaintenance).toHaveBeenCalledOnce(); expect(f.effects.activate).not.toHaveBeenCalled(); });
    it.each([7, 8, 9])('recovers a possibly partial step %i without committing', async (step) => { const f = fixture(step); await expect(executeUpdate(f.path, f.journal, f.effects)).rejects.toThrow(); expect(readUpdate(f.path)).toMatchObject({ state: 'rolled-back', failedStep: step }); expect(f.effects.rollback).toHaveBeenCalledOnce(); });
    it('retains a failed rollback as recovery-required and sanitizes errors', async () => { const f = fixture(7, true); await expect(executeUpdate(f.path, f.journal, f.effects)).rejects.toThrow('RECOVERY_REQUIRED'); expect(readUpdate(f.path).state).toBe('recovery-required'); expect(readFileSync(f.path, 'utf8')).not.toContain('vendor'); });
    it.each(['latest', 'file:/tmp/a', '2026.9.4;id', '2026.9.4\n', '-v', 'git+https://example.invalid'])('rejects nonexact release %s', v => expect(exactVersion(v)).toBe(false));
    it('refuses live downgrades and ambiguous prerelease replacement', () => { expect(forwardVersion('2026.9.4', '2026.9.2')).toBe(false); expect(forwardVersion('2026.9.4', '2026.9.4-beta.1')).toBe(false); expect(forwardVersion('2026.9.4-beta.1', '2026.9.4')).toBe(true); expect(forwardVersion('2026.9.2', '2026.9.4')).toBe(true); });
    it('accepts exact release/prerelease identifiers', () => { expect(exactVersion('2026.9.4')).toBe(true); expect(exactVersion('2026.9.4-beta.1')).toBe(true); });
    it('rejects smoke, stale and incomplete conformance reports', () => { for (const v of [undefined, {}, { ok: true, scope: 'compatibility-smoke' }, { ok: true, fullConformance: true, scope: 'live-conformance', runId: 'a'.repeat(32), upstreamVersion: '2026.9.4', tests: [] }])
        expect(validateUpdateVerdict(v, 'a'.repeat(32), '2026.9.4')).toBe(false); });
});
it('requires all live suites and rejects stale/version-mismatched/skipped/extra-failed evidence', () => {
    const tests = ['plugin-loads', 'hooks-fire', 'tool-narrowing', 'gate-blocks', 'rpc-methods', 'cli-mounted', 'health', 'fs-gatekeeper', 'install-gate', 'install-hook', 'config-reconcile', 'deferred-approval', 'require-approval-roundtrip'].map(id => ({ id, passed: 1, failed: 0, skipped: 0 }));
    const v = { scope: 'live-conformance', runId: 'a'.repeat(32), upstreamVersion: '2026.9.4', ok: true, fullConformance: true, tests };
    expect(validateUpdateVerdict(v, v.runId, v.upstreamVersion)).toBe(true);
    expect(validateUpdateVerdict(v, 'b'.repeat(32), v.upstreamVersion)).toBe(false);
    expect(validateUpdateVerdict(v, v.runId, '2026.9.2')).toBe(false);
    expect(validateUpdateVerdict({ ...v, tests: [...tests, { id: 'extra', passed: 0, failed: 1, skipped: 0 }] }, v.runId, v.upstreamVersion)).toBe(false);
    expect(validateUpdateVerdict({ ...v, tests: tests.map(t => ({ ...t, skipped: 1 })) }, v.runId, v.upstreamVersion)).toBe(false);
});
