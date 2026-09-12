/** Resolve a committed cell runtime without launching an old binary into an in-progress newer state. */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Cell } from './cell.js';
import { readLockfile } from './lockfile.js';
import { StepError } from './proc.js';
/** Ordinary CLI commands wait for recovery/commit; the updater supplies explicit binaries to its own adapters. */
export function committedRuntime(cell: Cell): string | undefined {
    const path = join(homedir(), '.clawos', 'updates', cell.name, 'current.json');
    if (existsSync(path)) {
        let state: unknown;
        try {
            state = JSON.parse(readFileSync(path, 'utf8')).state;
        }
        catch {
            throw new StepError('Update journal unreadable; inspect recovery state before running a cell command');
        }
        if (!['preparing', 'staged', 'maintenance', 'committed', 'rolled-back', 'blocked'].includes(String(state)))
            throw new StepError('Update activation or recovery is in progress; use the update journal and rollback');
    }
    return readLockfile(cell)?.runtimeBinary;
}
