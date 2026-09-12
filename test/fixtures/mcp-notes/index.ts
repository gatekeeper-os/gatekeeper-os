// Disposable-VM-only synthetic provider. Never packaged with gatekeeper-mcp.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { Type } from "typebox";
import { defineGatekeeper } from "@clawkeepers/gatekeeper-kit";
import { FixtureNotesServer, NotesFixture } from "../../../packages/gatekeeper-mcp/src/testing/notes-fixture.js";
import { proposedTools } from "../../../packages/gatekeeper-mcp/src/tools.js";
import { boundaryResource, denied } from "../../../packages/gatekeeper-mcp/src/manifest.js";
import { describeAppend } from "../../../packages/gatekeeper-mcp/src/server.js";
if (process.env.CLAWOS_KERNEL_VM !== "1" || process.env.OPENCLAW_STATE_DIR !== "/home/tester/.openclaw-kernel-test" || process.cwd() !== "/home/tester/src") throw denied();
const resource = { ...boundaryResource("demo"), tools: proposedTools.map(tool => tool.name) };
const evidence = "/home/tester/phase-8-boundary-evidence/fixture-provider.json";
class Provider extends NotesFixture {
  override append(text: string) { super.append(text); this.save(); }
  save() { writeFileSync(evidence, JSON.stringify({ synthetic: true, nativeExecution: false, effects: this.effects, revision: this.revision }), { mode: 0o600 }); }
}
export default defineGatekeeper({
  id: "gatekeeper-mcp", vendor: "mcp", apiVersion: 1, name: "VM-only synthetic notes",
  description: "Disposable synthetic notes fixture, not a real MCP provider.", resources: [resource],
  tools: proposedTools.map(tool => ({ name: tool.name, resourceType: tool.resourceType, kind: tool.kind, description: tool.description, parameters: Type.Unsafe(structuredClone(tool.parameters)) })),
  actions: { gk_mcp_demo_append_note: { describe: p => ({ ...describeAppend(p), awaitDecision: false }) } },
  createVendor: ctx => {
    const provider = new Provider(); provider.save(); let active = true;
    const live = () => { if (!active) throw denied(); };
    const server = new FixtureNotesServer(provider, live, join(ctx.stateDir, "os", "mcp-fixture"));
    const account = { describe: async () => ({ displayName: "synthetic fixture" }), getSupportedResources: async () => [resource],
      getGatekeeperFor: async (url: string) => { live(); if (url !== resource.urlPattern) throw denied(); return { gatekeeper: server, resource, resourceKey: url }; },
      getVerifier: async () => { throw denied(); }, reconnect: async () => { throw denied(); }, revoke: async () => { active = false; } };
    return { vendor: "mcp", apiVersion: 1, describe: async () => ({ title: "Synthetic notes", description: "VM fixture", autoProvisionsAccount: true }),
      getTools: async () => [], getSupportedResources: async () => [resource], connectAccount: async () => { throw denied(); },
      createAccount: async () => account, getAccount: async () => account };
  },
});
