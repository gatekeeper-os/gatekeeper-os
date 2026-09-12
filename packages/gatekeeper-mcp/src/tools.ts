import { Type } from "typebox";
import type { GatekeeperToolDef } from "@clawos/shared";
/** Operator-reviewed metadata; append remains excluded from runtime registration. */
export interface ProposedMcpTool {
  readonly name: string;
  readonly upstreamName: string;
  readonly resourceType: string;
  readonly kind: "observation" | "action";
  readonly description: string;
  readonly parameters: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    readonly required: readonly string[];
  };
}
/** Reviewed aliases, not remotely discovered names, determine agent-facing names. */
export function proposedToolName(server: string, alias: string): string {
  if (!/^[a-z][a-z0-9]{0,15}$/.test(server) || !/^[a-z][a-z0-9_]{0,31}$/.test(alias)) throw new Error("Invalid MCP tool identity.");
  return `gk_mcp_${server}_${alias}`;
}
/** Synthetic notes server exemplifies the exact proposed manifest expansion; not a real provider integration. */
export const proposedTools: readonly ProposedMcpTool[] = [
  {
    name: proposedToolName("demo", "read_note"), upstreamName: "notes.get", resourceType: "server_demo", kind: "observation",
    description: "Read one note from this server.",
    parameters: { type: "object", additionalProperties: false, properties: {
      grant: { type: "string", pattern: "^grant:[a-z0-9]{8}$" },
      noteId: { type: "string", minLength: 1, maxLength: 128, pattern: "^[a-zA-Z0-9_-]+$" },
    }, required: ["grant", "noteId"] },
  },
  {
    name: proposedToolName("demo", "append_note"), upstreamName: "notes.append", resourceType: "server_demo", kind: "action",
    description: "Append text to one note on this server.",
    parameters: { type: "object", additionalProperties: false, properties: {
      grant: { type: "string", pattern: "^grant:[a-z0-9]{8}$" },
      noteId: { type: "string", minLength: 1, maxLength: 128, pattern: "^[a-zA-Z0-9_-]+$" },
      text: { type: "string", minLength: 1, maxLength: 8192 },
    }, required: ["grant", "noteId", "text"] },
  },
];

/** Runtime publishes only the approved observation until native secrecy acceptance is restored. */
export const mcpTools: GatekeeperToolDef[] = proposedTools.filter(tool => tool.kind === "observation").map(tool => ({
  name: tool.name, resourceType: tool.resourceType, kind: tool.kind, description: tool.description,
  parameters: Type.Unsafe(structuredClone(tool.parameters)),
  outputSchema: Type.Object({ noteId: Type.String({ minLength: 1, maxLength: 128 }), text: Type.String({ maxLength: 8192 }), revision: Type.Integer({ minimum: 0 }), truncated: Type.Boolean() }, { additionalProperties: false }),
}));
