/** Capability records (plan §4.4). Stored by the kernel in <stateDir>/os/gkos.sqlite. */

/** Lifecycle state of an introduced capability. */
export type GrantStatus = "pending" | "active" | "revoked" | "lockdown";

/** A grant: one agent's access to one resource through one gatekeeper. */
export interface Grant {
  /** Opaque agent-visible handle, e.g. "grant:7k3m9q2p". Never encodes the resource. */
  handle: string;
  /** Agent that owns the capability. */
  agentId: string;
  /** Cell trust boundary that owns the capability. */
  cellId: string;
  /** Stable gatekeeper vendor namespace. */
  vendor: string;
  /** Resource type within its vendor. */
  resourceType: string;
  /** Vendor-specific key, e.g. "owner/repo". Never shown to the agent unless the operator marks it visible. */
  resourceKey: string;
  /** Whose account backs it. */
  operatorId: string;
  /** Agent-wide or restricted to one exact session. */
  scope: "agent" | `session:${string}`;
  /** Whether observers may use this capability. */
  audience: "owner-only" | "shared";
  /** Current lifecycle state. */
  status: GrantStatus;
  /** Creation time in Unix milliseconds. */
  createdAt: number;
  /** Authority that requested the introduction. */
  createdBy: "operator" | "agent-request";
  /** Optional expiry in Unix milliseconds. */
  expiresAt?: number;
  /** Short operator-chosen title shown in the grant table. */
  title?: string;
}

/** A queued action awaiting a human decision. */
export interface PendingAction {
  /** Kernel queue record identifier. */
  id: number;
  /** Stable identifier for the resource instance. */
  gatekeeperInstance: string;
  /** Monotonic per-instance action identifier. */
  actionId: number;
  /** Serialized ActionDescription, validated before storage. */
  descriptionJson: string;
  /** Current lifecycle state. */
  status: "pending" | "applied" | "rejected" | "reverted" | "failed";
  /** Submission time in Unix milliseconds. */
  submittedAt: number;
  /** Trusted operator identity that decided this action. */
  decidedBy?: string;
  /** Decision time in Unix milliseconds. */
  decidedAt?: number;
  /** Application time in Unix milliseconds. */
  appliedAt?: number;
  /** Sanitized error code or fixed message only. */
  error?: string;
}

/** Audit record shape (plan §4.8). One JSON object per line in os/audit/YYYY-MM-DD.jsonl. */
export interface AuditRecord {
  /** UTC audit timestamp. */
  ts: string;
  /** Cell trust boundary. */
  cell: string;
  /** Agent that owns the capability. */
  agentId?: string;
  /** Trusted session correlation key. */
  sessionKey?: string;
  /** Allowlisted audit event category. */
  kind: "observation" | "action.submit" | "action.decide" | "action.apply" | "action.revert" | "grant" | "auth" | "tool" | "install" | "egress";
  /** Stable gatekeeper vendor namespace. */
  vendor?: string;
  /** Resource type within its vendor. */
  resourceType?: string;
  /** Opaque capability handle. */
  handle?: string;
  /** Monotonic per-instance action identifier. */
  actionId?: number;
  /** Safe audit label, never raw vendor content. */
  title: string;
  /** Decision category, not raw vendor content. */
  decision?: string;
  /** Trusted authority responsible for this event. */
  by?: string;
  /** Elapsed time in milliseconds. */
  durationMs?: number;
  /** Whether the operation succeeded. */
  ok?: boolean;
}

/** Canonical lowercase Crockford base32 handle; excludes ambiguous i/l/o/u. */
export const GRANT_HANDLE_RE = /^grant:[0-9a-hjkmnp-tv-z]{8}$/;
