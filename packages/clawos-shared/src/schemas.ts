/** TypeBox wire schemas for os.* gateway methods and CLI JSON output. TODO(phase-2): complete. */
import { Type, type Static } from "typebox";

export const GrantHandle = Type.String({ pattern: "^grant:[a-z0-9]{8}$" });

export const OsStatus = Type.Object({
  cell: Type.String(),
  upstreamVersion: Type.String(),
  kernelVersion: Type.String(),
  healthy: Type.Boolean(),
  maintenance: Type.Boolean(),
  gatekeepers: Type.Array(Type.Object({ vendor: Type.String(), healthy: Type.Boolean(), accounts: Type.Number() })),
  pendingApprovals: Type.Number(),
  pendingRequests: Type.Number(),
  lastUpdate: Type.Optional(Type.Object({ to: Type.String(), ok: Type.Boolean(), at: Type.String() })),
});
export type OsStatus = Static<typeof OsStatus>;

export const IntroduceParams = Type.Object({ agentId: Type.String(), url: Type.String(), title: Type.Optional(Type.String()),
  audience: Type.Optional(Type.Union([Type.Literal("owner-only"), Type.Literal("shared")])) });
export const ApprovalDecisionParams = Type.Object({ ids: Type.Union([Type.Array(Type.Integer()), Type.Literal("all")]) });
