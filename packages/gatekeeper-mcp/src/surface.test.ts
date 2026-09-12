import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { proposedToolName, proposedTools } from "./tools.js";
import { proposedResourceUrl, parseProposedResourceUrl, proposedResources } from "./resources.js";
it("binds every example to a closed grant-bearing schema and one server", () => {
  expect(proposedResources[0].tools).toEqual(proposedTools.map(t => t.name));
  for (const tool of proposedTools) {
    expect(tool.name.length).toBeLessThanOrEqual(64);
    expect(tool.parameters.required).toContain("grant");
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.resourceType).toBe("server_demo");
    expect(tool.description).not.toMatch(/approv|oauth|cache|queue|simulat/i);
    for (const key of ["url", "endpoint", "headers", "token", "command", "tool"]) expect(tool.parameters.properties).not.toHaveProperty(key);
  }
});
it.each(["../demo", "demo/", "demo?token=x", "demo#x", "demo%2fextra", "Demo", "", "demo/../demo", "demo%00", "demo:443", "demo\n"])("rejects ambiguous resource suffix %j", suffix => {
  expect(() => parseProposedResourceUrl("https://mcp.clawkeeper.invalid/servers/" + suffix, ["demo"])).toThrow();
});
it("rejects alternate origin/userinfo and unconfigured resources", () => {
  for (const url of ["http://mcp.clawkeeper.invalid/servers/demo", "https://mcp.clawkeeper.invalid:443/servers/demo", "https://user@mcp.clawkeeper.invalid/servers/demo", "https://evil.invalid/servers/demo"]) expect(() => parseProposedResourceUrl(url, ["demo"])).toThrow();
  expect(() => parseProposedResourceUrl(proposedResourceUrl("other"), ["demo"])).toThrow();
  expect(parseProposedResourceUrl(proposedResourceUrl("demo"), ["demo"])).toBe("demo");
});
it("does not collapse namespaces or accept remote tool strings as names", () => {
  expect(proposedToolName("demo", "read_note")).toBe("gk_mcp_demo_read_note");
  for (const [server, alias] of [["a_b", "c"], ["demo", "notes.get"], ["demo", "../call"], ["demo", "x".repeat(33)]]) expect(() => proposedToolName(server!, alias!)).toThrow();
});
it("keeps all tool execution disabled at STOP2", () => {
  const entry=readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const manifest=JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
  expect(entry).toContain("defineGatekeeper");expect(entry).not.toContain("registerTool");
  expect(manifest.contracts.tools).toEqual([]);expect(manifest.activation.onStartup).toBe(true);
});
