/** Overlay-at-read simulation store (plan §4.5): pending actions are merged into reads; rejected ones vanish. */
export interface OverlayEntry { actionId: number; kind: string; payload: unknown; }

export class OverlayStore {
  private entries: OverlayEntry[] = [];
  private tempId = -1;
  nextTempId() { return this.tempId--; }
  add(e: OverlayEntry) { this.entries.push(e); }
  remove(actionId: number) { this.entries = this.entries.filter((e) => e.actionId !== actionId); }
  list() { return [...this.entries]; }
  /** Apply every pending entry to a read result. Gatekeepers supply `mergers` per entry kind. */
  applyTo<T>(value: T, mergers: Record<string, (v: T, e: OverlayEntry) => T>): T {
    return this.entries.reduce((acc, e) => (mergers[e.kind] ? mergers[e.kind]!(acc, e) : acc), value);
  }
  // TODO(phase-2): persist to <stateDir>/os/gatekeepers/<vendor>/cache/<instance>.json so simulation survives restarts.
}
