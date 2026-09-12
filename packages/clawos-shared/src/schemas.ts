/** JSON wire contracts. Runtime queues, sessions, accounts and vendors are never serialized. */
import { Type, type Static } from "typebox";
import { GRANT_HANDLE_RE } from "./grant.js";

const closed = { additionalProperties: false };
const text = Type.String({ minLength: 1 });
const namespace = Type.String({ pattern: "^[a-z][a-z0-9_]*$" });
const timestamp = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const actionId = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });

/** JSON-only extension payloads: functions and other runtime values are not wire data. */
export const JsonValueSchema = Type.Cyclic({ Value: Type.Union([
  Type.Null(), Type.Boolean(), Type.Number(), Type.String(),
  Type.Array(Type.Ref("Value")), Type.Record(Type.String(), Type.Ref("Value")),
]) }, "Value");
/** Canonical opaque capability handle; never a vendor resource identifier. */
export const GrantHandle = Type.String({ pattern: GRANT_HANDLE_RE.source });
/** Provider-portable OS tool name, bounded to 64 ASCII characters. */
export const ToolNameSchema = Type.String({ pattern: "^gk_[a-z0-9]+(?:_[a-z0-9]+){2,}$", maxLength: 64 });
/** Resource discovery metadata, not proof of a loaded driver or an active grant. */
export const SupportedResourceSchema = Type.Object({
  urlPattern: text, type: namespace, title: text, description: Type.String(), grantable: Type.Boolean(),
  observerStrategy: Type.Enum(["private-only", "acl-check", "dataset-tracking", "low-stakes"]),
  tools: Type.Array(ToolNameSchema, { uniqueItems: true }),
}, closed);
/** Description passed to the kernel before observation data is returned. */
export const ObservationDescriptionSchema = Type.Object({
  title: text, description: Type.String(), prohibitAllSharing: Type.Optional(Type.Boolean()),
  excludeObservers: Type.Optional(Type.Array(text, { uniqueItems: true })),
}, closed);
/** Stable action-policy key and human-readable label. */
export const ActionKindSchema = Type.Object({ tag: text, label: text }, closed);
/** Deferred action metadata; never raw credentials or vendor request bodies. */
export const ActionDescriptionSchema = Type.Object({
  title: text, description: Type.String(), actionKind: Type.Optional(ActionKindSchema),
  autoApprovable: Type.Optional(Type.Boolean()), implementsRevert: Type.Boolean(),
  awaitDecision: Type.Optional(Type.Boolean()), preview: Type.Optional(JsonValueSchema),
}, closed);
/** Discriminated dry-pass response; cannot contain a live session or execute function. */
export const DryRunResultSchema = Type.Union([
  Type.Object({ kind: Type.Literal("observation"), description: ObservationDescriptionSchema }, closed),
  Type.Object({ kind: Type.Literal("action"), description: ActionDescriptionSchema }, closed),
]);
/** Agent-visible result blocks and optional JSON details. */
export const ToolResultSchema = Type.Object({
  content: Type.Array(Type.Object({ type: Type.Literal("text"), text: Type.String() }, closed)),
  details: Type.Optional(JsonValueSchema),
}, closed);
/** Private account-to-account verifier; must not be exposed in agent catalogs. */
export const ObserverVerifierSchema = Type.Object({ vendor: namespace, opaque: text }, closed);
/** Cached tool metadata. The kit also checks resource mappings and required string grant parameters. */
export const GatekeeperToolDefSchema = Type.Object({
  name: ToolNameSchema, resourceType: namespace, kind: Type.Enum(["observation", "action"]),
  description: text, parameters: Type.Record(Type.String(), JsonValueSchema),
  outputSchema: Type.Optional(Type.Record(Type.String(), JsonValueSchema)),
}, closed);
/** Credential-free account summary returned by account.describe(). */
export const AccountDescriptionSchema = Type.Object({
  email: Type.Optional(text), displayName: Type.Optional(text), expiresAt: Type.Optional(timestamp), accountId: Type.Optional(text),
}, closed);
/** Credential-free vendor summary returned by vendor.describe(). */
export const VendorDescriptionSchema = Type.Object({
  title: text, description: Type.String(), icon: Type.Optional(text), autoProvisionsAccount: Type.Optional(Type.Boolean()),
}, closed);
/** Credential-free per-resource summary returned by gatekeeper.describe(). */
export const GatekeeperDescriptionSchema = Type.Object({ resource: SupportedResourceSchema, title: text, suggestedName: text }, closed);
/** Authorization redirect sent only to an operator, never an audit record. */
export const ConnectionResultSchema = Type.Object({ url: text }, closed);
/** Optional effect of rejecting an action. A void runtime result is normalized to an empty object. */
export const RejectActionResultSchema = Type.Object({ restart: Type.Optional(Type.Boolean()) }, closed);
/** Optional effect of reverting an action; messages must already be sanitized. */
export const RevertActionResultSchema = Type.Object({ message: Type.Optional(Type.String()), canRetry: Type.Optional(Type.Boolean()) }, closed);
/** Persisted capability record; it is not the redacted agent catalog entry. */
export const GrantSchema = Type.Object({
  handle: GrantHandle, agentId: text, cellId: text, vendor: namespace, resourceType: namespace,
  resourceKey: text, operatorId: text,
  scope: Type.Union([Type.Literal("agent"), Type.TemplateLiteral([Type.Literal("session:"), Type.String()], { pattern: "^session:.+$" })]),
  audience: Type.Enum(["owner-only", "shared"]), status: Type.Enum(["pending", "active", "revoked", "lockdown"]),
  createdAt: timestamp, createdBy: Type.Enum(["operator", "agent-request"]),
  expiresAt: Type.Optional(timestamp), title: Type.Optional(Type.String()),
}, closed);
/** Kernel action queue row. Parse descriptionJson separately with ActionDescriptionSchema. */
export const PendingActionSchema = Type.Object({
  id: actionId, gatekeeperInstance: text, actionId, descriptionJson: text,
  status: Type.Enum(["pending", "applied", "rejected", "reverted", "failed"]), submittedAt: timestamp,
  decidedBy: Type.Optional(text), decidedAt: Type.Optional(timestamp), appliedAt: Type.Optional(timestamp), error: Type.Optional(Type.String()),
}, closed);
/** Allowlisted audit record shape; unknown fields (including headers and bodies) are rejected. */
export const AuditRecordSchema = Type.Object({
  ts: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$" }), cell: text,
  agentId: Type.Optional(text), sessionKey: Type.Optional(text),
  kind: Type.Enum(["observation", "action.submit", "action.decide", "action.apply", "action.revert", "grant", "auth", "tool", "install", "egress"]),
  vendor: Type.Optional(namespace), resourceType: Type.Optional(namespace), handle: Type.Optional(GrantHandle),
  actionId: Type.Optional(actionId), title: Type.String(), decision: Type.Optional(text), by: Type.Optional(text),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })), ok: Type.Optional(Type.Boolean()),
}, closed);
/** Kernel health/status response. */
export const OsStatus = Type.Object({
  cell: text, upstreamVersion: text, kernelVersion: text, healthy: Type.Boolean(), maintenance: Type.Boolean(),
  gatekeepers: Type.Array(Type.Object({ vendor: namespace, healthy: Type.Boolean(), accounts: timestamp }, closed)),
  pendingApprovals: timestamp, pendingRequests: timestamp,
  lastUpdate: Type.Optional(Type.Object({ to: text, ok: Type.Boolean(), at: text }, closed)),
}, closed);
/** TypeScript view of the kernel status wire response. */
export type OsStatus = Static<typeof OsStatus>;
/** Operator introduction request. Identity comes from authenticated RPC context, never this payload. */
export const IntroduceParams = Type.Object({ agentId: text, url: text, title: Type.Optional(Type.String()),
  audience: Type.Optional(Type.Enum(["owner-only", "shared"])) }, closed);
/** Operator decision request. IDs are positive safe integers and cannot repeat. */
export const ApprovalDecisionParams = Type.Object({ ids: Type.Union([
  Type.Array(actionId, { minItems: 1, uniqueItems: true }), Type.Literal("all"),
]) }, closed);
/** Exact capability revocation request. */
export const RevokeGrantParams = Type.Object({ handle: GrantHandle }, closed);
/** Agent access request; does not grant authority by itself. */
export const RequestAccessParams = Type.Object({ url: text, reason: text }, closed);
/** Optional filter for operator grant listing. */
export const ListGrantsParams = Type.Object({ agentId: Type.Optional(text) }, closed);
/** Account connection request. Operator identity is supplied by authenticated RPC context. */
export const ConnectGatekeeperParams = Type.Object({ vendor: namespace, resourceTypes: Type.Optional(Type.Array(namespace, { uniqueItems: true })) }, closed);
