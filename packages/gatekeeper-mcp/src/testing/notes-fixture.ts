// TEST ONLY: not imported by the runtime entrypoint or emitted in its bundle.
import { KitGatekeeper } from "@clawos/gatekeeper-kit";
import { McpServer, describeAppend, type Note } from "../server.js";
import { proposedTools } from "../tools.js";

/** In-memory synthetic provider, not an actual MCP server or native execution path. */
export class NotesFixture {
  text = "fixture-base";
  revision = 1;
  effects = 0;
  failAfterEffect = false;
  read(id: string) { return { noteId: id, text: this.text, revision: this.revision }; }
  append(text: string) {
    this.effects++; this.text += text; this.revision++;
    if (this.failAfterEffect) throw new Error("synthetic-private-error-body");
  }
}
/** Deterministic append semantics solely for deferred-path tests; no production/config switch selects this adapter. */
export class FixtureNotesServer extends McpServer {
  constructor(readonly provider: NotesFixture, live: () => void, statePath: string) {
    super(live, async id => provider.read(id), statePath);
    this.resource.tools = proposedTools.map(tool => tool.name);
    this.actions = { gk_mcp_demo_append_note: {
      describe: params => ({ ...describeAppend(params), description: "Append text to the synthetic note.", awaitDecision: false }),
      simulate: (params, overlay, actionId) => {
        overlay.add({ actionId, kind: "fixture-append", payload: { noteId: params.noteId, text: params.text } });
        const note = this.view({ ...provider.read(params.noteId as string), truncated: false });
        return { noteId: note.noteId, revision: note.revision, appended: true };
      },
      apply: async params => { this.live(); provider.append(params.text as string); this.live(); },
    } };
  }
  protected override view(note: Note): Note {
    return this.overlay.applyTo(note, { "fixture-append": (value, entry) => {
      const p = entry.payload as { noteId: string; text: string };
      if (p.noteId !== value.noteId) return value;
      const text = value.text + p.text;
      return { ...value, text: text.slice(0, 8192), revision: value.revision + 1, truncated: value.truncated || text.length > 8192 };
    } });
  }
  override async applyAction(id: number): Promise<void> {
    this.live(); await KitGatekeeper.prototype.applyAction.call(this, id); this.live();
  }
}
