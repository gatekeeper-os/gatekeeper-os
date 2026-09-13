import { defineGatekeeper } from "@gatekeeper-os/gatekeeper-kit";
import { boundaryResource } from "./manifest.js";
import { mcpTools } from "./tools.js";
import { McpVendor } from "./vendor.js";
/** Approved STOP2 read-only runtime; generic native effects remain gated. */
export default defineGatekeeper({
  id: "gkos-gatekeeper-mcp", vendor: "mcp", apiVersion: 1, name: "MCP Gatekeeper",
  description: "Mediates explicitly configured MCP server introductions.",
  resources: [boundaryResource("demo")], tools: mcpTools, createVendor: ctx => new McpVendor(ctx),
});
