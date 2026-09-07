/** ApprovalQueue implementation + AutoApprovalDrainer (plan §4.5). */
import type { ApprovalQueue, Grant } from "@clawos/shared";
import type { AuditLog } from "./audit.js";
import type { Store } from "./store.js";

export class ApprovalQueueImpl {
  constructor(private store: Store, private audit: AuditLog) {}
  forGrant(grant: Grant, sessionKey: string): ApprovalQueue {
    return {
      authorizeObservation: async (d) => { /* TODO(phase-3): lockdown/prohibitAllSharing/excludeObservers checks; audit */ void grant; void sessionKey; void d; },
      submitAction: async (actionId, d) => { /* TODO(phase-4): record pending; audit; notify */ void actionId; void d; },
    };
  }
  // TODO(phase-5): AutoApprovalDrainer — per instance, id order, single-flight, stop at first non-eligible.
}
