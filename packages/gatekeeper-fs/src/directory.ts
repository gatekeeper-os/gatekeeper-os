import { join } from "node:path";
import { Value } from "typebox/value";
import type { ActionDescription, ApprovalQueue, GatekeeperSession, ObservationDescription } from "@clawkeepers/shared";
import { KitGatekeeper, OverlayStore } from "@clawkeepers/gatekeeper-kit";
import { DirectoryBinding, denied } from "./paths.js";
import { fsResources } from "./resources.js";
import { fsTools } from "./tools.js";
import { ConfinedIO, relativePath, textBytes, type FileSnapshot } from "./io.js";
import { privateDirectory, readState, writeState } from "./state.js";

interface Effect { path: string; content: string; baseline: string | null; }
const observation = (title: string): ObservationDescription => ({ title, description: "Read within the bound directory.", prohibitAllSharing: true });
/** Pure description: no host reads, action allocation, state writes, or content in the preview. */
export function describeWrite(p: Record<string, unknown>): ActionDescription {
  const path = relativePath(p.path), bytes = textBytes(p.content).length;
  return { title: "Write text file", description: "Write text within the bound directory. Host application is currently unavailable because atomic path and external-edit protection cannot be guaranteed.",
    implementsRevert: false, autoApprovable: false, awaitDecision: false, preview: { path, bytes } };
}

/** Bound private-only resource with fresh confined observations and persistent pending effects. Host application denies. */
export class FsDirectory extends KitGatekeeper {
  resource = structuredClone(fsResources[0]!);
  protected overlay: OverlayStore;
  private readonly io: ConfinedIO;
  constructor(private readonly binding: DirectoryBinding, private readonly accountLive: () => void, private readonly stateDir: string) {
    super(join(privateDirectory(stateDir), "actions.json"));
    this.overlay = new OverlayStore(join(stateDir, "overlay.json"));
    this.io = new ConfinedIO(binding);
    this.observations = {
      gk_fs_dir_list: { describe: () => observation("List directory"), read: async p => this.list(p.subpath) },
      gk_fs_file_read: { describe: () => observation("Read text file"), read: async p => this.read(relativePath(p.path)) },
    };
    this.actions = { gk_fs_file_write: {
      describe: describeWrite,
      simulate: async (p, overlay, id) => {
        this.live();
        const path = relativePath(p.path), content = textBytes(p.content).toString("utf8");
        // A baseline read is for conflict tracking only. It is never returned by the write.
        const effectPath = join(this.stateDir, `effect-${id}.json`), recovered = readState(effectPath);
        if (recovered !== undefined) {
          if (!recovered || typeof recovered !== "object" || !("path" in recovered) || !("content" in recovered) ||
            recovered.path !== path || recovered.content !== content) throw denied();
          overlay.add({ actionId: id, kind: "fs.write", payload: recovered });
          return { path, bytes: Buffer.byteLength(content) };
        }
        const original = this.refresh(path);
        const earlier = this.effects().filter(effect => effect.path === path).at(-1);
        const effect: Effect = { path, content, baseline: earlier?.baseline ?? original?.stamp ?? null };
        writeState(effectPath, effect);
        overlay.add({ actionId: id, kind: "fs.write", payload: effect });
        return { path, bytes: Buffer.byteLength(content) };
      },
      apply: async () => { throw denied(); },
    } };
  }
  private live(): void { this.accountLive(); this.binding.assertCurrent(); }
  /** Revalidate bound identity; no contents in metadata. */
  override async describe() {
    this.live();
    return { resource: structuredClone(this.resource), title: "Directory", suggestedName: "DIRECTORY" };
  }
  private effects(): Effect[] {
    return this.overlay.list().map(entry => {
      if (entry.kind !== "fs.write" || !entry.payload || typeof entry.payload !== "object") throw denied();
      const effect = entry.payload as Effect;
      relativePath(effect.path); textBytes(effect.content);
      if (effect.baseline !== null && typeof effect.baseline !== "string") throw denied();
      return effect;
    });
  }
  private refresh(path: string): FileSnapshot | null {
    this.live();
    const current = this.io.read(path);
    // The cache never excuses a missing/stale/symlink identity check. Revalidate the
    // authoritative file every read; persisted contents are only reused for an exact stamp.
    const cachePath = join(this.stateDir, "cache.json"), stored = readState(cachePath);
    let cached: { path: string; value: FileSnapshot | null } | undefined;
    if (stored !== undefined) {
      if (!stored || typeof stored !== "object" || !("path" in stored) || !("value" in stored)) throw denied();
      cached = stored as { path: string; value: FileSnapshot | null };
    }
    if (cached?.path !== path || JSON.stringify(cached.value) !== JSON.stringify(current)) writeState(cachePath, { path, value: current });
    return current;
  }
  private read(path: string) {
    this.live();
    const current = this.refresh(path), pending = this.effects().filter(effect => effect.path === path).at(-1);
    if (!pending && !current) throw denied();
    return { path, content: pending ? pending.content : current!.content };
  }
  private list(raw: unknown) {
    this.live();
    const subpath = raw === undefined ? undefined : relativePath(raw);
    const entries = new Map(this.io.list(subpath).map(entry => [entry.name, entry]));
    for (const effect of this.effects()) {
      const parts = effect.path.split("/"), name = parts.pop()!;
      if (parts.join("/") !== (subpath ?? "")) continue;
      if (entries.has(name) && entries.get(name)!.kind !== "file") throw denied();
      entries.set(name, { name, kind: "file" });
    }
    if (entries.size > 1000) throw denied();
    return { entries: [...entries.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0) };
  }
  /** No automatic filesystem write policy is offered. */
  override async getAutoApprovableActions() { this.live(); return []; }
  /** Queue authority is supplied only by kernel resolveGrant; sessions recheck liveness and closed schemas on every call. */
  override async startSession(queue: ApprovalQueue): Promise<GatekeeperSession> {
    this.live();
    const session = await super.startSession(queue);
    return { close: () => session.close(), call: async (tool, params, ctx) => {
      this.live();
      const definition = fsTools.find(def => def.name === tool);
      if (!definition || !Value.Check(definition.parameters, params)) throw denied();
      const value = await session.call(tool, params, ctx);
      this.live();
      // The final awaited check prevents a revocation during a read from releasing data.
      if (!ctx.dryRun && definition.kind === "observation") {
        await queue.authorizeObservation(observation(tool === "gk_fs_dir_list" ? "List directory" : "Read text file"));
        this.live();
      }
      return value;
    } };
  }
  /** Deny before touching the journal: rejection remains possible, and no uncertain host write is claimed. */
  override async applyAction(_id: number): Promise<void> { this.live(); throw denied(); }
  /** Retire a pending effect without modifying host files. */
  override async rejectAction(id: number): Promise<void> { this.live(); await super.rejectAction(id); this.live(); }
  /** Revert support is deliberately not advertised. */
  override async revertAction(_id: number): Promise<void> { throw denied(); }
}
