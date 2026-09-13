import { join } from "node:path";
import { Value } from "typebox/value";
import { CacheMutationStore, KitGatekeeper, OverlayStore } from "@gatekeeper-os/gatekeeper-kit";
import type { ActionDescription, ApprovalQueue, GatekeeperSession } from "@gatekeeper-os/shared";
import { boundaryResource, denied } from "./manifest.js";
import { proposedTools } from "./tools.js";

/** Only explicitly projected, bounded note fields are eligible for cache or tool output. */
export interface Note { noteId: string; text: string; revision: number; truncated: boolean; }
/** Reject mismatched identities, malformed revisions and non-text payloads; never follow resource links. */
export function projectNote(value: unknown, noteId: string): Note {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw denied();
  const v = value as Record<string, unknown>;
  if (v.noteId !== noteId || typeof v.text !== "string" || v.text.length > 65536 || !Number.isSafeInteger(v.revision) || (v.revision as number) < 0) throw denied();
  return { noteId, text: v.text.slice(0, 8192), revision: v.revision as number, truncated: v.text.length > 8192 };
}
/** Pure generic append policy. No deterministic simulation or vendor undo can be inferred. */
export function describeAppend(params: Record<string, unknown>): ActionDescription {
  const def = proposedTools.find(tool => tool.kind === "action")!;
  if (!Value.Check(def.parameters, params)) throw denied();
  return { title: "Append note text", description: "Append the supplied text to this note. Native application is unavailable pending secrecy acceptance.",
    preview: { noteId: params.noteId, characters: (params.text as string).length },
    actionKind: { tag: "mcp.demo.append", label: "Append note text" }, awaitDecision: true, autoApprovable: false, implementsRevert: false };
}
const observation = () => ({ title: "Read note", description: "Read one note within the bound private server.", prohibitAllSharing: true });
/** Private-only reviewed read resource. Native append is absent from the active resource and always fails closed. */
export class McpServer extends KitGatekeeper {
  resource = boundaryResource("demo");
  protected overlay: OverlayStore;
  private readonly cache: CacheMutationStore<Note | null>;
  constructor(protected readonly live: () => void, private readonly fetchNote: (id: string) => Promise<unknown>, statePath?: string) {
    super(statePath ? join(statePath, "actions.json") : undefined);
    this.overlay = new OverlayStore(statePath ? join(statePath, "overlay.json") : undefined);
    this.cache = new CacheMutationStore<Note | null>(null, {}, statePath ? join(statePath, "cache", "latest.json") : undefined);
    this.observations = { gk_mcp_demo_read_note: { describe: () => observation(), read: async p => {
      this.live();
      const raw = await this.fetchNote(p.noteId as string); this.live();
      const note = projectNote(raw, p.noteId as string);
      // Refresh on every read. A failed refresh never returns stale content; only one bounded note is retained.
      this.cache.refresh(note);
      return this.view(note);
    } } };
    this.actions = { gk_mcp_demo_append_note: { describe: describeAppend, apply: async () => { throw denied(); } } };
  }
  /** Production has no speculative changes; a deterministic test adapter may overlay its own reviewed effects. */
  protected view(note: Note): Note { return note; }
  override async describe() { this.live(); return { resource: structuredClone(this.resource), title: "MCP server", suggestedName: "MCP" }; }
  override async getAutoApprovableActions() { this.live(); return []; }
  override async startSession(queue: ApprovalQueue): Promise<GatekeeperSession> {
    this.live(); const session = await super.startSession(queue);
    return { close: () => session.close(), call: async (tool, params, ctx) => {
      try {
        this.live();
        const def = proposedTools.find(item => item.name === tool);
        if (!def || !Value.Check(def.parameters, params)) throw denied();
        const result = await session.call(tool, params, ctx); this.live();
        if (!ctx.dryRun && def.kind === "observation") { await queue.authorizeObservation(observation()); this.live(); }
        return result;
      } catch { throw denied(); }
    } };
  }
  override async applyAction(_id: number): Promise<void> { this.live(); throw denied(); }
  override async rejectAction(id: number): Promise<void> { this.live(); await super.rejectAction(id); this.live(); }
  override async revertAction(_id: number): Promise<void> { this.live(); throw denied(); }
}
