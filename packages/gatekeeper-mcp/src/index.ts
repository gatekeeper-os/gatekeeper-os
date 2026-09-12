import { defineGatekeeper } from "@clawos/gatekeeper-kit";
import { McpVendor } from "./vendor.js";
/** STOP2 boundary: opt-in control-plane lifecycle only; no model tools or effects. */
export default defineGatekeeper({
  id: "gatekeeper-mcp", vendor: "mcp", apiVersion: 1, name: "MCP Gatekeeper",
  description: "Mediates explicitly configured MCP server introductions.",
  resources: [], tools: [], createVendor: ctx => new McpVendor(ctx),
});
