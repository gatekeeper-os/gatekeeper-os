import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TestApprovalQueue } from "@gatekeeper-os/gatekeeper-kit";
import { FsDirectory, type FsDirectoryOptions } from "./directory.js";
import { DirectoryBinding } from "./paths.js";
import { SimulatedCrash, type Boundary } from "./apply.js";
import { systemPublisher, type Publisher } from "./publish.js";
import { readState } from "./state.js";

let base: string, root: string, outside: string, state: string;
const grant = "grant:01234567";
const boundaries: Boundary[] = ["preimage", "intent", "staged", "written", "synced", "publishing", "rechecked", "published", "verified", "parent-synced", "receipt"];
/** Boundaries before the final baseline check: any change there must be refused. */
const beforeRecheck = new Set<Boundary>(["preimage", "intent", "staged", "written", "synced", "publishing"]);
const at = (fd: number, name: string) => `/proc/self/fd/${fd}/${name}`;

/** Three-rename emulation of RENAME_EXCHANGE: hooks run between syscalls, never inside it, so the logic is exercised deterministically on hosts without the tool. */
const emulatedExchange: Publisher = { mode: "exchange", exchange(fd, a, b) {
  const temp = `.emulated-${a}`;
  renameSync(at(fd, a), at(fd, temp)); renameSync(at(fd, b), at(fd, a)); renameSync(at(fd, temp), at(fd, b));
  return true;
} };
const renameOnly: Publisher = { mode: "rename" };
const system = systemPublisher();
const publishers: Array<[string, Publisher]> = [["rename", renameOnly], ["exchange (emulated)", emulatedExchange],
  ...(system.mode === "exchange" ? [["exchange (system tool)", system] as [string, Publisher]] : [])];

beforeEach(() => {
  base = mkdtempSync(join(realpathSync(tmpdir()), "gkos-fs-apply-"));
  root = join(base, "root"); outside = join(base, "outside"); state = join(base, "state", "dir");
  mkdirSync(join(root, "sub"), { recursive: true }); mkdirSync(outside);
  writeFileSync(join(outside, "sentinel"), "OUTSIDE_SENTINEL");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

async function world(options: FsDirectoryOptions = {}) {
  const gatekeeper = new FsDirectory(DirectoryBinding.capture(root), () => {}, state, options);
  const queue = new TestApprovalQueue(), session = await gatekeeper.startSession(queue);
  let n = 0;
  const write = (path: string, content: string) => session.call("gk_fs_file_write", { grant, path, content }, queue.context(String(++n)));
  const read = (path: string) => session.call("gk_fs_file_read", { grant, path }, queue.context(String(++n)));
  return { gatekeeper, queue, session, write, read };
}
const tx = (id: number, kind = "apply") => readState(join(state, `${kind}-${id}.tx.json`)) as { phase: string; publish?: string } | undefined;
const receipt = (id: number, kind = "apply") => readState(join(state, `${kind}-${id}.receipt.json`)) as Record<string, unknown> | undefined;
const kitStatus = (id: number) => (readState(join(state, "actions.json")) as { records: Array<{ id: number; status: string }> }).records.find(r => r.id === id)?.status;
const contents = (dir: string) => readdirSync(dir).filter(name => lstatSync(join(dir, name)).isFile()).map(name => readFileSync(join(dir, name), "utf8"));
const sentinelIntact = () => expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("OUTSIDE_SENTINEL");
async function expectBlocked(gatekeeper: FsDirectory) {
  await expect(gatekeeper.startSession(new TestApprovalQueue())).rejects.toThrow();
  await expect(gatekeeper.applyAction(99)).rejects.toThrow();
}

describe.each(publishers)("apply with %s publication", (_label, publisher) => {
  it("replaces an unchanged file with a durable receipt, preserved mode and recorded preimage", async () => {
    writeFileSync(join(root, "sub", "file"), "baseline"); chmodSync(join(root, "sub", "file"), 0o640);
    const w = await world({ publisher: () => publisher });
    const description = await w.gatekeeper.actions.gk_fs_file_write!.describe({ grant, path: "sub/file", content: "desired" });
    expect(description.implementsRevert).toBe(true);
    await w.write("sub/file", "desired");
    expect(readFileSync(join(root, "sub", "file"), "utf8")).toBe("baseline");
    await w.gatekeeper.applyAction(1);
    expect(readFileSync(join(root, "sub", "file"), "utf8")).toBe("desired");
    expect(statSync(join(root, "sub", "file")).mode & 0o777).toBe(0o640);
    expect(readdirSync(join(root, "sub"))).toEqual(["file"]);
    const r = receipt(1)!;
    expect(r).toMatchObject({ actionId: 1, path: "sub/file", bytes: 7, publish: publisher.mode, preimageRef: "preimage-apply-1",
      sha256: createHash("sha256").update("desired").digest("hex") });
    expect(typeof r.resourceIdentity).toBe("string");
    expect(JSON.stringify(r)).not.toContain(root);
    expect(tx(1)?.phase).toBe("applied"); expect(kitStatus(1)).toBe("applied");
    expect(Buffer.from((readState(join(state, "preimage-apply-1.json")) as { content: string }).content, "base64").toString()).toBe("baseline");
    expect(await w.read("sub/file")).toMatchObject({ details: { content: "desired" } });
  });
  it("creates an absent file with no-replace link publication and offers no revert", async () => {
    const w = await world({ publisher: () => publisher });
    expect((await w.gatekeeper.actions.gk_fs_file_write!.describe({ grant, path: "new", content: "x" })).implementsRevert).toBe(false);
    await w.write("new", "created");
    await w.gatekeeper.applyAction(1);
    expect(readFileSync(join(root, "new"), "utf8")).toBe("created");
    expect(receipt(1)?.publish).toBe("link");
    expect(statSync(join(root, "new")).nlink).toBe(1);
    expect(readdirSync(root).sort()).toEqual(["new", "sub"]);
    await expect(w.gatekeeper.revertAction!(1)).rejects.toThrow();
    expect(readFileSync(join(root, "new"), "utf8")).toBe("created");
  });
  it("chains queued writes on one path through the earlier receipt or baseline", async () => {
    writeFileSync(join(root, "file"), "v0");
    const w = await world({ publisher: () => publisher });
    await w.write("file", "v1"); await w.write("file", "v2"); await w.write("file", "v3");
    await w.gatekeeper.applyAction(1);
    await w.gatekeeper.rejectAction(2);
    await expect(w.gatekeeper.applyAction(3)).rejects.toThrow(); // v3 was queued on the rejected v2's baseline, v0
    expect(readFileSync(join(root, "file"), "utf8")).toBe("v1");
    await w.gatekeeper.rejectAction(3);
    await w.write("file", "v4"); await w.write("file", "v5");
    await w.gatekeeper.applyAction(4); await w.gatekeeper.applyAction(5);
    expect(readFileSync(join(root, "file"), "utf8")).toBe("v5");
  });
  it("refuses special, multiply linked, oversized, invalid-text, symlink and setuid targets before any mutation", async () => {
    const cases: Array<[string, () => void]> = [
      ["fifo", () => { unlinkSync(join(root, "t")); execFileSync("mkfifo", [join(root, "t")]); }],
      ["directory", () => { unlinkSync(join(root, "t")); mkdirSync(join(root, "t")); }],
      ["hardlink", () => linkSync(join(root, "t"), join(outside, "alias"))],
      ["oversized", () => writeFileSync(join(root, "t"), Buffer.alloc(1048577, 97))],
      ["invalid", () => writeFileSync(join(root, "t"), Buffer.from([0xff]))],
      ["symlink", () => { unlinkSync(join(root, "t")); symlinkSync(join(outside, "sentinel"), join(root, "t")); }],
      ["setuid", () => chmodSync(join(root, "t"), 0o4644)],
    ];
    for (const [label, mutate] of cases) {
      rmSync(state, { recursive: true, force: true }); rmSync(join(root, "t"), { recursive: true, force: true }); rmSync(join(outside, "alias"), { force: true });
      writeFileSync(join(root, "t"), "baseline");
      const w = await world({ publisher: () => publisher });
      await w.write("t", "desired");
      mutate();
      await expect(w.gatekeeper.applyAction(1), label).rejects.toThrow();
      expect(tx(1), label).toBeUndefined(); expect(kitStatus(1), label).toBe("pending");
      expect(readdirSync(root).filter(name => name.startsWith(".gkos-stage")), label).toEqual([]);
      sentinelIntact();
    }
  });

  describe.each(boundaries)("hostile or benign change at %s", boundary => {
    async function race(setup: () => void, mutate: (ctx: { stage: string }) => void) {
      setup();
      let fired = false;
      const w = await world({ publisher: () => publisher, hooks: { at: (point, ctx) => { if (point === boundary && !fired) { fired = true; mutate(ctx); } } } });
      await w.write("sub/file", "DESIRED");
      let ok = true;
      try { await w.gatekeeper.applyAction(1); } catch { ok = false; }
      expect(fired).toBe(true);
      // Never a silent half state: success means a durable receipt, failure means a blocked `uncertain` transaction.
      if (ok) { expect(tx(1)?.phase).toBe("applied"); expect(receipt(1)).toBeDefined(); }
      else { expect(tx(1)?.phase).toBe("uncertain"); expect(kitStatus(1)).toBe("uncertain"); await expectBlocked(w.gatekeeper); }
      sentinelIntact();
      return ok;
    }
    const baseline = () => writeFileSync(join(root, "sub", "file"), "BASELINE");

    it("symlink swap of the target never writes through to outside", async () => {
      const ok = await race(baseline, () => { unlinkSync(join(root, "sub", "file")); symlinkSync(join(outside, "sentinel"), join(root, "sub", "file")); });
      if (beforeRecheck.has(boundary) || boundary === "published") expect(ok).toBe(false);
    });
    it("hardlink alias from outside never receives the new content", async () => {
      const ok = await race(baseline, () => linkSync(join(root, "sub", "file"), join(outside, "alias")));
      if (beforeRecheck.has(boundary) || boundary === "published") expect(ok).toBe(false);
      expect(["BASELINE", "DESIRED"]).toContain(readFileSync(join(outside, "alias"), "utf8"));
      if (!["published", "verified", "parent-synced", "receipt"].includes(boundary)) expect(readFileSync(join(outside, "alias"), "utf8")).toBe("BASELINE");
    });
    it("staging-source substitution is never published as ours", async () => {
      const ok = await race(baseline, ({ stage }) => {
        const path = join(root, "sub", stage);
        if (existsSync(path)) unlinkSync(path);
        writeFileSync(path, "SUBSTITUTED");
      });
      if (beforeRecheck.has(boundary) && boundary !== "preimage" && boundary !== "intent") expect(ok).toBe(false);
      if (ok) expect(readFileSync(join(root, "sub", "file"), "utf8")).toBe("DESIRED");
    });
    it("final-name replacement (CE-2) is detected with both versions kept, except the documented rename window", async () => {
      const ok = await race(baseline, () => { const temp = join(root, "sub", ".editor-save"); writeFileSync(temp, "EXTERNAL EDIT"); renameSync(temp, join(root, "sub", "file")); });
      const survived = contents(join(root, "sub")).includes("EXTERNAL EDIT");
      if (beforeRecheck.has(boundary)) {
        expect(ok).toBe(false); expect(readFileSync(join(root, "sub", "file"), "utf8")).toBe("EXTERNAL EDIT");
        expect(contents(join(root, "sub"))).toContain("DESIRED");
      } else if (boundary === "rechecked" && publisher.mode === "rename") {
        // Residual window (plans/fs-contract.md amendment): plain rename cannot observe this edit. Recorded, not claimed safe.
        expect(ok).toBe(true); expect(survived).toBe(false); expect(receipt(1)?.publish).toBe("rename");
      } else {
        expect(survived).toBe(true);
        // In the exchange window both versions stay (ours at the name, theirs at the stage name). Just after
        // publication their replacement wins; verification reports it and ours remains in the private effect record.
        if (boundary === "rechecked") { expect(ok).toBe(false); expect(contents(join(root, "sub"))).toContain("DESIRED"); }
        if (boundary === "published") expect(ok).toBe(false);
      }
    });
    it("in-place edit after the baseline is detected or survives, except the documented rename window", async () => {
      const ok = await race(baseline, () => writeFileSync(join(root, "sub", "file"), "IN-PLACE EDIT"));
      const survived = contents(join(root, "sub")).includes("IN-PLACE EDIT");
      if (beforeRecheck.has(boundary)) { expect(ok).toBe(false); expect(readFileSync(join(root, "sub", "file"), "utf8")).toBe("IN-PLACE EDIT"); }
      else if (boundary === "rechecked" && publisher.mode === "rename") { expect(ok).toBe(true); expect(survived).toBe(false); }
      else expect(survived).toBe(true);
    });
    it("parent relocation outside the grant (CE-1, excluded adversary) is refused or detected", async () => {
      const ok = await race(baseline, () => { renameSync(join(root, "sub"), join(outside, "moved")); mkdirSync(join(root, "sub")); });
      // Recorded behaviour: before the final check the move is refused; inside the window the write lands in the
      // moved directory and the post-publish anchor check reports it. After verification it is a later, unrelated move.
      if (!["verified", "parent-synced", "receipt"].includes(boundary)) expect(ok).toBe(false);
      if (boundary === "rechecked") expect(readFileSync(join(outside, "moved", "file"), "utf8")).toBe("DESIRED");
      expect(readdirSync(join(root, "sub"))).toEqual([]);
    });
  });
});

describe("crash and fault injection at every boundary", () => {
  it.each(boundaries.flatMap(b => [[b, "crash"], [b, "fault"]] as Array<[Boundary, "crash" | "fault"]>))("%s %s leaves the resource blocked across restart, never half-written", async (boundary, kind) => {
    writeFileSync(join(root, "file"), "BASELINE");
    const w = await world({ publisher: () => emulatedExchange, hooks: { at: point => {
      if (point === boundary) throw kind === "crash" ? new SimulatedCrash() : new Error("injected fault");
    } } });
    await w.write("file", "DESIRED");
    await expect(w.gatekeeper.applyAction(1)).rejects.toThrow();
    expect(["BASELINE", "DESIRED"]).toContain(readFileSync(join(root, "file"), "utf8"));
    if (["preimage", "intent", "staged", "written", "synced", "publishing", "rechecked"].includes(boundary)) expect(readFileSync(join(root, "file"), "utf8")).toBe("BASELINE");
    const phase = tx(1)?.phase;
    if (boundary === "preimage") expect(phase).toBeUndefined();
    else if (kind === "fault") expect(phase).toBe("uncertain");
    else expect(phase).not.toBe("applied");
    // Restart: a fresh driver instance over the same private state stays blocked; nothing retries.
    const restarted = new FsDirectory(DirectoryBinding.capture(root), () => {}, state, { publisher: () => emulatedExchange });
    await expectBlocked(restarted);
    await expect(restarted.revertAction(1)).rejects.toThrow();
    expect(["BASELINE", "DESIRED"]).toContain(readFileSync(join(root, "file"), "utf8"));
  });
});

describe("revert matrix", () => {
  it("restores the persisted preimage, preserving mode, and records a revert receipt", async () => {
    writeFileSync(join(root, "file"), "BASELINE"); chmodSync(join(root, "file"), 0o600);
    const w = await world({ publisher: () => renameOnly });
    await w.write("file", "DESIRED"); await w.gatekeeper.applyAction(1);
    await w.gatekeeper.revertAction!(1);
    expect(readFileSync(join(root, "file"), "utf8")).toBe("BASELINE");
    expect(statSync(join(root, "file")).mode & 0o777).toBe(0o600);
    expect(kitStatus(1)).toBe("reverted"); expect(receipt(1, "revert")).toMatchObject({ kind: "revert", actionId: 1, path: "file" });
    await w.gatekeeper.revertAction!(1); // idempotent: already reverted
    expect(readFileSync(join(root, "file"), "utf8")).toBe("BASELINE");
  });
  it("works after restart", async () => {
    writeFileSync(join(root, "file"), "BASELINE");
    const w = await world({ publisher: () => emulatedExchange });
    await w.write("file", "DESIRED"); await w.gatekeeper.applyAction(1); await w.session.close();
    const restarted = await world({ publisher: () => emulatedExchange });
    await restarted.gatekeeper.revertAction!(1);
    expect(readFileSync(join(root, "file"), "utf8")).toBe("BASELINE");
  });
  it("refuses an absent preimage (new file) without touching it", async () => {
    const w = await world();
    await w.write("new", "DESIRED"); await w.gatekeeper.applyAction(1);
    await expect(w.gatekeeper.revertAction!(1)).rejects.toThrow();
    expect(readFileSync(join(root, "new"), "utf8")).toBe("DESIRED"); expect(kitStatus(1)).toBe("applied");
  });
  it("refuses after an intervening edit, keeping the edit", async () => {
    writeFileSync(join(root, "file"), "BASELINE");
    const w = await world();
    await w.write("file", "DESIRED"); await w.gatekeeper.applyAction(1);
    writeFileSync(join(root, "file"), "LATER EDIT");
    await expect(w.gatekeeper.revertAction!(1)).rejects.toThrow();
    expect(readFileSync(join(root, "file"), "utf8")).toBe("LATER EDIT"); expect(kitStatus(1)).toBe("applied");
  });
  it.each([["receipt", "apply-1.receipt.json"], ["preimage", "preimage-apply-1.json"]])("refuses a corrupt or missing %s", async (_label, file) => {
    for (const damage of [(path: string) => writeFileSync(path, JSON.stringify({ ...(readState(path) as object), bytes: 1 })), (path: string) => unlinkSync(path)]) {
      rmSync(state, { recursive: true, force: true }); writeFileSync(join(root, "file"), "BASELINE");
      const w = await world();
      await w.write("file", "DESIRED"); await w.gatekeeper.applyAction(1);
      damage(join(state, file));
      await expect(w.gatekeeper.revertAction!(1)).rejects.toThrow();
      expect(readFileSync(join(root, "file"), "utf8")).toBe("DESIRED"); expect(kitStatus(1)).toBe("applied");
    }
  });
  it("blocks the resource if a revert is interrupted", async () => {
    writeFileSync(join(root, "file"), "BASELINE");
    let armed = false;
    const w = await world({ hooks: { at: point => { if (armed && point === "published") throw new SimulatedCrash(); } } });
    await w.write("file", "DESIRED"); await w.gatekeeper.applyAction(1);
    armed = true;
    await expect(w.gatekeeper.revertAction!(1)).rejects.toThrow();
    expect(tx(1, "revert")?.phase).toBe("publishing");
    await expectBlocked(new FsDirectory(DirectoryBinding.capture(root), () => {}, state));
  });
});

describe("authorization lifetime", () => {
  it("refuses the effect, touching nothing, when an event-loop turn separates the decision from application", async () => {
    writeFileSync(join(root, "file"), "BASELINE");
    const w = await world();
    await w.write("file", "DESIRED");
    // Hold the kit sequencer across a timer turn, as a slow asynchronous submission would.
    const submit = w.queue.submitAction.bind(w.queue);
    let entered!: () => void;
    const busy = new Promise<void>(resolve => { entered = resolve; });
    w.queue.submitAction = async (id, description) => { entered(); await new Promise(resolve => setTimeout(resolve, 20)); return submit(id, description); };
    const second = w.write("other", "later");
    await busy;
    await expect(w.gatekeeper.applyAction(1)).rejects.toThrow();
    await second.catch(() => undefined);
    expect(readFileSync(join(root, "file"), "utf8")).toBe("BASELINE");
    // The in-flight submission is visible in the kit journal, so this refusal happens before the journal changes.
    expect(tx(1)).toBeUndefined(); expect(kitStatus(1)).toBe("pending");
  });
  it("refuses an implementation entry that did not come from a same-turn lifecycle decision", async () => {
    writeFileSync(join(root, "file"), "BASELINE");
    const w = await world();
    await w.write("file", "DESIRED");
    const impl = w.gatekeeper.actions.gk_fs_file_write!;
    await expect(impl.apply({ grant, path: "file", content: "DESIRED" }, 1)).rejects.toThrow();
    const opened = w.gatekeeper.applyAction(1);
    await new Promise(resolve => setImmediate(resolve));
    await opened;
    await expect(impl.apply({ grant, path: "file", content: "DESIRED" }, 1)).rejects.toThrow();
    expect(readFileSync(join(root, "file"), "utf8")).toBe("DESIRED"); expect(tx(1)?.phase).toBe("applied");
  });
  it("revocation of the account before the decision denies application", async () => {
    writeFileSync(join(root, "file"), "BASELINE");
    let live = true;
    const gatekeeper = new FsDirectory(DirectoryBinding.capture(root), () => { if (!live) throw new Error("revoked"); }, state);
    const queue = new TestApprovalQueue(), session = await gatekeeper.startSession(queue);
    await session.call("gk_fs_file_write", { grant, path: "file", content: "DESIRED" }, queue.context("1"));
    live = false;
    await expect(gatekeeper.applyAction(1)).rejects.toThrow();
    expect(readFileSync(join(root, "file"), "utf8")).toBe("BASELINE");
  });
});

describe("mount interposition", () => {
  const unshare = (() => { try { execFileSync("unshare", ["-Urm", "true"], { stdio: "ignore" }); return true; } catch { return false; } })();
  it.runIf(unshare)("refuses to resolve through a bind mount placed inside the grant", () => {
    // A private user+mount namespace lets an unprivileged test bind-mount `outside` over root/sub.
    writeFileSync(join(outside, "file"), "OUTSIDE_FILE");
    const script = `
      import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
      import { ConfinedIO } from "${join(import.meta.dirname, "io.ts")}";
      import { DirectoryBinding } from "${join(import.meta.dirname, "paths.ts")}";
      const io = new ConfinedIO(DirectoryBinding.capture(${JSON.stringify(root)}));
      let read = "denied"; try { read = JSON.stringify(io.read("sub/file")); } catch {}
      let anchor = "denied"; try { io.anchor("sub").close(); anchor = "opened"; } catch {}
      process.stdout.write(JSON.stringify({ read, anchor }));
    `;
    writeFileSync(join(base, "probe.mts"), script);
    const out = execFileSync("unshare", ["-Urm", "sh", "-c", `mount --bind ${JSON.stringify(outside)} ${JSON.stringify(join(root, "sub"))} && exec ${JSON.stringify(process.execPath)} --import tsx ${JSON.stringify(join(base, "probe.mts"))}`], { encoding: "utf8", cwd: import.meta.dirname });
    expect(JSON.parse(out)).toEqual({ read: "denied", anchor: "denied" });
    sentinelIntact();
  });
});
