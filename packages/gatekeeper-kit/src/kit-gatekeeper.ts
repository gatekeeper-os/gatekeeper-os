import type { ActionDescription, ApprovalQueue, Gatekeeper, GatekeeperSession, ObserverVerifier, SessionCallContext, SupportedResource, ToolResult } from "@clawos/shared";
import type { OverlayStore } from "./overlay-store.js";

/** Action tool implementation triple enforced by the kit (plan §4.5 dry pass). */
export interface ActionImpl<P = Record<string, unknown>> {
  describe(params: P): ActionDescription | Promise<ActionDescription>;
  simulate?(params: P, overlay: OverlayStore): void | Promise<void>;
  apply(params: P): Promise<unknown>;
  revert?(record: { actionId: number; remoteId?: string; params: P }): Promise<void>;
}
export type ObservationImpl<P = Record<string, unknown>> = (params: P, queue: ApprovalQueue) => Promise<unknown>;

/** Base class for per-resource gatekeepers. Subclasses fill `observations` and `actions` (see gatekeeper-github/src/issue.ts). */
export abstract class KitGatekeeper<State = unknown> implements Gatekeeper {
  abstract resource: SupportedResource;
  observations: Record<string, ObservationImpl> = {};
  actions: Record<string, ActionImpl> = {};
  protected abstract overlay: OverlayStore;

  async describe() { return { resource: this.resource, title: this.resource.title, suggestedName: this.resource.type.toUpperCase() }; }
  async getAutoApprovableActions() { return []; }
  async startSession(queue: ApprovalQueue): Promise<GatekeeperSession> {
    // TODO(phase-2): sequence action ids, route dry runs to describe(), route real calls to observations/actions,
    // call queue.submitAction before simulate, wrap results as ToolResult, sanitize errors.
    return { call: async (_tool: string, _params: Record<string, unknown>, _ctx: SessionCallContext): Promise<ToolResult> => { throw new Error("TODO(phase-2)"); }, close: async () => {} };
  }
  async applyAction(_actionId: number) { throw new Error("TODO(phase-2)"); }
  async rejectAction(_actionId: number) { throw new Error("TODO(phase-2)"); }
  async addObserver(_id: string, _verifier: ObserverVerifier): Promise<void> { throw new Error("private-only by default (strategy A)"); }
  async removeObserver(_id: string): Promise<void> {}
}
