/** STOP1-only logical resource identifiers: these URLs are never network destinations. */
export const proposedResourcePattern = "https://mcp.clawkeeper.invalid/servers/:server";
/** Operator-assigned identifier has no endpoint, credentials, or discovery authority. */
export function proposedResourceUrl(server: string): string {
  if (!/^[a-z][a-z0-9]{0,15}$/.test(server)) throw new Error("Invalid MCP server identity.");
  return `https://mcp.clawkeeper.invalid/servers/${server}`;
}
/** Accept only an exact known identifier; reject URL normalization ambiguities. No I/O. */
export function parseProposedResourceUrl(raw: string, knownServers: readonly string[]): string {
  const prefix = "https://mcp.clawkeeper.invalid/servers/";
  if (!raw.startsWith(prefix)) throw new Error("Unknown MCP resource.");
  const server = raw.slice(prefix.length);
  if (proposedResourceUrl(server) !== raw || !knownServers.includes(server)) throw new Error("Unknown MCP resource.");
  return server;
}
/** One owner-only server grant covers only that server's reviewed tool subset. */
export const proposedResources = [{
  type: "server_demo", urlPattern: proposedResourceUrl("demo"), title: "Demo notes server",
  description: "Read and append notes using this server's defined operations.",
  grantable: true, observerStrategy: "private-only",
  tools: ["gk_mcp_demo_read_note", "gk_mcp_demo_append_note"],
}] as const;
