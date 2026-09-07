/** Capability records (plan §4.4). Stored by the kernel in <stateDir>/os/clawos.sqlite. */

export type GrantStatus = "pending" | "active" | "revoked" | "lockdown";

/** A grant: one agent's access to one resource through one gatekeeper. */
export interface Grant {
  /** Opaque agent-visible handle, e.g. "grant:7k3m9q2p". Never encodes the resource. */
  handle: string;
  agentId: string;
  cellId: string;
  vendor: string;
  resourceType: string;
  /** Vendor-specific key, e.g. "owner/repo". Never shown to the agent unless the operator marks it visible. */
  resourceKey: string;
  /** Whose account backs it. */
  operatorId: string;
  scope: "agent" | `session:${string}`;
  audience: "owner-only" | "shared";
  status: GrantStatus;
  createdAt: number;
  createdBy: "operator" | "agent-request";
  expiresAt?: number;
  /** Short operator-chosen title shown in the grant table. */
  title?: string;
}

/** A queued action awaiting a human decision. */
export interface PendingAction {
  id: number;
  gatekeeperInstance: string;
  actionId: number;
  descriptionJson: string;
  status: "pending" | "applied" | "rejected" | "reverted" | "failed";
  submittedAt: number;
  decidedBy?: string;
  decidedAt?: number;
  appliedAt?: number;
  error?: string;
}

/** Audit record shape (plan §4.8). One JSON object per line in os/audit/YYYY-MM-DD.jsonl. */
export interface AuditRecord {
  ts: string;
  cell: string;
  agentId?: string;
  sessionKey?: string;
  kind: "observation" | "action.submit" | "action.decide" | "action.apply" | "action.revert" | "grant" | "auth" | "tool" | "install" | "egress";
  vendor?: string;
  resourceType?: string;
  handle?: string;
  actionId?: number;
  title: string;
  decision?: string;
  by?: string;
  durationMs?: number;
  ok?: boolean;
}

export const GRANT_HANDLE_RE = /^grant:[a-z0-9]{8}$/;
