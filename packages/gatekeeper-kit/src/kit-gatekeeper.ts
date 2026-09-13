import { isDeepStrictEqual } from "node:util";
import { Value } from "typebox/value";
import { ActionDescriptionSchema, ObservationDescriptionSchema, type ActionDescription, type ApprovalQueue, type Gatekeeper, type GatekeeperSession, type ObserverVerifier, type SessionCallContext, type SupportedResource, type ToolResult } from "@gatekeeper-os/shared";
import { OverlayStore } from "./overlay-store.js";
import { ActionSequencer } from "./action-sequencer.js";
import { readJson, writeJsonAtomic } from "./atomic-json.js";
import { sanitizeError } from "./sanitize.js";

/** Side-effect-free description, local simulation, and explicit remote application. */
export interface ActionImpl<P = Record<string, unknown>> {
  describe(params: P): ActionDescription | Promise<ActionDescription>;
  simulate?(params: P, overlay: OverlayStore, actionId: number): unknown | Promise<unknown>;
  apply(params: P, actionId: number): Promise<{ remoteId?: string; value?: unknown } | void>;
  revert?(record: { actionId: number; remoteId?: string; params: P }): Promise<void>;
}
/** Observations describe before reading; the kit owns authorization and never hands them a write queue. */
export interface ObservationImpl<P = Record<string, unknown>> {
  describe(params: P): import("@gatekeeper-os/shared").ObservationDescription | Promise<import("@gatekeeper-os/shared").ObservationDescription>;
  read(params: P): Promise<unknown>;
}
type Status = "submitting" | "pending" | "applying" | "applied" | "rejected" | "reverting" | "reverted" | "uncertain";
interface ActionRecord { id: number; tool: string; params: Record<string, unknown>; description: ActionDescription; status: Status; callKey?: string; remoteId?: string; }

/** Base resource driver. Only the kernel may create its sessions through resolveGrant(). */
export abstract class KitGatekeeper<State = unknown> implements Gatekeeper {
  abstract resource: SupportedResource;
  observations: Record<string, ObservationImpl> = {};
  actions: Record<string, ActionImpl> = {};
  protected abstract overlay: OverlayStore;
  private records = new Map<number, ActionRecord>();
  private readonly sequence: ActionSequencer;
  constructor(private readonly journalPath?: string) {
    if (journalPath) {
      const raw = readJson(journalPath);
      if (raw !== undefined) {
        const value = raw as { version: number; records: ActionRecord[] };
        if (value.version !== 1 || !Array.isArray(value.records)) throw new Error("Invalid action journal.");
        for (const record of value.records) {
          if (!Number.isSafeInteger(record.id) || record.id < 1 || this.records.has(record.id) || typeof record.tool !== "string" ||
            !record.params || typeof record.params !== "object" || !Value.Check(ActionDescriptionSchema, record.description) ||
            !["submitting", "pending", "applying", "applied", "rejected", "reverting", "reverted", "uncertain"].includes(record.status)) throw new Error("Invalid action journal.");
          this.records.set(record.id, record);
        }
      }
    }
    this.sequence = new ActionSequencer(journalPath ? `${journalPath}.sequence` : undefined, [...this.records.keys()].reduce((max, id) => Math.max(max, id), 0) + 1);
  }
  private save(record: ActionRecord): void {
    const records = new Map(this.records); records.set(record.id, structuredClone(record));
    if (this.journalPath) writeJsonAtomic(this.journalPath, { version: 1, records: [...records.values()] });
    this.records = records;
  }
  private record(id: number): ActionRecord { const record = this.records.get(id); if (!record) throw new Error("Unknown action."); return structuredClone(record); }
  private assertSettled(): void {
    if ([...this.records.values()].some(record => ["submitting", "applying", "reverting", "uncertain"].includes(record.status))) throw new Error("Action outcome requires reconciliation.");
  }
  private async recoverOverlay(): Promise<void> {
    this.assertSettled();
    for (const entry of this.overlay.list()) {
      if (this.records.get(entry.actionId)?.status !== "pending") this.overlay.remove(entry.actionId);
    }
    for (const record of this.records.values()) {
      if (record.status === "pending" && !record.description.awaitDecision && !this.overlay.list().some(entry => entry.actionId === record.id)) {
        const impl = this.impl(record.tool);
        if (!impl.simulate) throw new Error("Simulation implementation missing.");
        await impl.simulate(structuredClone(record.params), this.overlay, record.id);
      }
    }
  }
  private impl(tool: string): ActionImpl {
    const impl = Object.hasOwn(this.actions, tool) ? this.actions[tool] : undefined;
    if (!impl || typeof impl.describe !== "function" || typeof impl.apply !== "function") throw new Error("Action implementation missing.");
    return impl;
  }
  async describe() { return { resource: this.resource, title: this.resource.title, suggestedName: this.resource.type.toUpperCase() }; }
  async getAutoApprovableActions() { return []; }
  /** Bind a kernel queue; dry passes never read vendors, reserve ids, submit actions or modify overlays. */
  async startSession(queue: ApprovalQueue): Promise<GatekeeperSession> {
    await this.sequence.run(() => this.recoverOverlay());
    let closed = false;
    const live = () => { if (closed) throw new Error("Session closed."); this.assertSettled(); };
    return {
      close: async () => { closed = true; },
      call: async (tool, input, ctx) => {
        try {
          live(); this.assertSettled();
          if (ctx.queue !== queue || !ctx.agentId || !ctx.sessionKey || (ctx.observers?.length ?? 0) > 0) throw new Error("Session authority unavailable.");
          const params = structuredClone(input);
          if (!this.resource.tools.includes(tool)) throw new Error("Tool outside resource.");
          const observation = Object.hasOwn(this.observations, tool) ? this.observations[tool] : undefined;
          if (observation) {
            const description = await observation.describe(structuredClone(params));
            if (!Value.Check(ObservationDescriptionSchema, description)) throw new Error("Invalid observation description.");
            live();
            if (ctx.dryRun) return { kind: "observation" as const, description };
            await queue.authorizeObservation(description); live();
            const value = await observation.read(params); live();
            return result(value);
          }
          const impl = this.impl(tool), description = await impl.describe(structuredClone(params));
          if (!Value.Check(ActionDescriptionSchema, description) || (description.implementsRevert && !impl.revert)) throw new Error("Invalid action description.");
          if (!description.awaitDecision && !impl.simulate) throw new Error("Action simulation missing.");
          live();
          if (ctx.dryRun) return { kind: "action" as const, description };
          if (description.awaitDecision && !approved(tool, params, ctx)) throw new Error("Action approval missing.");
          return await this.sequence.run(async () => {
            live(); this.assertSettled();
            const callKey = ctx.toolCallId ? JSON.stringify([ctx.agentId, ctx.sessionKey, ctx.toolCallId]) : undefined;
            if (callKey && [...this.records.values()].some(record => record.callKey === callKey)) throw new Error("Action call already submitted.");
            const id = this.sequence.next();
            const record: ActionRecord = { id, tool, params, description, status: "submitting", ...(callKey ? { callKey } : {}) };
            this.save(record);
            try { await queue.submitAction(id, description); }
            catch { this.save({ ...record, status: "uncertain" }); throw new Error("Action submission failed."); }
            this.save({ ...record, status: "pending" });
            try {
              live();
              if (description.awaitDecision) {
                const value = await this.applyRecorded(id); live(); return result(value);
              }
              const value = await impl.simulate!(structuredClone(params), this.overlay, id); live();
              if (!this.overlay.list().some(entry => entry.actionId === id)) throw new Error("Simulation effect missing.");
              return result(value);
            } catch {
              this.overlay.remove(id);
              const current = this.record(id);
              if (current.status === "pending") this.save({ ...current, status: "uncertain" });
              throw new Error("Action did not complete.");
            }
          });
        } catch (error) { throw new Error(sanitizeError(error)); }
      },
    };
  }
  private async applyRecorded(id: number): Promise<unknown> {
    const record = this.record(id);
    if (record.status === "applied") { this.overlay.remove(id); return undefined; }
    if (record.status !== "pending") throw new Error("Action is not pending.");
    if ([...this.records.values()].some(other => other.id < id && !["applied", "rejected", "reverted"].includes(other.status))) throw new Error("Earlier action must be decided first.");
    this.save({ ...record, status: "applying" });
    let applied: Awaited<ReturnType<ActionImpl["apply"]>>;
    try { applied = await this.impl(record.tool).apply(structuredClone(record.params), id); }
    catch { this.save({ ...record, status: "uncertain" }); throw new Error("Application outcome uncertain."); }
    this.save({ ...record, status: "applied", ...(applied?.remoteId ? { remoteId: applied.remoteId } : {}) });
    this.overlay.remove(id); return applied?.value;
  }
  /** Apply once after the kernel's operator decision. Ambiguous remote failures are never blindly retried. */
  async applyAction(actionId: number): Promise<void> {
    try { await this.sequence.run(async () => { await this.applyRecorded(actionId); }); }
    catch (error) { throw new Error(sanitizeError(error)); }
  }
  /** Remove a pending effect. An ambiguous submission/application requires operator reconciliation instead. */
  async rejectAction(actionId: number): Promise<void> {
    await this.sequence.run(async () => {
      const record = this.record(actionId);
      if (record.status === "rejected") { this.overlay.remove(actionId); return; }
      if (record.status !== "pending") throw new Error("Action is not pending.");
      this.save({ ...record, status: "rejected" }); this.overlay.remove(actionId);
    });
  }
  /** Revert once using only the recorded remote identifier and original parameters. */
  async revertAction(actionId: number): Promise<void> {
    try {
      await this.sequence.run(async () => {
        const record = this.record(actionId);
        if (record.status === "reverted") return;
        const impl = this.impl(record.tool);
        if (record.status !== "applied" || !record.description.implementsRevert || !impl.revert) throw new Error("Action cannot be reverted.");
        this.save({ ...record, status: "reverting" });
        try { await impl.revert({ actionId, params: structuredClone(record.params), ...(record.remoteId ? { remoteId: record.remoteId } : {}) }); }
        catch { this.save({ ...record, status: "uncertain" }); throw new Error("Revert outcome uncertain."); }
        this.save({ ...record, status: "reverted" });
      });
    } catch (error) { throw new Error(sanitizeError(error)); }
  }
  /** v1 defaults to private-only; granting observers is never inferred from resource metadata. */
  async addObserver(_id: string, _verifier: ObserverVerifier): Promise<void> { throw new Error("Shared access is unavailable."); }
  async removeObserver(_id: string): Promise<void> {}
}
function result(value: unknown): ToolResult {
  const encoded = JSON.stringify(value ?? { ok: true });
  if (encoded === undefined) throw new Error("Invalid tool result.");
  return { content: [{ type: "text", text: encoded }], details: JSON.parse(encoded) };
}
function approved(tool: string, params: Record<string, unknown>, ctx: SessionCallContext): boolean {
  const approval = ctx.actionApproval;
  return !!ctx.toolCallId && approval?.toolCallId === ctx.toolCallId && approval.tool === tool && isDeepStrictEqual(approval.params, params);
}
