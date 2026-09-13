/** Crash-recoverable update sequencing. No upstream state or process details enter the journal. */
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensureDir } from './fsx.js';
/** All transitions are persisted before their effects begin; step seven may be partially applied after a crash. */
export type UpdateState = 'preparing' | 'staged' | 'maintenance' | 'activating' | 'verifying' | 'committed' | 'rolling-back' | 'rolled-back' | 'blocked' | 'recovery-required';
/** Version-bound private recovery record; paths point to retained OS-owned material, not vendor state internals. */
export interface UpdateJournal {
    format: 1;
    id: string;
    cell: string;
    from: string;
    target: string;
    kernelSchema: number;
    state: UpdateState;
    step: number;
    completed: number[];
    startedAt: string;
    previousBinary: string;
    candidateBinary: string;
    archive?: string;
    previousDropIn: string | null;
    grantsDigest?: string;
    configDigest?: string;
    criticalIds?: string[];
    failedStep?: number;
    check?: string;
    failedCheck?: string;
}
/** Fsync the private journal and containing directory before allowing activation. */
export function saveUpdate(path: string, journal: UpdateJournal): void {
    ensureDir(dirname(path));
    const temporary = `${path}.${process.pid}.tmp`;
    const fd = openSync(temporary, 'w', 0o600);
    try {
        writeFileSync(fd, JSON.stringify(journal) + '\n');
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    renameSync(temporary, path);
    const dir = openSync(dirname(path), 'r');
    try {
        fsyncSync(dir);
    }
    finally {
        closeSync(dir);
    }
}
/** Reject an invalid recovery record, including arbitrary process arguments posing as versions. */
export function readUpdate(path: string): UpdateJournal {
    let value: UpdateJournal;
    try {
        value = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        throw new Error('UPDATE_JOURNAL_INVALID');
    }
    if (value.format !== 1 || !/^[a-f0-9]{32}$/.test(value.id) || !exactVersion(value.from) || !exactVersion(value.target) || !Number.isInteger(value.step) || value.step < 1 || value.step > 9 || value.kernelSchema !== 1 || !Array.isArray(value.completed) || !['preparing', 'staged', 'maintenance', 'activating', 'verifying', 'committed', 'rolling-back', 'rolled-back', 'blocked', 'recovery-required'].includes(value.state))
        throw new Error('UPDATE_JOURNAL_INVALID');
    return value;
}
/** Only exact npm release identifiers are accepted; package specs, URLs and shell syntax are not versions. */
export function exactVersion(value: unknown): value is string { return typeof value === 'string' && /^\d{4}\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(value); }
/** Runtime effects supplied by the host adapter; tests cannot silently become live acceptance evidence. */
export interface UpdateEffects {
    resolve(): Promise<void>;
    compatibility(): Promise<void>;
    backup(): Promise<void>;
    stage(): Promise<void>;
    conformance(): Promise<void>;
    maintenance(): Promise<void>;
    activate(): Promise<void>;
    verify(): Promise<void>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    cancelMaintenance(): Promise<void>;
    resume(): Promise<void>;
}
/** Execute all nine steps, rolling back any possibly-activated target and retaining recovery failure state. */
export async function executeUpdate(path: string, journal: UpdateJournal, effects: UpdateEffects): Promise<void> {
    const actions = [effects.resolve, effects.compatibility, effects.backup, effects.stage, effects.conformance, effects.maintenance, effects.activate, effects.verify, effects.commit];
    try {
        for (const [index, action] of actions.entries()) {
            journal.step = index + 1;
            if (index === 4)
                journal.state = 'staged';
            if (index === 5)
                journal.state = 'maintenance';
            if (index === 6)
                journal.state = 'activating';
            if (index === 7)
                journal.state = 'verifying';
            saveUpdate(path, journal);
            await action();
            journal.completed.push(index + 1);
            saveUpdate(path, journal);
        }
        journal.state = 'committed';
        saveUpdate(path, journal);
    }
    catch {
        journal.failedStep = journal.step;
        if(journal.check)journal.failedCheck=journal.check;
        if (journal.step >= 7) {
            journal.state = 'rolling-back';
            saveUpdate(path, journal);
            try {
                await effects.rollback();
                journal.state = 'rolled-back';
            }
            catch {
                journal.state = 'recovery-required';
            }
        }
        else {
            try {
                if (journal.step === 6)
                    await effects.cancelMaintenance();
                journal.state = 'blocked';
            }
            catch {
                journal.state = 'recovery-required';
            }
        }
        saveUpdate(path, journal);
        throw new Error(`UPDATE_STEP_${journal.failedStep}_${journal.state.toUpperCase().replaceAll('-', '_')}`);
    }
    // Admission opens only after the verified commit is durably recorded. A resume
    // failure leaves a committed, paused cell; it must not trigger stale rollback.
    await effects.resume();
}
