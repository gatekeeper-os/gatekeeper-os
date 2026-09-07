import { readJson, writeJsonAtomic } from "./atomic-json.js";

/** Per-instance monotonic action ids and single-flight lifecycle scheduling; file ownership is one cell process. */
export class ActionSequencer {
  private nextId = 1;
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly path?: string, minimum = 1) {
    if (!Number.isSafeInteger(minimum) || minimum < 1) throw new Error("Invalid action sequence minimum.");
    this.nextId = minimum; this.load();
  }
  private load(): void {
    if (!this.path) return;
    const raw = readJson(this.path);
    if (raw === undefined) return;
    const state = raw as { version: number; next: number };
    if (state.version !== 1 || !Number.isSafeInteger(state.next) || state.next < 1) throw new Error("Invalid action sequence.");
    this.nextId = Math.max(this.nextId, state.next);
  }
  /** Reserve an id durably before it can be submitted to the kernel queue. */
  next(): number {
    this.load();
    if (this.nextId >= Number.MAX_SAFE_INTEGER) throw new Error("Action id space exhausted.");
    const id = this.nextId;
    if (this.path) writeJsonAtomic(this.path, { version: 1, next: id + 1 });
    this.nextId = id + 1; return id;
  }
  /** Serialize operations and remain usable after a rejected operation. */
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => {}, () => {}); return result;
  }
}
