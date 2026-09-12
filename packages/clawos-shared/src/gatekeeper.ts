/**
 * OpenClaw OS gatekeeper contracts — adapted from cloudflare-os `packages/workshop-shared/src/gatekeeper.ts`
 * for a single-process, tool-calling runtime. See docs/implementation-plan.md §4.3.
 *
 * Kernel bar: every exported member is doc-commented. Do not add members without updating the plan.
 */
import type { TSchema } from "typebox";

/** A resource type this gatekeeper can grant, keyed by URL pattern. */
export interface SupportedResource {
  /** URLPattern string, e.g. "https://github.com/:owner/:repo". */
  urlPattern: string;
  /** Stable id for this resource type within the vendor, e.g. "repo". */
  type: string;
  /** Human-readable label; never includes credentials. */
  title: string;
  /** Human-readable explanation; never includes credentials. */
  description: string;
  /** If true, this type can be granted independently (scopes requested only for enabled types). */
  grantable: boolean;
  /** Observer strategy for bindings of this type (plan §4.7). */
  observerStrategy: "private-only" | "acl-check" | "dataset-tracking" | "low-stakes";
  /** Tool names available for a grant of this type. */
  tools: string[];
}

/** Human-readable description of a read. Everything needed to decide, display, and audit. */
export interface ObservationDescription {
  /** Human-readable label; never includes credentials. */
  title: string;
  /** Markdown. Must include every detail relevant to approval. Never includes secrets. */
  description: string;
  /** Blunt stopgap: block if the session is shared, and put the grant into lockdown (observations only). */
  prohibitAllSharing?: boolean;
  /** Observers who must not see this data; the kernel blocks the observation if any is still present. */
  excludeObservers?: string[];
}

/** Stable policy key; auto-approval rules match on `tag`. Treat as an enum. */
export interface ActionKind {
  /** Stable policy identifier; not a display label. */
  tag: string;
  /** Operator-facing name for this action kind. */
  label: string;
}

/** Description of a side-effecting action, submitted before it is performed. */
export interface ActionDescription {
  /** Human-readable label; never includes credentials. */
  title: string;
  /** Human-readable explanation; never includes credentials. */
  description: string;
  /** Optional stable key for operator auto-approval policy. */
  actionKind?: ActionKind;
  /** Gatekeeper author's verdict that this specific action is safe to auto-apply if the user opted in for its kind. */
  autoApprovable?: boolean;
  /** True if the gatekeeper implements revertAction() for this action. */
  implementsRevert: boolean;
  /** If true, do NOT simulate: block the tool call until the human decides (maps to OpenClaw requireApproval). */
  awaitDecision?: boolean;
  /** Structured payload for the approval UI. Never includes secrets. */
  preview?: unknown;
}

/** Handed to a gatekeeper session by the kernel. A gatekeeper never constructs one. */
export interface ApprovalQueue {
  /** Must be awaited before returning any data to the agent. Throws to deny. */
  authorizeObservation(d: ObservationDescription): Promise<void>;
  /** Fully asynchronous: returns as soon as the action is recorded. The human may decide days later. */
  submitAction(actionId: number, d: ActionDescription): Promise<void>;
}

/** Result shape returned to the agent by gatekeeper tools. */
export interface ToolResult {
  /** Agent-visible text blocks. */
  content: Array<{ type: "text"; text: string }>;
  /** Optional structured result data; never credential material. */
  details?: unknown;
}

/** Per-call context supplied by the kernel from its before_tool_call stash (plan §5.2). */
export interface SessionCallContext {
  /** Trusted agent identity supplied by the kernel. */
  agentId: string;
  /** Trusted session identity supplied by the kernel. */
  sessionKey: string;
  /** Upstream run identifier when available. */
  runId?: string;
  /** Upstream call identifier used for correlation. */
  toolCallId?: string;
  /** Kernel-owned approval queue; never supplied by tool parameters. */
  queue: ApprovalQueue;
  /** Present when the session has observers beyond its owner. */
  observers?: string[];
  /** True during the kernel's dry pass: return the description, perform no side effects. */
  dryRun?: boolean;
  /** Trusted pre-recorded synchronous approval. Never populated from tool parameters or serialized over RPC. */
  actionApproval?: {
    /** Exact upstream call that was approved. */
    toolCallId: string;
    /** Exact tool whose action was approved. */
    tool: string;
    /** Exact validated parameters retained by the kernel at approval time. */
    params: Record<string, unknown>;
  };
}

/** One live binding of (grant → gatekeeper resource) inside one agent session. */
export interface GatekeeperSession {
  /** Execute a tool of this resource type. `params` were validated against the tool schema by OpenClaw. */
  call(tool: string, params: Record<string, unknown>, ctx: SessionCallContext): Promise<ToolResult | DryRunResult>;
  /** Revoke this live session and deny subsequent calls. */
  close(): Promise<void>;
}

/** What a dry pass returns: the description the kernel needs to decide before the real call. */
export type DryRunResult =
  | { kind: "observation"; description: ObservationDescription }
  | { kind: "action"; description: ActionDescription };

/** Opaque to everyone but the gatekeeper that minted it. */
export interface ObserverVerifier {
  /** Vendor that minted this opaque verifier. */
  readonly vendor: string;
  /** Private verifier material, not an agent-visible resource identifier. */
  readonly opaque: string;
}

/** Per-resource instance. Created by the kernel through resolveGrant(). */
export interface Gatekeeper {
  /** Describe this object without returning credentials. */
  describe(): Promise<{ resource: SupportedResource; title: string; suggestedName: string }>;
  /** List action kinds eligible for an explicit operator policy. */
  getAutoApprovableActions(): Promise<ActionKind[]>;
  /** Bind a kernel-owned queue to this resource session. */
  startSession(queue: ApprovalQueue): Promise<GatekeeperSession>;
  /** Perform a previously submitted action for real. Idempotent. */
  applyAction(actionId: number): Promise<void>;
  /** Discard a pending action and its simulated effects. */
  rejectAction(actionId: number): Promise<void | { restart?: boolean }>;
  /** Undo an applied action if implementsRevert. */
  revertAction?(actionId: number): Promise<void | { message?: string; canRetry?: boolean }>;
  /** Throw if this observer may not see everything this instance has read. */
  addObserver(id: string, verifier: ObserverVerifier): Promise<void>;
  /** Remove an observer from this resource instance. */
  removeObserver(id: string): Promise<void>;
}

/** Per-operator account (one OAuth identity or static credential). */
export interface GatekeeperAccount {
  /** Describe this object without returning credentials. */
  describe(): Promise<{ email?: string; displayName?: string; expiresAt?: number; accountId?: string }>;
  /** List the resource types supported by this account or vendor. */
  getSupportedResources(): Promise<SupportedResource[]>;
  /** Returns a Gatekeeper for the resource a URL denotes, with credentials bound. Called BEFORE any grant exists. */
  getGatekeeperFor(url: string): Promise<{ gatekeeper: Gatekeeper; resource: SupportedResource; resourceKey: string }>;
  /** Mint an opaque verifier that proves *this account's* access, for observer checks. */
  getVerifier(): Promise<ObserverVerifier>;
  /** Revoke the account credentials and active access. */
  revoke(): Promise<void>;
  /** Start account reconnection using a fresh authorization nonce. */
  reconnect(): Promise<{ url: string }>;
}

/** Definition of one agent-facing tool. Registered with OpenClaw by the kernel, never by the gatekeeper. */
export interface GatekeeperToolDef {
  /** gk_<vendor>_<resource>_<verb> */
  name: string;
  /** Which SupportedResource.type it belongs to. */
  resourceType: string;
  /** Whether this tool reads or changes the external resource. */
  kind: "observation" | "action";
  /** NEVER mentions approvals, queues, caching, OAuth, or simulation. */
  description: string;
  /** Must include `grant: Type.String()`. */
  parameters: TSchema;
  /** Optional schema for structured agent-visible output. */
  outputSchema?: TSchema;
}

/** Top-level vendor entry. One per gatekeeper plugin. */
export interface GatekeeperVendor {
  /** Stable vendor namespace. */
  vendor: string;
  /** Version of the OS gatekeeper contract. */
  apiVersion: 1;
  /** Trusted authorization-server issuer for optional RFC 9207 callback `iss`; exact match, never a request-derived destination. */
  readonly oauthIssuer?: string;
  /** Describe this object without returning credentials. */
  describe(): Promise<{ title: string; description: string; icon?: string; autoProvisionsAccount?: boolean }>;
  /** Start OAuth (or equivalent). The returned URL must embed a cryptographic nonce. */
  connectAccount(operatorId: string, opts?: {
    resourceTypes?: string[];
    /** Kernel-minted callback nonce; preserve it as the authorization URL's exact state value. */
    state?: string;
    /** Fixed local callback path; resolve only against the vendor's configured public origin. */
    callbackPath?: string;
  }): Promise<{ url: string }>;
  /** Exchange a nonce-validated code for the bound operator. Keep credentials within the vendor;
   * preserve provider account/PKCE checks and store the result before resolving. The kernel never sees tokens. */
  completeConnection?(operatorId: string, opts: { code: string; state: string; resourceTypes?: string[] }): Promise<void>;
  /** For vendors that need no user auth (fs, mcp with static config). */
  createAccount?(operatorId: string): Promise<GatekeeperAccount>;
  /** Return this operator’s account, or null when disconnected. */
  getAccount(operatorId: string): Promise<GatekeeperAccount | null>;
  /** List the resource types supported by this account or vendor. */
  getSupportedResources(): Promise<SupportedResource[]>;
  /** Tool definitions for every tool this vendor exposes; the kernel registers them. */
  getTools(): Promise<GatekeeperToolDef[]>;
}
