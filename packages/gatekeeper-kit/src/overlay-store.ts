import { readJson, writeJsonAtomic } from "./atomic-json.js";

/** One pending local effect, identified by the action's durable per-instance id. */
export interface OverlayEntry { actionId: number; kind: string; payload: unknown; }
interface Snapshot { version: 1; tempId: number; entries: OverlayEntry[]; }
/** Validate restored entries before using them to simulate reads. */
export function validEntries(value: unknown): value is OverlayEntry[] {
  return Array.isArray(value) && value.every(e => e && Number.isSafeInteger(e.actionId) && e.actionId > 0 && typeof e.kind === "string" && e.kind.length > 0 && "payload" in e)
    && new Set(value.map(e => e.actionId)).size === value.length;
}
/** Overlay-at-read effects. File-backed instances survive restart; one cell process owns each file. */
export class OverlayStore {
  private state: Snapshot = { version: 1, tempId: -1, entries: [] };
  constructor(private readonly path?: string) { this.load(); }
  private load(): void {
    if (!this.path) return;
    const raw = readJson(this.path);
    if (raw === undefined) return;
    const value = raw as Snapshot;
    if (value.version !== 1 || !Number.isSafeInteger(value.tempId) || value.tempId >= 0 || !validEntries(value.entries)) throw new Error("Invalid overlay state.");
    this.state = value;
  }
  private save(next: Snapshot): void { if (this.path) writeJsonAtomic(this.path, next); this.state = next; }
  /** Allocate a negative simulated identifier without colliding with remote positive ids. */
  nextTempId(): number {
    this.load();
    if (this.state.tempId <= Number.MIN_SAFE_INTEGER) throw new Error("Temporary id space exhausted.");
    const id = this.state.tempId; this.save({ ...this.state, tempId: id - 1 }); return id;
  }
  /** Add exactly one effect per queued action; duplicate IDs are rejected. */
  add(entry: OverlayEntry): void {
    this.load();
    const entries = [...this.state.entries, structuredClone(entry)].sort((a, b) => a.actionId - b.actionId);
    if (!validEntries(entries)) throw new Error("Invalid or duplicate overlay action.");
    this.save({ ...this.state, entries });
  }
  /** Retire a rejected or applied action. Missing ids are harmless. */
  remove(actionId: number): void { this.load(); this.save({ ...this.state, entries: this.state.entries.filter(e => e.actionId !== actionId) }); }
  /** Return detached pending entries in action-id order. */
  list(): OverlayEntry[] { this.load(); return structuredClone(this.state.entries); }
  /** Merge pending effects without allowing reducers to mutate the authoritative read or stored entries. */
  applyTo<T>(value: T, mergers: Record<string, (value: T, entry: OverlayEntry) => T>): T {
    return this.list().reduce((result, entry) => {
      const merge = Object.hasOwn(mergers, entry.kind) ? mergers[entry.kind] : undefined;
      if (!merge) throw new Error("Unknown simulation action kind.");
      return merge(result, entry);
    }, structuredClone(value));
  }
}
