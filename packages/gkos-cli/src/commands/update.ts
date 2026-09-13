/** Isolated-prefix update and durable rollback. No writes to the upstream installation or its unit file. */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { optionValue, type GlobalOptions } from '../options.js';
import { resolveCellFromRegistry, type Cell } from '../util/cell.js';
import { ensureDir, writeFileIfChanged } from '../util/fsx.js';
import { parseJson5 } from '../util/json5.js';
import { kernelRpcForCell } from '../util/kernel-rpc.js';
import { readLockfile, writeLockfile, type Lockfile } from '../util/lockfile.js';
import { waitForEndpoint } from '../util/openclaw.js';
import { StepError } from '../util/proc.js';
import { exactVersion, executeUpdate, readUpdate, saveUpdate, type UpdateEffects, type UpdateJournal } from '../util/update-transaction.js';
const REQUIRED = ['plugin-loads', 'hooks-fire', 'tool-narrowing', 'gate-blocks', 'rpc-methods', 'cli-mounted', 'health', 'fs-gatekeeper', 'install-gate', 'install-hook', 'config-reconcile', 'deferred-approval', 'require-approval-roundtrip'];
/** Live, run-bound conformance contract. Empty/skipped/synthetic reports never authorize activation. */
export function validateUpdateVerdict(value: unknown, id: string, version: string): boolean {
    const v = value as {
        scope?: string;
        runId?: string;
        upstreamVersion?: string;
        ok?: boolean;
        fullConformance?: boolean;
        tests?: Array<{
            id: string;
            passed: number;
            failed: number;
            skipped: number;
        }>;
    } | null;
    return !!v && v.scope === 'live-conformance' && v.runId === id && v.upstreamVersion === version && v.ok === true && v.fullConformance === true && Array.isArray(v.tests) && v.tests.every(t => !!t && typeof t.id==='string' && Number.isInteger(t.passed) && t.passed > 0 && t.failed === 0 && t.skipped === 0) && new Set(v.tests.map(t => t.id)).size === v.tests.length && REQUIRED.every(id => v.tests!.some(t => t.id === id && Number.isInteger(t.passed) && t.passed > 0 && t.failed === 0 && t.skipped === 0));
}
function command(binary: string, args: string[], env: NodeJS.ProcessEnv = {}, timeout = 120000): string {
    const result = spawnSync(binary, args, { env: { ...process.env, ...env }, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0 || result.error)
        throw new StepError('UPDATE_SUBPROCESS_FAILED');
    return result.stdout;
}
function json(binary: string, args: string[], env: NodeJS.ProcessEnv = {}): unknown { try {
    return JSON.parse(command(binary, args, env));
}
catch {
    throw new StepError('UPDATE_METADATA_UNAVAILABLE');
} }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function currentBinary(cell: Cell): string {
    const runtime = readLockfile(cell)?.runtimeBinary;
    if (runtime)
        return realpathSync(runtime);
    return realpathSync(command('sh', ['-c', 'command -v openclaw']).trim());
}
function exactTarget(args: string[]): string {
    const selected = optionValue(args, '--to'), channel = optionValue(args, '--channel');
    if (selected && channel)
        throw new StepError('Choose --to or --channel, not both');
    if (selected && !exactVersion(selected) && !['latest', 'beta', 'extended-stable'].includes(selected))
        throw new StepError('Exact version or supported release tag required');
    if (channel && !['stable', 'beta', 'extended-stable'].includes(channel))
        throw new StepError('Unsupported release channel');
    const target = json('npm', ['view', `openclaw@${selected ?? (channel === 'stable' ? 'latest' : channel) ?? 'latest'}`, 'version', '--json']);
    if (!exactVersion(target))
        throw new StepError('Registry did not resolve one exact release');
    return target;
}
/** Verify each pinned plugin against the actual installed package metadata, never just one catalog range. */
export function pluginCompatibility(cell: Cell, lock: Lockfile, target: string): Array<{
    id: string;
    compatible: boolean;
}> {
    const config = parseJson5(readFileSync(cell.configPath, 'utf8')) as {
        plugins?: {
            load?: {
                paths?: string[];
            };
        };
    };
    const paths = config.plugins?.load?.paths;
    if (!Array.isArray(paths) || !paths.length)
        throw new StepError('Installed plugin paths are unavailable');
    return Object.entries(lock.plugins).map(([id, version]) => {
        const packages = paths.filter(isAbsolute).map(root => { try {
            return { root, pkg: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), manifest: JSON.parse(readFileSync(join(root, 'openclaw.plugin.json'), 'utf8')) };
        }
        catch {
            return undefined;
        } }).filter(p => p?.manifest.id === id);
        if (packages.length !== 1 || packages[0]!.pkg.version !== version)
            throw new StepError('Installed plugin metadata disagrees with lockfile');
        const range = packages[0]!.pkg.openclaw?.compat?.pluginApi;
        if (typeof range !== 'string' || range.length > 256 || !range.length)
            throw new StepError('Plugin compatibility range missing');
        const resolved = json('npm', ['view', `openclaw@${range}`, 'version', '--json']);
        return { id, compatible: (Array.isArray(resolved) ? resolved : [resolved]).includes(target) };
    });
}
/** Forward-only live activation; downgrades must restore the matching archived state. */
export function forwardVersion(from: string, target: string): boolean {
    if (from === target)
        return true;
    const a = from.split('-')[0]!.split('.').map(Number), b = target.split('-')[0]!.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (b[i] !== a[i])
            return b[i]! > a[i]!;
    }
    return from.includes('-') && !target.includes('-');
}
function journalPath(cell: Cell): string { return join(homedir(), '.gkos', 'updates', cell.name, 'current.json'); }
function dropIn(cell: Cell): string { return join(cell.dropInDir, 'zz-gkos-runtime.conf'); }
function envFor(cell: Cell): NodeJS.ProcessEnv { return { ...cell.env, OPENCLAW_NO_AUTO_UPDATE: '1' }; }
function status(cell: Cell, binary: string) { return kernelRpcForCell(cell, 'os.status', {}, binary) as {
    healthy?: boolean;
    upstreamVersion?: string;
    maintenance?: boolean;
    activeRuns?: number;
    activeEffects?: number;
    activeRunTrackingComplete?: boolean;
    kernelSchema?: number;
    gatekeepers?: Array<{
        healthy?: boolean;
    }>;
}; }
function critical(cell: Cell, binary: string): string[] { const v = json(binary, ['security', 'audit', '--json'], envFor(cell)) as {
    findings?: Array<{
        severity?: string;
        checkId?: string;
    }>;
}; if (!Array.isArray(v.findings))
    throw new StepError('Security audit is unavailable'); return v.findings.filter(f => f.severity === 'critical').map(f => { if (typeof f.checkId !== 'string')
    throw new StepError('Audit finding identity missing'); return f.checkId; }).sort(); }
function grants(cell: Cell, binary: string): string { const value = kernelRpcForCell(cell, 'os.grants.list', {}, binary); if (!Array.isArray(value))
    throw new StepError('Grant list unavailable'); return hash(value.map(g => JSON.stringify(g)).sort()); }
async function pauseAndDrain(cell: Cell, binary: string): Promise<void> {
    kernelRpcForCell(cell, 'os.maintenance.set', { enabled: true }, binary);
    const until = Date.now() + 60000;
    for (;;) {
        const s = status(cell, binary);
        if (s.maintenance !== true || s.activeRunTrackingComplete !== true)
            throw new StepError('Maintenance admission barrier unavailable');
        if (s.activeRuns === 0 && s.activeEffects === 0)
            return;
        if (Date.now() >= until)
            throw new StepError('Cell did not drain');
        await new Promise(r => setTimeout(r, 500));
    }
}
function snapshot(cell: Cell, j: UpdateJournal): void {
    const output = join(homedir(), '.gkos', 'updates', cell.name, j.id, 'backup-' + randomBytes(4).toString('hex'));
    ensureDir(output);
    command(j.previousBinary, ['backup', 'create', '--output', output, '--verify', '--json'], envFor(cell));
    const paths = readdirSync(output).filter(p => p.endsWith('.tar.gz'));
    if (paths.length !== 1)
        throw new StepError('One verified backup archive required');
    j.archive = join(output, paths[0]!);
    chmodSync(j.archive, 0o600);
}
function quoted(value: string): string { if (/[\r\n\0]/.test(value))
    throw new StepError('Invalid runtime path'); return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', '$$') + '"'; }
/** Concrete runtime effects are exported for disposable integration tests, not as a CLI bypass flag. */
export function updateEffects(cell: Cell, lock: Lockfile, j: UpdateJournal, conformanceScript: string): UpdateEffects {
    const call = (binary: string, args: string[]) => command(binary, args, envFor(cell));
    return {
        async resolve() { if (!exactVersion(j.target))
            throw new StepError('Invalid target'); },
        async compatibility() { if (pluginCompatibility(cell, lock, j.target).some(p => !p.compatible))
            throw new StepError('Plugin incompatible'); const s = status(cell, j.previousBinary); if (!s.healthy || s.kernelSchema !== lock.kernelSchema || s.activeRunTrackingComplete !== true || !Number.isInteger(s.activeRuns))
            throw new StepError('Kernel update/drain protocol unavailable'); j.criticalIds = critical(cell, j.previousBinary); },
        async backup() { snapshot(cell, j); },
        async stage() { const prefix = dirname(dirname(j.candidateBinary)); ensureDir(prefix); const scratch = join(dirname(journalPath(cell)), j.id, 'install-state'); ensureDir(scratch); writeFileSync(join(scratch, 'openclaw.json'), '{}\n', { mode: 0o600 }); command('npm', ['install', '--global', '--prefix', prefix, `openclaw@${j.target}`, '--allow-scripts=openclaw'], { OPENCLAW_STATE_DIR: scratch, OPENCLAW_CONFIG_PATH: join(scratch, 'openclaw.json'), OPENCLAW_NO_AUTO_UPDATE: '1' }, 15 * 60000); const metadata = JSON.parse(readFileSync(join(prefix, 'lib/node_modules/openclaw/package.json'), 'utf8')); if (metadata.version !== j.target)
            throw new StepError('Staged version mismatch'); },
        async conformance() {
            // A staged binary is never invoked with the active state, copied credentials, or live plugin accounts.
            const state = join(homedir(), '.gkos', 'updates', cell.name, j.id, 'conformance-state');
            ensureDir(state);
            const config = join(state, 'openclaw.json');
            writeFileSync(config, '{}\n', { mode: 0o600 });
            const verdict = join(state, 'verdict.json');
            command(process.execPath, [conformanceScript], { ...envFor(cell), OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: config, OPENCLAW_PROFILE: 'gkos-update-conformance', GKOS_UPDATE_BINARY: j.candidateBinary, GKOS_UPDATE_RUN_ID: j.id, GKOS_UPDATE_TARGET: j.target, GKOS_UPDATE_VERDICT: verdict }, 15 * 60000);
            const result = JSON.parse(readFileSync(verdict, 'utf8'));
            if (!validateUpdateVerdict(result, j.id, j.target))
                throw new StepError('Full live conformance required');
        },
        async maintenance() {
            await pauseAndDrain(cell, j.previousBinary);
            j.grantsDigest = grants(cell, j.previousBinary);
            j.configDigest = hash(readFileSync(cell.configPath, 'utf8'));
            const metadata = JSON.parse(readFileSync(join(dirname(j.previousBinary), 'package.json'), 'utf8'));
            if (metadata.version !== j.from)
                throw new StepError('Running installation disagrees with pin');
            // Refresh after draining: the step-three backup alone can miss newly granted/revoked capabilities.
            snapshot(cell, j);
            saveUpdate(journalPath(cell), j);
            call(j.previousBinary, ['gateway', 'stop', '--force']);
        },
        async activate() {
            ensureDir(cell.dropInDir);
            writeFileIfChanged(dropIn(cell), `# OS-owned runtime selection; upstream unit untouched.\n[Service]\nExecStart=\nExecStart=${quoted(process.execPath)} ${quoted(j.candidateBinary)} gateway --port ${cell.port}\n`, 0o600);
            command('systemctl', ['--user', 'daemon-reload']);
            call(j.candidateBinary, ['config', 'validate']);
            command('systemctl', ['--user', 'start', cell.unit]);
        },
        async verify() { await verifyRuntime(cell, j, j.candidateBinary); },
        async commit() {
            const current = readLockfile(cell);
            if (!current || current.kernelSchema !== j.kernelSchema || current.upstream.version !== j.from)
                throw new StepError('Pin changed during update');
            writeLockfile(cell, { ...current, upstream: { ...current.upstream, version: j.target }, runtimeBinary: j.candidateBinary, lastKnownGood: { version: j.from, verifiedAt: new Date().toISOString() } });
        },
        async resume() { kernelRpcForCell(cell, 'os.maintenance.set', { enabled: false }, j.candidateBinary); },
        async rollback() { await restoreRuntime(cell, j); },
        async cancelMaintenance() { kernelRpcForCell(cell, 'os.maintenance.set', { enabled: false }, j.previousBinary); },
    };
}
async function verifyRuntime(cell: Cell, j: UpdateJournal, binary: string): Promise<void> {
    j.check='http-health';
    const deadline = Date.now() + 60000;
    if (!await waitForEndpoint(cell.port, '/startupz', Math.max(1, deadline - Date.now())) || !await waitForEndpoint(cell.port, '/readyz', Math.max(1, deadline - Date.now())))
        throw new StepError('Gateway health verification failed');
    j.check='service-process';
    const expected = binary === j.candidateBinary ? j.target : j.from;
    const pid = Number(command('systemctl', ['--user', 'show', cell.unit, '--property=MainPID', '--value']).trim());
    if (!Number.isSafeInteger(pid) || pid < 1)
        throw new StepError('Service process unavailable');
    const root = dirname(realpathSync(binary));
    // OpenClaw may replace process.title, which also overwrites /proc cmdline.
    // Verify systemd's actual ExecStart selection plus the authenticated runtime
    // version below; a mutable process title is not a runtime identity contract.
    const started=command('systemctl',['--user','show',cell.unit,'--property=ExecStart','--value']);
    if(!started.includes(binary)&&!started.includes(root+sep))throw new StepError('Wrong runtime service selection');
    j.check='kernel-version';
    const s = status(cell, binary);
    if(s.upstreamVersion!==expected)throw new StepError('Runtime version mismatch');
    j.check='kernel-health-schema-maintenance-grants';
    if (!s.healthy || s.kernelSchema !== j.kernelSchema || s.maintenance !== true || !s.gatekeepers?.length || s.gatekeepers.some(g => g.healthy !== true) || grants(cell, binary) !== j.grantsDigest)
        throw new StepError('Kernel or grant preservation verification failed');
    j.check='critical-audit';
    if (critical(cell, binary).some(id => !j.criticalIds?.includes(id)))
        throw new StepError('New critical security finding');
}
async function restoreRuntime(cell: Cell, j: UpdateJournal): Promise<void> {
    if (!j.archive || readLockfile(cell)?.kernelSchema !== j.kernelSchema)
        throw new StepError('Schema-neutral rollback unavailable');
    if (j.configDigest !== hash(readFileSync(cell.configPath, 'utf8')))
        throw new StepError('Configuration changed; refusing to overwrite newer operator edits');
    command('systemctl', ['--user', 'stop', cell.unit]);
    // Run the retained old binary only on an empty scratch state, never on candidate-migrated state.
    const scratch = join(homedir(), '.gkos', 'updates', cell.name, j.id, 'restore-' + randomBytes(4).toString('hex'));
    ensureDir(scratch);
    const empty = join(scratch, 'empty');
    ensureDir(empty);
    writeFileSync(join(empty, 'openclaw.json'), '{}\n', { mode: 0o600 });
    const env = { ...cell.env, OPENCLAW_STATE_DIR: empty, OPENCLAW_CONFIG_PATH: join(empty, 'openclaw.json') };
    command(j.previousBinary, ['backup', 'verify', j.archive], env);
    const extracted = join(scratch, 'extracted');
    command(j.previousBinary, ['backup', 'restore', j.archive, '--target', extracted], env);
    const root = readdirSync(extracted).map(n => join(extracted, n)).find(p => existsSync(join(p, 'manifest.json')));
    if (!root)
        throw new StepError('Restore manifest unavailable');
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
        assets?: Array<{
            kind: string;
            archivePath: string;
            sourcePath: string;
        }>;
    };
    const asset = manifest.assets?.find(a => a.kind === 'state' && a.sourcePath === cell.stateDir);
    if (!asset || isAbsolute(asset.archivePath))
        throw new StepError('Restore state identity mismatch');
    const state = resolve(extracted, asset.archivePath);
    if (!state.startsWith(resolve(extracted) + sep) || !existsSync(state))
        throw new StepError('Restore state unavailable');
    const previousLock = JSON.parse(readFileSync(join(state, 'os/gkos.lock.json'), 'utf8')) as Lockfile;
    if (previousLock.kernelSchema !== j.kernelSchema || previousLock.upstream.version !== j.from)
        throw new StepError('Archived pin/schema mismatch');
    renameSync(cell.stateDir, cell.stateDir + '.failed-update-' + randomBytes(8).toString('hex'));
    renameSync(state, cell.stateDir);
    chmodSync(cell.stateDir, 0o700);
    chmodSync(cell.osDir, 0o700);
    chmodSync(cell.configPath, 0o600);
    if (j.previousDropIn === null) {
        if (existsSync(dropIn(cell)))
            unlinkSync(dropIn(cell));
    }
    else
        writeFileIfChanged(dropIn(cell), j.previousDropIn, 0o600);
    command('systemctl', ['--user', 'daemon-reload']);
    command('systemctl', ['--user', 'start', cell.unit]);
    await verifyRuntime(cell, j, j.previousBinary);
    kernelRpcForCell(cell, 'os.maintenance.set', { enabled: false }, j.previousBinary);
}
/** Update check emits a safe availability message; scheduler delivery belongs to the scheduler, not this command. */
async function updateCommand(args: string[], globals: GlobalOptions): Promise<number> {
    const seen = new Set<string>();
    const allowed = new Set(['--to', '--channel', '--conformance', '--check', '--dry-run']);
    for (let i = 0; i < args.length; i++) {
        const key = args[i]!.split('=')[0]!;
        if (!allowed.has(key) || seen.has(key))
            throw new StepError('Unknown or duplicate update option');
        seen.add(key);
        if (['--to', '--channel', '--conformance'].includes(key) && !args[i]!.includes('=')) {
            if (!args[++i] || args[i]!.startsWith('--'))
                throw new StepError('Update option requires a value');
        }
    }
    const cell = resolveCellFromRegistry(globals.cell), lock = readLockfile(cell);
    if (!lock)
        throw new StepError('Installed cell lockfile required');
    const target = exactTarget(args), plugins = pluginCompatibility(cell, lock, target), compatible = plugins.every(p => p.compatible);
    if (args.includes('--check') || args.includes('--dry-run')) {
        const result = { cell: cell.name, current: lock.upstream.version, target, available: target !== lock.upstream.version, compatible, plugins, activated: false, fullConformance: false };
        console.log(globals.json ? JSON.stringify(result) : `Update ${target}${result.available ? ' available' : ' is current'}; ${compatible ? 'all plugins compatible' : 'incompatible plugins'}; full conformance required before activation.`);
        return compatible ? 0 : 1;
    }
    if (!globals.yes)
        throw new StepError('Update interrupts the selected cell; use --yes');
    if (process.platform !== 'linux')
        throw new StepError('Update currently requires systemd Linux');
    if (!compatible)
        throw new StepError('Target is outside an installed plugin range');
    if (!forwardVersion(lock.upstream.version, target))
        throw new StepError('Downgrades require the verified rollback archive, not update');
    const script = optionValue(args, '--conformance');
    if (!script || !isAbsolute(script) || !existsSync(script))
        throw new StepError('A reviewed full live-conformance runner is required (--conformance <absolute .mjs path>); compatibility smoke cannot activate an update');
    const path = journalPath(cell);
    ensureDir(dirname(path));
    if (existsSync(path) && !['committed', 'rolled-back', 'blocked'].includes(readUpdate(path).state))
        throw new StepError('Unfinished update; run gkos rollback --yes');
    const id = randomBytes(16).toString('hex');
    const journal: UpdateJournal = { format: 1, id, cell: cell.name, from: lock.upstream.version, target, kernelSchema: lock.kernelSchema, state: 'preparing', step: 1, completed: [], startedAt: new Date().toISOString(), previousBinary: currentBinary(cell), candidateBinary: join(homedir(), '.gkos', 'runtimes', cell.name, id, 'bin/openclaw'), previousDropIn: existsSync(dropIn(cell)) ? readFileSync(dropIn(cell), 'utf8') : null };
    // Exclusive process guard is kept outside the state restored by rollback. Interrupted runs require explicit recovery.
    const guard = path + '.running';
    if (existsSync(guard))
        throw new StepError('Update process guard present; recover the interrupted run first');
    writeFileSync(guard, String(process.pid), { mode: 0o600, flag: 'wx' });
    try {
        await executeUpdate(path, journal, updateEffects(cell, lock, journal, script));
        console.log(JSON.stringify({ ok: true, target, completed: journal.completed }));
        return 0;
    }
    finally {
        unlinkSync(guard);
    }
}
/** Recover a partially activated update, retaining failed state for diagnosis and refusing schema drift. */
export async function rollback(args: string[], globals: GlobalOptions): Promise<number> {
    if (args.length || !globals.yes)
        throw new StepError('usage: gkos rollback --yes [--cell name]');
    const cell = resolveCellFromRegistry(globals.cell), path = journalPath(cell), j = readUpdate(path);
    if (j.cell !== cell.name || !['preparing', 'staged', 'maintenance', 'activating', 'verifying', 'rolling-back', 'recovery-required', 'committed'].includes(j.state))
        throw new StepError('No activated update to roll back');
    const guard = path + '.running';
    if (existsSync(guard)) {
        const pid = Number(readFileSync(guard, 'utf8'));
        if (!Number.isSafeInteger(pid) || pid < 1)
            throw new StepError('Invalid process guard');
        try {
            process.kill(pid, 0);
            throw new StepError('Update process is still running');
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
                throw error;
        }
        unlinkSync(guard);
    }
    writeFileSync(guard, String(process.pid), { mode: 0o600, flag: 'wx' });
    const before = j.state;
    let recoveryStarted = false;
    try {
        if (j.step < 7) {
            if (j.step === 6) {
                command('systemctl', ['--user', 'start', cell.unit]);
                if (!await waitForEndpoint(cell.port, '/readyz', 60000))
                    throw new StepError('Old runtime did not restart');
                kernelRpcForCell(cell, 'os.maintenance.set', { enabled: false }, j.previousBinary);
            }
            j.state = 'blocked';
            saveUpdate(path, j);
            console.log(JSON.stringify({ ok: true, activated: false, state: j.state }));
            return 0;
        }
        if (j.state === 'committed') {
            await pauseAndDrain(cell, j.candidateBinary);
            if (grants(cell, j.candidateBinary) !== j.grantsDigest) {
                kernelRpcForCell(cell, 'os.maintenance.set', { enabled: false }, j.candidateBinary);
                throw new StepError('Grants changed after update; refusing stale rollback');
            }
        }
        recoveryStarted = true;
        j.state = 'rolling-back';
        saveUpdate(path, j);
        await restoreRuntime(cell, j);
        j.state = 'rolled-back';
        saveUpdate(path, j);
        console.log(JSON.stringify({ ok: true, version: j.from, state: j.state }));
        return 0;
    }
    catch {
        if (before === 'committed' && !recoveryStarted) {
            try {
                kernelRpcForCell(cell, 'os.maintenance.set', { enabled: false }, j.candidateBinary);
            }
            catch { }
        }
        j.state = recoveryStarted ? 'recovery-required' : before;
        saveUpdate(path, j);
        throw new StepError('Rollback refused or requires recovery; retained archives and failed state were not deleted');
    }
    finally {
        unlinkSync(guard);
    }
}

/** Expose only fixed host-layer diagnostics; malformed config/vendor reports never reach CLI output. */
export async function update(args:string[],globals:GlobalOptions):Promise<number>{
  try{return await updateCommand(args,globals);}catch(error){
    if(error instanceof StepError)throw error;
    if(error instanceof Error&&/^UPDATE_STEP_[1-9]_(BLOCKED|ROLLED_BACK|RECOVERY_REQUIRED)$/.test(error.message))throw new StepError(error.message);
    throw new StepError('Update metadata or transaction unavailable; inspect the private recovery journal');
  }
}
