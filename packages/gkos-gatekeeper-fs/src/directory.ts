import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { Value } from "typebox/value";
import type { ActionDescription, ApprovalQueue, GatekeeperSession, ObservationDescription } from "@gatekeeper-os/shared";
import { KitGatekeeper, OverlayStore } from "@gatekeeper-os/gatekeeper-kit";
import { DirectoryBinding, denied } from "./paths.js";
import { fsResources } from "./resources.js";
import { fsTools } from "./tools.js";
import { ConfinedIO, fdPath, relativePath, textBytes, type FileSnapshot } from "./io.js";
import { expectedFromReceipt, expectedFromStamp, matches, Transactions, type Expected, type TransactionHooks } from "./apply.js";
import { systemPublisher, type Publisher } from "./publish.js";
import { privateDirectory, readState, writeState } from "./state.js";

/** A queued write. `baseline` is the disk state at simulation; `after` is the pending write it was queued on top of. */
interface Effect { path: string; content: string; baseline: string | null; after?: number; }
/** Test seams only; production accounts never pass options. */
export interface FsDirectoryOptions { publisher?: () => Publisher; hooks?: TransactionHooks; }
const observation = (title: string): ObservationDescription => ({ title, description: "Read within the bound directory.", prohibitAllSharing: true });
const settledStatuses = new Set(["pending", "applied", "rejected", "reverted"]);
/** Pure description: no host reads, action allocation, state writes, or content in the preview. */
export function describeWrite(p: Record<string, unknown>): ActionDescription {
  const path = relativePath(p.path), bytes = textBytes(p.content).length;
  return { title: "Write text file", description: "Create or replace a text file within the bound directory, only if it is unchanged since this write was requested.",
    implementsRevert: false, autoApprovable: false, awaitDecision: false, preview: { path, bytes } };
}

/**
 * Bound private-only resource with fresh confined observations, persistent pending effects, and
 * operator-decided host application under the cooperative-writer contract (plans/fs-contract.md).
 */
export class FsDirectory extends KitGatekeeper {
  resource = structuredClone(fsResources[0]!);
  protected overlay: OverlayStore;
  private readonly io: ConfinedIO;
  private readonly tx: Transactions;
  private readonly journal: string;
  /** Action id whose kernel authorization is still within the current event-loop turn. */
  private window: number | undefined;
  constructor(private readonly binding: DirectoryBinding, private readonly accountLive: () => void, private readonly stateDir: string, options: FsDirectoryOptions = {}) {
    super(join(privateDirectory(stateDir), "actions.json"));
    this.journal = join(stateDir, "actions.json");
    this.overlay = new OverlayStore(join(stateDir, "overlay.json"));
    this.io = new ConfinedIO(binding);
    this.tx = new Transactions(stateDir, this.io, createHash("sha256").update(binding.fingerprint()).digest("hex"), options.publisher ?? systemPublisher, options.hooks);
    this.observations = {
      gk_fs_dir_list: { describe: () => observation("List directory"), read: async p => this.list(p.subpath) },
      gk_fs_file_read: { describe: () => observation("Read text file"), read: async p => this.read(relativePath(p.path)) },
    };
    this.actions = { gk_fs_file_write: {
      describe: p => {
        const description = describeWrite(p);
        this.live();
        // Revert restores a recorded preimage, so it is offered only when the file exists; creations cannot be reverted.
        const exists = this.exists(relativePath(p.path));
        return { ...description, implementsRevert: exists, description: exists
          ? "Replace a text file within the bound directory, only if it is unchanged since this write was requested. Revert restores the recorded previous contents."
          : "Create a text file within the bound directory, only if the name is still unused when applied. Revert is unavailable for new files." };
      },
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
        const effect: Effect = { path, content, baseline: original?.stamp ?? null, ...(earlier ? { after: earlier.actionId } : {}) };
        writeState(effectPath, effect);
        overlay.add({ actionId: id, kind: "fs.write", payload: effect });
        return { path, bytes: Buffer.byteLength(content) };
      },
      apply: async (p, id) => {
        this.enterWindow(id);
        this.live(); this.tx.assertSettled();
        const effect = this.effect(id);
        if (relativePath(p.path) !== effect.path || textBytes(p.content).toString("utf8") !== effect.content) throw denied();
        const receipt = this.tx.run("apply", id, effect.path, textBytes(effect.content), this.expected(id, effect));
        return { value: { path: receipt.path, bytes: receipt.bytes } };
      },
      revert: async ({ actionId }) => {
        this.enterWindow(actionId);
        this.live(); this.tx.assertSettled();
        const { receipt, content } = this.revertable(actionId);
        this.tx.run("revert", actionId, receipt.path, content, expectedFromReceipt(receipt));
      },
    } };
  }
  private live(): void { this.accountLive(); this.binding.assertCurrent(); }
  /**
   * The kernel authorizes synchronously and calls the lifecycle method in the same turn. Effects run only
   * if no other event-loop task could have run since then (a revocation, for example); otherwise nothing is touched.
   */
  private openWindow(id: number): void {
    this.window = id;
    setImmediate(() => { if (this.window === id) this.window = undefined; });
  }
  private enterWindow(id: number): void {
    if (this.window !== id) throw denied();
    this.window = undefined;
  }
  /** Direct lifecycle entry points get the same guard as sessions: nothing proceeds past an unsettled outcome. */
  private assertResourceSettled(): void {
    this.live();
    this.tx.assertSettled();
    const raw = readState(this.journal);
    if (raw === undefined) return;
    const records = (raw as { records?: unknown }).records;
    if (!Array.isArray(records) || records.some(r => !r || typeof r !== "object" || !settledStatuses.has((r as { status?: unknown }).status as string))) throw denied();
  }
  private status(id: number): string | undefined {
    const records = (readState(this.journal) as { records?: Array<{ id: number; status: string }> } | undefined)?.records;
    return records?.find(record => record.id === id)?.status;
  }
  private effect(id: number): Effect {
    const raw = readState(join(this.stateDir, `effect-${id}.json`));
    if (!raw || typeof raw !== "object") throw denied();
    const effect = raw as Effect;
    relativePath(effect.path); textBytes(effect.content);
    if ((effect.baseline !== null && typeof effect.baseline !== "string") ||
      (effect.after !== undefined && (!Number.isSafeInteger(effect.after) || effect.after < 1 || effect.after >= id))) throw denied();
    return effect;
  }
  /** What the target must be at apply: the simulated baseline, or the published result of the write this one was queued on. */
  private expected(id: number, effect: Effect): Expected {
    if (effect.after === undefined) return expectedFromStamp(effect.baseline);
    const status = this.status(effect.after);
    if (status === "rejected") return expectedFromStamp(effect.baseline);
    const receipt = status === "applied" ? this.tx.receipt("apply", effect.after) : status === "reverted" ? this.tx.receipt("revert", effect.after) : undefined;
    if (!receipt || receipt.path !== effect.path || effect.after >= id) throw denied();
    return expectedFromReceipt(receipt);
  }
  /** Revert needs an intact receipt, a recorded (non-absent) preimage, and the applied version still in place. */
  private revertable(id: number) {
    const receipt = this.tx.receipt("apply", id);
    if (!receipt || this.tx.receipt("revert", id)) throw denied();
    const preimage = this.tx.preimage(receipt.preimageRef, receipt.path);
    if (preimage.absent) throw denied();
    return { receipt, content: Buffer.from(preimage.content, "base64") };
  }
  /** Existence of a single-link regular file at a confined path; special or aliased names deny. */
  private exists(path: string): boolean {
    return this.io.withParent(path, (anchor, name) => {
      try {
        const s = lstatSync(`${fdPath(anchor.fd)}/${name}`, { bigint: true });
        if (!s.isFile() || s.nlink !== 1n) throw denied();
        return true;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw denied(); }
    });
  }
  /** Revalidate bound identity; no contents in metadata. */
  override async describe() {
    this.live();
    return { resource: structuredClone(this.resource), title: "Directory", suggestedName: "DIRECTORY" };
  }
  private effects(): Array<Effect & { actionId: number }> {
    return this.overlay.list().map(entry => {
      if (entry.kind !== "fs.write" || !entry.payload || typeof entry.payload !== "object") throw denied();
      const effect = entry.payload as Effect;
      relativePath(effect.path); textBytes(effect.content);
      if (effect.baseline !== null && typeof effect.baseline !== "string") throw denied();
      return { ...effect, actionId: entry.actionId };
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
    this.live(); this.tx.assertSettled();
    const session = await super.startSession(queue);
    return { close: () => session.close(), call: async (tool, params, ctx) => {
      this.live(); this.tx.assertSettled();
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
  /**
   * Deterministic refusals (unsettled resource, stale baseline, missing receipt) happen here, before the kit
   * journal changes and before any host mutation. Only then does the synchronous transaction start.
   */
  override async applyAction(id: number): Promise<void> {
    this.assertResourceSettled();
    const status = this.status(id);
    if (status === undefined) throw denied();
    if (status === "pending") {
      const effect = this.effect(id);
      if (!matches(this.tx.current(effect.path), this.expected(id, effect))) throw denied();
    }
    this.openWindow(id);
    await super.applyAction(id);
  }
  /** Retire a pending effect without modifying host files. */
  override async rejectAction(id: number): Promise<void> { this.live(); await super.rejectAction(id); this.live(); }
  /** Revert only from the persisted preimage, and only while the recorded applied version is still the file. */
  override async revertAction(id: number): Promise<void> {
    this.assertResourceSettled();
    const status = this.status(id);
    if (status === undefined) throw denied();
    if (status === "applied") {
      const { receipt } = this.revertable(id);
      if (!matches(this.tx.current(receipt.path), expectedFromReceipt(receipt))) throw denied();
    }
    this.openWindow(id);
    await super.revertAction(id);
  }
}
