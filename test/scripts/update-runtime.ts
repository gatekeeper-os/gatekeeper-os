/** Actual update effects in a disposable VM; runtime-probe override is explicitly not full conformance acceptance. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { updateEffects, rollback } from '../../packages/gkos-cli/src/commands/update.js';
import { executeUpdate, readUpdate, type UpdateJournal } from '../../packages/gkos-cli/src/util/update-transaction.js';
import { resolveCellFromRegistry } from '../../packages/gkos-cli/src/util/cell.js';
import { readLockfile } from '../../packages/gkos-cli/src/util/lockfile.js';
import { kernelRpcForCell } from '../../packages/gkos-cli/src/util/kernel-rpc.js';
if (process.env.HOME !== '/home/tester' || process.cwd() !== '/home/tester/src')
    throw new Error('DISPOSABLE_VM_REQUIRED');
const mode = process.argv[2], cell = resolveCellFromRegistry(), lock = readLockfile(cell)!;
const ev = '/home/tester/phase-7-evidence';
mkdirSync(ev, { recursive: true, mode: 0o700 });
function cmd(binary: string, args: string[], env: NodeJS.ProcessEnv = {}) { const r = spawnSync(binary, args, { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 900000 }); if (r.status !== 0)
    throw new Error('FIXTURE_COMMAND_FAILED'); return r.stdout; }
const path = '/home/tester/.gkos/updates/default/current.json';
if (mode === 'recover') {
    await rollback([], { cell: 'default', yes: true, json: true });
    const restored = readUpdate(path);
    writeFileSync(join(ev, 'recovery.json'), JSON.stringify({ ok: restored.state === 'rolled-back', from: restored.from, fullPhaseAcceptance: false }) + '\n');
}
else {
    const target = cmd('npm', ['view', 'openclaw@latest', 'version']).trim();
    const id = randomBytes(16).toString('hex');
    const j: UpdateJournal = { format: 1, id, cell: 'default', from: lock.upstream.version, target, kernelSchema: lock.kernelSchema, state: 'preparing', step: 1, completed: [], startedAt: new Date().toISOString(), previousBinary: lock.runtimeBinary ?? realpathSync(cmd('sh', ['-c', 'command -v openclaw']).trim()), candidateBinary: join('/home/tester/.gkos/runtimes/default', id, 'bin/openclaw'), previousDropIn: existsSync(join(cell.dropInDir, 'zz-gkos-runtime.conf')) ? readFileSync(join(cell.dropInDir, 'zz-gkos-runtime.conf'), 'utf8') : null };
    const effects = updateEffects(cell, lock, j, '/unused-full-conformance-runner');
    effects.conformance = async () => {
        const state = join('/home/tester/.gkos/updates/default', id, 'probe');
        cmd(process.execPath, ['test/scripts/update-probe.mjs', j.candidateBinary, state, target]);
        const v = JSON.parse(readFileSync(join(state, 'runtime-verdict.json'), 'utf8'));
        if (!v.ok || v.fullConformance !== false)
            throw new Error('PROBE_NOT_PASSED');
        writeFileSync(join(ev, mode + '-stage-probe.json'), JSON.stringify(v) + '\n');
        if (mode === 'reject')
            throw new Error('INTENTIONAL_CONFORMANCE_REJECTION');
    };
    if (mode === 'interrupt') {
        const activate = effects.activate;
        effects.activate = async () => { await activate(); process.kill(process.pid, 'SIGKILL'); };
    }
    try {
        await executeUpdate(path, j, effects);
    }
    catch (error) {
        if (mode !== 'reject' || readUpdate(path).state !== 'blocked' || readUpdate(path).step !== 5 || !existsSync(join(ev, 'reject-stage-probe.json')))
            throw error;
    }
    const actual = readUpdate(path);
    const s = kernelRpcForCell(cell, 'os.status', {}, mode === 'reject' ? j.previousBinary : j.candidateBinary) as {
        healthy: boolean;
        maintenance: boolean;
    };
    writeFileSync(join(ev, mode + '-transaction.json'), JSON.stringify({ ok: mode === 'reject' ? actual.state === 'blocked' && actual.step === 5 : actual.state === 'committed', state: actual.state, step: actual.step, completed: actual.completed, from: j.from, target, healthy: s.healthy, maintenance: s.maintenance, fullPhaseAcceptance: false, fullConformance: false }) + '\n');
}
