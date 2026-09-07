import { readJson, writeJsonAtomic } from "./atomic-json.js";
import { validEntries, type OverlayEntry } from "./overlay-store.js";
interface Snapshot<T> { version: 1; base: T; pending: OverlayEntry[]; }
/** Mutate-the-cache simulation with an authoritative base retained for rejection and refresh replay. */
export class CacheMutationStore<T> {
  private state: Snapshot<T>;
  private view: T;
  constructor(base: T, private readonly reducers: Record<string, (value: T, entry: OverlayEntry) => T>, private readonly path?: string) {
    this.state = { version: 1, base: structuredClone(base), pending: [] };
    if (path) {
      const raw = readJson(path) as Snapshot<T> | undefined;
      if (raw !== undefined) {
        if (raw.version !== 1 || !validEntries(raw.pending) || !("base" in raw)) throw new Error("Invalid cache state.");
        this.state = raw;
      }
    }
    this.view = this.replay(this.state);
  }
  private replay(state: Snapshot<T>): T {
    return structuredClone(state.pending).reduce((value, entry) => {
      const reduce = Object.hasOwn(this.reducers, entry.kind) ? this.reducers[entry.kind] : undefined;
      if (!reduce) throw new Error("Unknown simulation action kind.");
      return reduce(value, entry);
    }, structuredClone(state.base));
  }
  private save(next: Snapshot<T>): void {
    const view = this.replay(next);
    if (this.path) writeJsonAtomic(this.path, next);
    this.state = next; this.view = view;
  }
  /** Return a detached view containing all pending effects. */
  read(): T { return structuredClone(this.view); }
  /** Apply one new effect to the cached view after its action was queued. */
  add(entry: OverlayEntry): void {
    const pending = [...this.state.pending, structuredClone(entry)].sort((a, b) => a.actionId - b.actionId);
    if (!validEntries(pending)) throw new Error("Invalid or duplicate cache action.");
    this.save({ ...this.state, pending });
  }
  /** Reject one action and rebuild the view from the authoritative base. */
  remove(actionId: number): void { this.save({ ...this.state, pending: this.state.pending.filter(e => e.actionId !== actionId) }); }
  /** Refresh authoritative data and replay all pending actions in order. */
  refresh(base: T): void { this.save({ ...this.state, base: structuredClone(base) }); }
  /** Retire an applied effect together with the refreshed authoritative data. */
  commit(actionId: number, base: T): void { this.save({ version: 1, base: structuredClone(base), pending: this.state.pending.filter(e => e.actionId !== actionId) }); }
}
