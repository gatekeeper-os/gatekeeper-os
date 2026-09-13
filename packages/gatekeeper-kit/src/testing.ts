import type { ActionDescription, ApprovalQueue, ObservationDescription, SessionCallContext } from "@gatekeeper-os/shared";

/** Offline unit-test queue; never use it as a production authority or conformance substitute. */
export class TestApprovalQueue implements ApprovalQueue {
  readonly observations: ObservationDescription[] = [];
  readonly actions: Array<{ id: number; description: ActionDescription }> = [];
  denyObservations = false;
  denyActions = false;
  async authorizeObservation(description: ObservationDescription): Promise<void> {
    if (this.denyObservations) throw new Error("Observation denied.");
    this.observations.push(structuredClone(description));
  }
  async submitAction(id: number, description: ActionDescription): Promise<void> {
    if (this.denyActions) throw new Error("Action denied.");
    if (this.actions.some(action => action.id === id)) throw new Error("Duplicate action.");
    this.actions.push({ id, description: structuredClone(description) });
  }
  /** Construct a deterministic unit-test call context. */
  context(toolCallId = "test-call"): SessionCallContext { return { agentId: "test-agent", sessionKey: "test-session", toolCallId, queue: this }; }
}
