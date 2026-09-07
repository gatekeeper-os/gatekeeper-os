/**
 * The kernel object (plan §5). One instance per Gateway process. TODO(phase-3): implement in the order given in §9 Phase 3:
 * store + migrations → registry → resolveGrant → tool registration → prompt narrowing + trusted policy → before_tool_call gate
 * with dry pass → os_* tools → URL introduction → audit → RPC → CLI → chat commands → egress → before_install → gatekeeper-fs.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatekeeperSession, Grant } from "@clawos/shared";
import type { GatewayMethodOptions, HookCtx, HookEvent, OpenClawPluginApi, OpenClawPluginServiceContext, PluginTrustedToolPolicyRegistration } from "./upstream/sdk.js";
import { Store } from "./store.js";
import { Registry } from "./registry.js";
import { AuditLog } from "./audit.js";
import { ApprovalQueueImpl } from "./approvals.js";
import { osPaths } from "./upstream/paths.js";

interface CallStash { agentId: string; sessionKey: string; runId?: string; session?: GatekeeperSession; expiresAt: number; }
type GatewayMethod = (opts: GatewayMethodOptions) => Promise<void> | void;
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export class Kernel {
  readonly paths = osPaths();
  readonly store = new Store(this.paths.sqlite);
  readonly registry = new Registry();
  readonly audit = new AuditLog(this.paths.auditDir);
  readonly approvals = new ApprovalQueueImpl(this.store, this.audit);
  private stash = new Map<string, CallStash>();

  constructor(private api: OpenClawPluginApi) {}

  async start() { this.store.migrate(); await this.registry.build(this.api); /* TODO(phase-3): maintenance flag, drainer */ }
  async stop() { await this.audit.flush(); }

  /**
   * THE enforcement chokepoint (plan §4.2). Every path that lets an agent reach a gatekeeper goes through here.
   * Reviewers flag any new path that mints or uses a gatekeeper session without it.
   */
  async resolveGrant(agentId: string, sessionKey: string, handle: string): Promise<{ grant: Grant; session: GatekeeperSession }> {
    const grant = this.store.getGrant(handle);
    if (!grant || grant.status !== "active") throw new Error("No such grant");
    if (grant.agentId !== agentId) throw new Error("Grant belongs to another agent");
    if (grant.scope !== "agent" && grant.scope !== `session:${sessionKey}`) throw new Error("Grant not valid in this session");
    const session = await this.registry.openSession(grant, this.approvals.forGrant(grant, sessionKey));
    return { grant, session };
  }

  /** Host-level rule: a gk_* call whose `grant` is not an active handle never executes, regardless of hook ordering. */
  capabilityPolicy(): PluginTrustedToolPolicyRegistration {
    const gkTools = this.registry.toolNames();
    return {
      id: "clawos-capability-policy",
      description: "Deny gatekeeper tool calls without an active grant handle.",
      ...(gkTools.length ? { matcher: gkTools as [string, ...string[]] } : {}),   // wildcards are invalid (VERIFIED); explicit ids or match-all
      evaluate: (event) => {
        if (!event.toolName.startsWith("gk_")) return;
        return this.store.isActiveHandle(event.params.grant) ? undefined : { block: true, blockReason: "No such grant" };
      },
    };
  }

  registerGatekeeperTools(_api: OpenClawPluginApi) { /* TODO(phase-3): for each registry tool def → api.registerTool({ …, execute: (id, p) => this.execGatekeeperTool(id, p) }) */ }
  gatewayMethods(): Array<[string, GatewayMethod]> {
    return [["os.status", async ({ respond }) => { respond(true, await this.status()); }]];
  }
  mountCli(_program: unknown) { /* TODO(phase-3): grants, approvals, gatekeepers, audit, status subcommands under `openclaw os` */ }
  oauthRouter(_req: IncomingMessage, _res: ServerResponse): boolean { return false; /* TODO(phase-4): /os/gatekeeper/<vendor>/oauth/* */ }
  startDrainer(_ctx: OpenClawPluginServiceContext) { /* TODO(phase-5) */ }
  stopDrainer() {}

  async onBeforeAgentRun(_e: HookEvent<"before_agent_run">, _ctx: HookCtx<"before_agent_run">) { /* TODO(phase-3): maintenance gate; URL introductions when e.senderIsOwner / operator list */ return undefined; }
  async onBeforePromptBuild(_e: HookEvent<"before_prompt_build">, _ctx: HookCtx<"before_prompt_build">) { /* TODO(phase-3): return { toolsAllow: […granted gk_* tools], appendContext: grantTable } */ return undefined; }
  async onBeforeToolCall(e: HookEvent<"before_tool_call">, ctx: HookCtx<"before_tool_call">) {
    if (!e.toolName.startsWith("gk_") && !e.toolName.startsWith("os_")) return undefined;
    const id = e.toolCallId;
    if (!id || !ctx.agentId || !ctx.sessionKey) return { block: true, blockReason: "missing call identity (fail closed)" };
    this.stash.set(id, { agentId: ctx.agentId, sessionKey: ctx.sessionKey, ...(ctx.runId ? { runId: ctx.runId } : {}), expiresAt: Date.now() + 1_800_000 });
    // TODO(phase-3): for gk_*: resolveGrant, audience check, dry pass → requireApproval when awaitDecision
    return {};
  }
  async onAfterToolCall(e: HookEvent<"after_tool_call">, _ctx: HookCtx<"after_tool_call">) { if (e.toolCallId) this.stash.delete(e.toolCallId); /* TODO: audit */ }
  async onBeforeAgentReply(_e: HookEvent<"before_agent_reply">, _ctx: HookCtx<"before_agent_reply">) { /* TODO(phase-5): claim /approvals, /approve, /reject, /grants, /grant */ return undefined; }
  async onMessageSending(_e: HookEvent<"message_sending">, _ctx: HookCtx<"message_sending">) { /* TODO(phase-3): egress denyPatterns */ return undefined; }
  async onBeforeInstall(_e: HookEvent<"before_install">, _ctx: HookCtx<"before_install">) { /* TODO(phase-3): allowSources / allowHashes; fail closed */ return undefined; }
  async onAgentEnd(_e: HookEvent<"agent_end">, _ctx: HookCtx<"agent_end">) { /* TODO: audit; drainer.kick */ }
  async onSessionEnd(_e: HookEvent<"session_end">, _ctx: HookCtx<"session_end">) { /* TODO: close sessions */ }

  async requestAccess(toolCallId: string, p: { url: string; reason: string }) {
    const s = this.stash.get(toolCallId); if (!s) throw new Error("fail closed: unknown tool call");
    // TODO(phase-3): record a pending introduction; notify operators
    return text(`Access requested for ${p.url}; you will be told when it is granted.`);
  }
  async listGrantsForCall(toolCallId: string) {
    const s = this.stash.get(toolCallId); if (!s) throw new Error("fail closed: unknown tool call");
    return text(JSON.stringify(this.store.listGrants(s.agentId).map((g) => ({ handle: g.handle, vendor: g.vendor, type: g.resourceType, title: g.title }))));
  }
  async status() { return { cell: process.env.CLAWOS_CELL ?? "default", healthy: true, maintenance: false, pendingApprovals: this.store.countPending() }; }
}
