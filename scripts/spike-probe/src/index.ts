// @ts-nocheck — throwaway probe: we are measuring runtime shapes, not proving types.
// Spike S-1 probe. Each probe writes a line to <stateDir>/os/spike-S1.jsonl. See plans/spike-S1.md for the questions.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const out = join(process.env.OPENCLAW_STATE_DIR ?? join(homedir(), process.env.OPENCLAW_PROFILE ? `.openclaw-${process.env.OPENCLAW_PROFILE}` : ".openclaw"), "os");
mkdirSync(out, { recursive: true });
const rec = (q: string, data: unknown) => appendFileSync(join(out, "spike-S1.jsonl"), JSON.stringify({ q, ts: new Date().toISOString(), data }) + "\n");

export default definePluginEntry({
  id: "spike-probe", name: "Spike Probe", description: "Answers spike S-1 questions empirically.",
  register(api) {
    rec("registrationMode", api.registrationMode);
    rec("api-keys", Object.keys(api));                                                     // j: what does api expose?
    api.registerTool({ name: "probe_echo", description: "Echo.", parameters: Type.Object({ x: Type.String() }),
      execute: (...args: unknown[]) => { rec("f:execute-args", args.map((a) => typeof a)); return { content: [{ type: "text", text: String((args[1] as any)?.x) }] }; } });
    api.on("before_tool_call", (e: any, ctx: any) => { rec("f:before_tool_call", { hasToolCallId: !!e?.toolCallId, eKeys: Object.keys(e ?? {}), ctxKeys: Object.keys(ctx ?? {}) }); return {}; }, { matcher: ["probe_echo"] });
    api.on("llm_input", (e: any) => { rec("e:llm_input-tools", (e?.tools ?? e?.request?.tools ?? []).map((t: any) => t?.name)); });
    api.on("gateway_start", () => {
      try { api.registerTool({ name: "probe_late", description: "Late.", parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "late" }] }) }); rec("i:late-register", "ok"); }
      catch (err) { rec("i:late-register", String(err)); }
      try { const { DatabaseSync } = require("node:sqlite"); new DatabaseSync(join(out, "probe.sqlite")).exec("CREATE TABLE IF NOT EXISTS t(x)"); rec("h:sqlite", "ok"); } catch (err) { rec("h:sqlite", String(err)); }
    });
    api.registerGatewayMethod("os-spike.report", async (params: unknown, ctx: unknown) => { rec("g:gateway-method-ctx", Object.keys((ctx as object) ?? {})); return { ok: true }; }, { profileAccess: "independent" });
    api.registerCli(({ program }: any) => { rec("l:program-type", program?.constructor?.name); }, { commands: ["spike"] });
  },
});
