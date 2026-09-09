/** Resolve host-delivered channel turns and authenticated Control UI turns. */
import { resolveCommandAuthorization } from "openclaw/plugin-sdk/command-auth";
import { resolveSessionAgentIdStrict } from "openclaw/plugin-sdk/agent-scope-runtime";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import type { HookCtx, HookEvent } from "./sdk.js";

/** Proven channel requester and routed target, extracted before prompt construction. */
export interface ChannelTurnAuthority {
  channel: string;
  senderId: string;
  senderIsOwner: boolean;
  agentId: string;
  sessionKey: string;
  text: string;
}

/** Use upstream's public owner resolver on its finalized ingress context, never prompt text. */
export function resolveChannelTurnAuthority(event: HookEvent<"reply_dispatch">, context: HookCtx<"reply_dispatch">): ChannelTurnAuthority | undefined {
  const inbound = event.ctx;
  const channel = inbound.Provider;
  const sessionKey = event.sessionKey;
  // A client-supplied origin/sender label is not a channel admission. External
  // channels must never carry Gateway scopes; the authenticated Control UI is
  // admitted separately below from host-owned admin scope + device identity.
  if (context.dispatchKind !== "agent" || event.isTailDispatch || context.abortSignal?.aborted ||
      !channel || inbound.InternalTurnSource || inbound.InputProvenance ||
      typeof inbound.commandText !== "string" || !sessionKey || inbound.SessionKey !== sessionKey) return;
  // Even the strict resolver may select a configured default for unscoped keys.
  // Require an explicit routed target or a canonical agent key before calling it.
  if (!inbound.AgentId?.trim() && !parseAgentSessionKey(sessionKey)?.agentId) return;
  if (channel !== "webchat" && (inbound.GatewayClientScopes !== undefined || !inbound.SenderId)) return;
  try {
    if (channel === "webchat") {
      // Upstream intentionally omits SenderId for operator-UI clients. The
      // gateway attaches the authenticated device and its effective scopes;
      // sender-based command authorization is inapplicable on this path.
      if (inbound.SenderId || !inbound.ApprovalReviewerDeviceId?.trim() ||
          !inbound.GatewayClientScopes?.includes("operator.admin")) return;
      const agentId = resolveSessionAgentIdStrict({ sessionKey, config: context.cfg, ...(inbound.AgentId ? { agentId: inbound.AgentId } : {}) });
      if (inbound.AgentId && agentId !== inbound.AgentId) return;
      return { channel, senderId: `gateway-device:${inbound.ApprovalReviewerDeviceId}`, senderIsOwner: true,
        agentId, sessionKey, text: inbound.commandText };
    }
    const authorization = resolveCommandAuthorization({
      ctx: inbound, cfg: context.cfg, commandAuthorized: inbound.CommandAuthorized === true,
    });
    const senderId = inbound.SenderId;
    if (!senderId) return;
    // Reject ambiguous cross-provider identity resolution and fallback sender identities.
    if (authorization.providerId !== channel || authorization.senderId !== senderId) return;
    const agentId = resolveSessionAgentIdStrict({ sessionKey, config: context.cfg, ...(inbound.AgentId ? { agentId: inbound.AgentId } : {}) });
    if (inbound.AgentId && agentId !== inbound.AgentId) return;
    return { channel, senderId, senderIsOwner: authorization.senderIsOwner === true,
      agentId, sessionKey, text: inbound.commandText };
  } catch { return; }
}
