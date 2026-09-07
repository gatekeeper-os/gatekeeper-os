// OpenClaw OS kernel plugin entry (plan §5.1). Every SDK shape used here type-checks against openclaw@2026.9.2.
import { Type } from "typebox";
import { buildJsonPluginConfigSchema, definePluginEntry } from "./upstream/sdk.js";
import { schema as configSchemaJson } from "./config-schema.js";
import { Kernel } from "./kernel.js";

export default definePluginEntry({
  id: "clawos-kernel",
  name: "OpenClaw OS Kernel",
  description: "Capability model, gatekeeper registry, approval queue, and audit for OpenClaw OS.",
  configSchema: buildJsonPluginConfigSchema(configSchemaJson),
  register(api) {
    if (api.registrationMode !== "full") return; // no runtime in setup-only / cli-metadata modes (VERIFIED)
    const kernel = new Kernel(api);

    // lifecycle
    api.on("gateway_start", () => kernel.start());
    api.on("gateway_stop", () => kernel.stop()); // 5 s budget (VERIFIED)

    // host-level capability policy: deny any gk_* call whose grant handle is not active (plan §5.2).
    // NOTE (VERIFIED 2026.9.2): `matcher` is a list of canonical tool ids — wildcards are invalid — so the kernel passes the
    // explicit gk_* tool list from its catalog, or omits the matcher and filters by name inside the handler.
    api.registerTrustedToolPolicy(kernel.capabilityPolicy());

    // policy pipeline (hook names and result shapes VERIFIED against the SDK types)
    api.on("before_agent_run", (e, ctx) => kernel.onBeforeAgentRun(e, ctx), { priority: 1000 });
    api.on("before_prompt_build", (e, ctx) => kernel.onBeforePromptBuild(e, ctx), { priority: 1000, requiresToolAuthority: true });
    api.on("before_tool_call", (e, ctx) => kernel.onBeforeToolCall(e, ctx), { priority: 1000, timeoutMs: 10_000 });
    api.on("after_tool_call", (e, ctx) => kernel.onAfterToolCall(e, ctx));
    api.on("before_agent_reply", (e, ctx) => kernel.onBeforeAgentReply(e, ctx));
    api.on("message_sending", (e, ctx) => kernel.onMessageSending(e, ctx));
    api.on("before_install", (e, ctx) => kernel.onBeforeInstall(e, ctx));
    api.on("agent_end", (e, ctx) => kernel.onAgentEnd(e, ctx));
    api.on("session_end", (e, ctx) => kernel.onSessionEnd(e, ctx));

    // the only two agent-facing kernel tools. execute(toolCallId, params, signal?, onUpdate?) — no ctx argument (VERIFIED);
    // identity comes from the before_tool_call stash keyed by toolCallId; fail closed if absent.
    api.registerTool({
      name: "os_request_access",
      label: "Request access",
      description: "Ask the operator for access to a resource by URL.",
      parameters: Type.Object({ url: Type.String(), reason: Type.String() }),
      execute: (toolCallId, params) => kernel.requestAccess(toolCallId, params as { url: string; reason: string }),
    });
    api.registerTool({
      name: "os_list_grants",
      label: "List grants",
      description: "List the resources you currently have access to.",
      parameters: Type.Object({}),
      execute: (toolCallId) => kernel.listGrantsForCall(toolCallId),
    });

    // gatekeeper tools are registered by the kernel on behalf of each gatekeeper (plan §4.3)
    kernel.registerGatekeeperTools(api);

    // operator surfaces (shapes VERIFIED 2026.9.2)
    for (const [name, handler] of kernel.gatewayMethods()) api.registerGatewayMethod(name, handler, { profileAccess: "required" });
    api.registerHttpRoute({ path: "/os/gatekeeper/", match: "prefix", auth: "plugin", handler: (req, res) => kernel.oauthRouter(req, res) });
    api.registerCli(({ program }) => kernel.mountCli(program), { commands: ["os"] });
    api.registerService({ id: "clawos-drainer", start: (ctx) => kernel.startDrainer(ctx), stop: () => kernel.stopDrainer() });
  },
});
