import { closeSync, constants as C, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readdirSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { denied } from "./paths.js";
import { fdPath, inspect, relativePath, sha256, type Anchor, type ConfinedIO, type TargetState } from "./io.js";
import type { Publisher, PublishMode } from "./publish.js";
import { readState, writeState } from "./state.js";

/**
 * Driver-local apply/revert transactions under the cooperative-writer contract
 * (plans/fs-contract.md, Amendment 2026-09-27). Every step is synchronous, so no other
 * event-loop task can run between the kernel's authorization and the effect.
 */

/** What the target must still be: explicit absence, or an identity plus content hash. */
export type Expected = { absent: true } | { absent: false; dev: string; ino: string; size: string; sha256: string; mtimeNs?: string; ctimeNs?: string };
/** Mutation boundaries, exposed only to constructor-injected test hooks. */
export type Boundary = "preimage" | "intent" | "staged" | "written" | "synced" | "publishing" | "rechecked" | "published" | "verified" | "parent-synced" | "receipt";
export interface TransactionHooks { at?(point: Boundary, context: { anchor: Anchor; name: string; stage: string }): void; }
/** Thrown by a test hook to model process death: no `uncertain` marker is written afterwards. */
export class SimulatedCrash extends Error {}

type Kind = "apply" | "revert";
type Phase = "intent" | "staged" | "publishing" | "published" | "applied" | "uncertain";
type Publication = PublishMode | "link";
interface Identity { dev: string; ino: string; }
interface TxRecord {
  version: 1; kind: Kind; actionId: number; resource: string; path: string; stage: string; phase: Phase;
  expected: Expected; desired: { bytes: number; sha256: string }; preimageRef: string; staged?: Identity; publish?: Publication;
}
/** Durable effect receipt; `path` is grant-relative and no content is stored. */
export interface Receipt {
  version: 1; kind: Kind; actionId: number; resourceIdentity: string; path: string; bytes: number; sha256: string;
  preimageRef: string; publish: Publication; identity: { dev: string; ino: string; size: string; mtimeNs: string }; digest: string;
}
/** Recorded preimage: the exact bytes and identity replaced, or explicit absence. */
export type Preimage = { version: 1; actionId: number; path: string; digest: string } & ({ absent: true } | { absent: false; content: string; sha256: string; mode: number; dev: string; ino: string });

const digest = (value: object) => sha256(Buffer.from(JSON.stringify(value)));
function seal<T extends object>(value: T): T & { digest: string } { return { ...value, digest: digest(value) }; }
function unsealed(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw denied();
  const { digest: recorded, ...rest } = value as Record<string, unknown>;
  if (typeof recorded !== "string" || recorded !== digest(rest)) throw denied();
  return value as Record<string, unknown>;
}
/** Parse the baseline stamp recorded at simulation: dev:ino:nlink:size:mtimeNs:ctimeNs:sha256. */
export function expectedFromStamp(stamp: string | null): Expected {
  if (stamp === null) return { absent: true };
  const [dev, ino, nlink, size, mtimeNs, ctimeNs, hash, ...rest] = stamp.split(":");
  if (rest.length || nlink !== "1" || !dev || !ino || !size || !mtimeNs || !ctimeNs || !/^[0-9a-f]{64}$/.test(hash ?? "")) throw denied();
  return { absent: false, dev, ino, size, mtimeNs, ctimeNs, sha256: hash! };
}
/** The file a receipt published, as the next expectation (ctime moves on rename, so it is excluded). */
export function expectedFromReceipt(receipt: Receipt): Expected {
  return { absent: false, ...receipt.identity, sha256: receipt.sha256 };
}
export function matches(current: TargetState, expected: Expected): boolean {
  if (expected.absent || current.absent) return expected.absent && current.absent;
  return current.dev === expected.dev && current.ino === expected.ino && current.size === expected.size && current.sha256 === expected.sha256 &&
    (expected.mtimeNs === undefined || current.mtimeNs === expected.mtimeNs) && (expected.ctimeNs === undefined || current.ctimeNs === expected.ctimeNs);
}
function identityOf(anchor: Anchor, name: string): Identity | null {
  try { const s = lstatSync(`${fdPath(anchor.fd)}/${name}`, { bigint: true }); return { dev: String(s.dev), ino: String(s.ino) }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw denied(); }
}
const same = (a: Identity | null, b: Identity | undefined) => !!a && !!b && a.dev === b.dev && a.ino === b.ino;

/** Private per-resource journal, preimages and receipts; never below a granted directory. */
export class Transactions {
  constructor(private readonly dir: string, private readonly io: ConfinedIO, private readonly resource: string,
    private readonly publisher: () => Publisher, private readonly hooks: TransactionHooks = {}) {}

  private file(kind: Kind, id: number, suffix: "tx" | "receipt") { return join(this.dir, `${kind}-${id}.${suffix}.json`); }

  /** Any started transaction that did not reach `applied` blocks the resource, including across restart. */
  assertSettled(): void {
    let names: string[];
    try { names = readdirSync(this.dir); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw denied(); }
    for (const name of names) {
      if (!name.endsWith(".tx.json")) continue;
      const record = readState(join(this.dir, name)) as Partial<TxRecord> | undefined;
      if (!record || record.phase !== "applied") throw denied();
    }
  }
  /** A validated receipt, or undefined when none was written. Corruption denies. */
  receipt(kind: Kind, id: number): Receipt | undefined {
    const raw = readState(this.file(kind, id, "receipt"));
    if (raw === undefined) return undefined;
    const r = unsealed(raw) as unknown as Receipt;
    if (r.version !== 1 || r.kind !== kind || r.actionId !== id || r.resourceIdentity !== this.resource || !Number.isSafeInteger(r.bytes) ||
      !/^[0-9a-f]{64}$/.test(r.sha256) || !["exchange", "rename", "link"].includes(r.publish) || !r.identity || typeof r.preimageRef !== "string") throw denied();
    relativePath(r.path);
    return r;
  }
  /** A validated preimage recorded before the named transaction mutated anything. */
  preimage(ref: string, path: string): Preimage {
    if (!/^preimage-(apply|revert)-\d+$/.test(ref)) throw denied();
    const p = unsealed(readState(join(this.dir, `${ref}.json`))) as unknown as Preimage;
    if (p.version !== 1 || p.path !== path) throw denied();
    if (!p.absent && (typeof p.content !== "string" || sha256(Buffer.from(p.content, "base64")) !== p.sha256)) throw denied();
    return p;
  }
  /** Current state of a grant-relative path, for deterministic prechecks that perform no mutation. */
  current(path: string): TargetState {
    return this.io.withParent(path, (anchor, name) => inspect(anchor, name));
  }

  /**
   * Replace or create one file: journal the preimage and intent, stage beside the target, recheck the
   * baseline, publish, verify, fsync, then write the receipt. Any failure after the intent is durable
   * leaves the transaction `uncertain` with every file kept; nothing is retried or cleaned up.
   */
  run(kind: Kind, id: number, path: string, desired: Buffer, expected: Expected): Receipt {
    const txPath = this.file(kind, id, "tx");
    if (readState(txPath) !== undefined || this.receipt(kind, id)) throw denied();
    const parts = relativePath(path).split("/"), name = parts.pop()!;
    const anchor = this.io.anchor(parts.length ? parts.join("/") : undefined);
    const stage = `.gkos-stage-${id}-${randomBytes(6).toString("hex")}`, stagePath = `${fdPath(anchor.fd)}/${stage}`, targetPath = `${fdPath(anchor.fd)}/${name}`;
    const at = (point: Boundary) => this.hooks.at?.(point, { anchor, name, stage });
    let record: TxRecord | undefined;
    const persist = (phase: Phase, extra: Partial<TxRecord> = {}) => { record = { ...record!, ...extra, phase }; writeState(txPath, record); };
    try {
      const current = inspect(anchor, name);
      // Replacement must not change ownership or special bits; parents are never created.
      if (!matches(current, expected) || (!current.absent && (current.uid !== process.geteuid?.() || (current.mode & 0o7000) !== 0))) throw denied();
      const preimageRef = `preimage-${kind}-${id}`;
      writeState(join(this.dir, `${preimageRef}.json`), seal(current.absent ? { version: 1, actionId: id, path, absent: true } :
        { version: 1, actionId: id, path, absent: false, content: current.bytes.toString("base64"), sha256: current.sha256, mode: current.mode, dev: current.dev, ino: current.ino }));
      at("preimage");
      record = { version: 1, kind, actionId: id, resource: this.resource, path, stage, phase: "intent", expected, desired: { bytes: desired.length, sha256: sha256(desired) }, preimageRef };
      writeState(txPath, record);
      at("intent");

      let staged: Identity;
      const fd = openSync(stagePath, C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW, current.absent ? 0o666 : current.mode & 0o777);
      try {
        anchor.assertSameMount(fd);
        // Preserve the replaced file's mode exactly; umask must not narrow it.
        if (!current.absent) fchmodSync(fd, current.mode & 0o777);
        const s = fstatSync(fd, { bigint: true });
        staged = { dev: String(s.dev), ino: String(s.ino) };
        persist("staged", { staged });
        at("staged");
        for (let offset = 0; offset < desired.length;) offset += writeSync(fd, desired, offset, desired.length - offset, offset);
        at("written");
        fsyncSync(fd);
        at("synced");
      } finally { closeSync(fd); }

      const planned: Publication = expected.absent ? "link" : this.publisher().mode;
      persist("publishing", { publish: planned });
      at("publishing");
      // Final baseline check, immediately before the publishing syscall. The gap after it is the documented residual window.
      anchor.assertCurrent();
      const ours = inspect(anchor, stage);
      if (ours.absent || !same(ours, staged) || ours.sha256 !== record!.desired.sha256 || !matches(inspect(anchor, name), expected)) throw denied();
      at("rechecked");

      let publish: Publication = planned;
      if (planned === "link") {
        // link(2) never replaces: a target created meanwhile fails EEXIST and both files remain.
        linkSync(stagePath, targetPath);
        at("published");
        if (!same(identityOf(anchor, name), staged) || !same(identityOf(anchor, stage), staged)) throw denied();
        unlinkSync(stagePath);
      } else {
        const exchange = planned === "exchange" ? this.publisher().exchange : undefined;
        const swapped = exchange ? (exchange(anchor.fd, stage, name), same(identityOf(anchor, name), staged)) : false;
        if (!swapped) {
          // No swap happened (tool or filesystem refused): the names are untouched, so fall back to rename after one more check.
          if (exchange && (!same(identityOf(anchor, stage), staged) || !matches(inspect(anchor, name), expected))) throw denied();
          publish = "rename";
          persist("publishing", { publish });
          renameSync(stagePath, targetPath);
          at("published");
          if (identityOf(anchor, stage) !== null) throw denied();
        } else {
          at("published");
          // The swapped-out file must be the baseline. Otherwise an edit landed in the window: keep both, block.
          const out = inspect(anchor, stage);
          if (expected.absent) throw denied();
          const { ctimeNs: _moved, ...baseline } = expected;
          if (!matches(out, baseline)) throw denied();
          unlinkSync(stagePath);
        }
      }
      anchor.assertCurrent();
      const final = inspect(anchor, name);
      if (final.absent || !same(final, staged) || final.sha256 !== record!.desired.sha256) throw denied();
      at("verified");
      fsyncSync(anchor.fd);
      at("parent-synced");
      persist("published", { publish });
      const receipt = seal({ version: 1 as const, kind, actionId: id, resourceIdentity: this.resource, path, bytes: desired.length, sha256: record!.desired.sha256,
        preimageRef, publish, identity: { dev: final.dev, ino: final.ino, size: final.size, mtimeNs: final.mtimeNs } });
      writeState(this.file(kind, id, "receipt"), receipt);
      at("receipt");
      persist("applied");
      return receipt;
    } catch (error) {
      if (record && !(error instanceof SimulatedCrash)) try { persist("uncertain"); } catch { /* the durable in-flight phase still blocks */ }
      if (error instanceof SimulatedCrash) throw error;
      throw denied();
    } finally { anchor.close(); }
  }
}
