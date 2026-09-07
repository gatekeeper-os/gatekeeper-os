import { existsSync } from "node:fs";
import { join } from "node:path";
import { osPaths } from "../../src/upstream/paths.js";

export default function handler(event: { context: any; sessionKey?: string }): void {
  const agentId = event.context?.agentId; if (!agentId) return;
  const readme = join(osPaths().os, "blueprints", agentId, "README.md");
  if (existsSync(readme) && Array.isArray(event.context?.bootstrapFiles)) event.context.bootstrapFiles.push(readme);
}
