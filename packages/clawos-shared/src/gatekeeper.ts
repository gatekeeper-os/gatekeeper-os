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
  title: string;
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
  tag: string;
  label: string;
}

/** Description of a side-effecting action, submitted before it is performed. */
export interface ActionDescription {
  title: string;
  description: string;
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
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
}

/** Per-call context supplied by the kernel from its before_tool_call stash (plan §5.2). */
export interface SessionCallContext {
  agentId: string;
  sessionKey: string;
  runId?: string;
  toolCallId?: string;
  queue: ApprovalQueue;
  /** Present when the session has observers beyond its owner. */
  observers?: string[];
  /** True during the kernel's dry pass: return the description, perform no side effects. */
  dryRun?: boolean;
}

/** One live binding of (grant → gatekeeper resource) inside one agent session. */
export interface GatekeeperSession {
  /** Execute a tool of this resource type. `params` were validated against the tool schema by OpenClaw. */
  call(tool: string, params: Record<string, unknown>, ctx: SessionCallContext): Promise<ToolResult | DryRunResult>;
  close(): Promise<void>;
}

/** What a dry pass returns: the description the kernel needs to decide before the real call. */
export type DryRunResult =
  | { kind: "observation"; description: ObservationDescription }
  | { kind: "action"; description: ActionDescription };

/** Opaque to everyone but the gatekeeper that minted it. */
export interface ObserverVerifier {
  readonly vendor: string;
  readonly opaque: string;
}

/** Per-resource instance. Created by the kernel through resolveGrant(). */
export interface Gatekeeper {
  describe(): Promise<{ resource: SupportedResource; title: string; suggestedName: string }>;
  getAutoApprovableActions(): Promise<ActionKind[]>;
  startSession(queue: ApprovalQueue): Promise<GatekeeperSession>;
  /** Perform a previously submitted action for real. Idempotent. */
  applyAction(actionId: number): Promise<void>;
  /** Discard a pending action and its simulated effects. */
  rejectAction(actionId: number): Promise<void | { restart?: boolean }>;
  /** Undo an applied action if implementsRevert. */
  revertAction?(actionId: number): Promise<void | { message?: string; canRetry?: boolean }>;
  /** Throw if this observer may not see everything this instance has read. */
  addObserver(id: string, verifier: ObserverVerifier): Promise<void>;
  removeObserver(id: string): Promise<void>;
}

/** Per-operator account (one OAuth identity or static credential). */
export interface GatekeeperAccount {
  describe(): Promise<{ email?: string; displayName?: string; expiresAt?: number }>;
  getSupportedResources(): Promise<SupportedResource[]>;
  /** Returns a Gatekeeper for the resource a URL denotes, with credentials bound. Called BEFORE any grant exists. */
  getGatekeeperFor(url: string): Promise<{ gatekeeper: Gatekeeper; resource: SupportedResource; resourceKey: string }>;
  /** Mint an opaque verifier that proves *this account's* access, for observer checks. */
  getVerifier(): Promise<ObserverVerifier>;
  revoke(): Promise<void>;
  reconnect(): Promise<{ url: string }>;
}

/** Definition of one agent-facing tool. Registered with OpenClaw by the kernel, never by the gatekeeper. */
export interface GatekeeperToolDef {
  /** gk_<vendor>_<resource>_<verb> */
  name: string;
  /** Which SupportedResource.type it belongs to. */
  resourceType: string;
  kind: "observation" | "action";
  /** NEVER mentions approvals, queues, caching, OAuth, or simulation. */
  description: string;
  /** Must include `grant: Type.String()`. */
  parameters: TSchema;
  outputSchema?: TSchema;
}

/** Top-level vendor entry. One per gatekeeper plugin. */
export interface GatekeeperVendor {
  vendor: string;
  apiVersion: 1;
  describe(): Promise<{ title: string; description: string; icon?: string; autoProvisionsAccount?: boolean }>;
  /** Start OAuth (or equivalent). The returned URL must embed a cryptographic nonce. */
  connectAccount(operatorId: string, opts?: { resourceTypes?: string[] }): Promise<{ url: string }>;
  /** For vendors that need no user auth (fs, mcp with static config). */
  createAccount?(operatorId: string): Promise<GatekeeperAccount>;
  getAccount(operatorId: string): Promise<GatekeeperAccount | null>;
  getSupportedResources(): Promise<SupportedResource[]>;
  /** Tool definitions for every tool this vendor exposes; the kernel registers them. */
  getTools(): Promise<GatekeeperToolDef[]>;
}
