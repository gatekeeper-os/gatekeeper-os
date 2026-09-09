import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { TestApprovalQueue } from "@clawos/gatekeeper-kit";
import { FsVendor } from "./vendor.js";
import { ConfinedIO, relativePath, textBytes } from "./io.js";
import { DirectoryBinding } from "./paths.js";

let base: string, root: string;
const grant = "grant:01234567";
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const vendor = () => new FsVendor({ stateDir: join(base, "state"), pluginConfig: { roots: [root] }, logger });
async function resource(v = vendor(), operator = "owner") {
  const account = await v.createAccount(operator);
  return { account, ...(await account.getGatekeeperFor(pathToFileURL(root).href)) };
}
async function setup() {
  const r = await resource(), queue = new TestApprovalQueue(), session = await r.gatekeeper.startSession(queue);
  let callId = 0;
  const call = (name: string, input: Record<string, unknown> = {}) => session.call(name, { grant, ...input }, queue.context(String(++callId)));
  return { ...r, queue, session, call };
}
const details = (result: object) => "details" in result ? result.details : undefined;
beforeEach(() => { base = mkdtempSync(join(realpathSync(tmpdir()), "clawos-fs-session-")); root = join(base, "root"); mkdirSync(root); });
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("literal bounded input", () => {
  it.each(["", "/outside", "a//b", "a/../b", "a/./b", "a/", "a\\b", "a\0b", "a\nb", "\ud800", "é".repeat(2049)])("rejects invalid path #%#", path => expect(() => relativePath(path)).toThrow());
  it("does not decode literal percent paths", () => expect(relativePath("%2e%2e/x")).toBe("%2e%2e/x"));
  it("uses encoded byte rather than character limits", () => {
    expect(textBytes("é".repeat(524288)).length).toBe(1048576);
    for (const value of ["é".repeat(524289), "a\0b", "\ud800"]) expect(() => textBytes(value)).toThrow();
  });
});

describe("confined read/list", () => {
  it("never follows an attacker-swapped subdirectory symlink during repeated reads", async () => {
    const safe = join(root, "safe"), saved = join(root, "saved"), outside = join(base, "outside");
    mkdirSync(safe); mkdirSync(outside); writeFileSync(join(safe, "text"), "inside"); writeFileSync(join(outside, "text"), "OUTSIDE_SENTINEL");
    const control = new Int32Array(new SharedArrayBuffer(12));
    const worker = new Worker(`
      const fs = require("node:fs"), { workerData } = require("node:worker_threads");
      const { safe, saved, outside, buffer } = workerData, state = new Int32Array(buffer);
      Atomics.store(state, 0, 1); Atomics.notify(state, 0);
      while (!Atomics.load(state, 1)) {
        fs.renameSync(safe, saved); fs.symlinkSync(outside, safe); Atomics.add(state, 2, 1);
        fs.unlinkSync(safe); fs.renameSync(saved, safe);
      }
    `, { eval: true, workerData: { safe, saved, outside, buffer: control.buffer } });
    const finished = new Promise<void>((resolve, reject) => { worker.on("exit", code => code === 0 ? resolve() : reject(new Error("race worker failed"))); worker.on("error", reject); });
    try {
      Atomics.wait(control, 0, 0, 5000);
      const io = new ConfinedIO(DirectoryBinding.capture(root));
      for (let n = 0; n < 300; n++) {
        let value;
        try { value = io.read("safe/text"); }
        catch (error) { expect(String(error)).not.toContain("OUTSIDE_SENTINEL"); continue; }
        if (value !== null) expect(value.content).toBe("inside");
      }
      expect(Atomics.load(control, 2)).toBeGreaterThan(0);
    } finally { Atomics.store(control, 1, 1); await finished; }
  });
  it("sorts bounded one-level entries and labels symlinks and hardlinks unavailable", async () => {
    writeFileSync(join(root, "z"), "ok"); mkdirSync(join(root, "a"));
    symlinkSync(base, join(root, "escape")); linkSync(join(root, "z"), join(base, "alias"));
    const s = await setup();
    expect(details(await s.call("gk_fs_dir_list"))).toEqual({ entries: [
      { name: "a", kind: "directory" }, { name: "escape", kind: "unavailable" }, { name: "z", kind: "unavailable" },
    ] });
    await expect(s.call("gk_fs_file_read", { path: "z" })).rejects.toThrow();
    await expect(s.call("gk_fs_dir_list", { subpath: "escape" })).rejects.toThrow();
  });
  it("rejects symlink components and outside files without exposing a native path", async () => {
    writeFileSync(join(base, "private"), "PRIVATE_FIXTURE"); symlinkSync(base, join(root, "alias"));
    symlinkSync(join(base, "private"), join(root, "leaf"));
    const s = await setup();
    for (const path of ["alias/private", "leaf", "../private", "/private"]) {
      try { await s.call("gk_fs_file_read", { path }); throw new Error("expected denial"); }
      catch (error) { expect(String(error)).not.toContain(base); expect(String(error)).not.toContain("PRIVATE_FIXTURE"); }
    }
  });
  it("rejects invalid UTF-8, NUL, oversized files, directories and missing files", async () => {
    writeFileSync(join(root, "invalid"), Buffer.from([0xff])); writeFileSync(join(root, "nul"), Buffer.from([1, 0]));
    writeFileSync(join(root, "large"), Buffer.alloc(1048577, 97)); mkdirSync(join(root, "directory"));
    const s = await setup();
    for (const path of ["invalid", "nul", "large", "directory", "missing"]) await expect(s.call("gk_fs_file_read", { path })).rejects.toThrow();
  });
  it("rejects oversized directories rather than returning a truncated result", async () => {
    for (let n = 0; n < 1001; n++) writeFileSync(join(root, String(n)), "");
    await expect((await setup()).call("gk_fs_dir_list")).rejects.toThrow();
  });
  it("refreshes cached observations and denies cached content after identity replacement", async () => {
    writeFileSync(join(root, "text"), "before"); const s = await setup();
    expect(details(await s.call("gk_fs_file_read", { path: "text" }))).toEqual({ path: "text", content: "before" });
    writeFileSync(join(root, "text"), "after");
    expect(details(await s.call("gk_fs_file_read", { path: "text" }))).toEqual({ path: "text", content: "after" });
    renameSync(root, `${root}-old`); mkdirSync(root); writeFileSync(join(root, "text"), "replacement");
    await expect(s.call("gk_fs_file_read", { path: "text" })).rejects.toThrow();
  });
});

describe("authorization, persistence, and simulation", () => {
  it("denies before returning data, including revocation at the final authorization check", async () => {
    writeFileSync(join(root, "text"), "sensitive fixture"); const s = await setup();
    s.queue.denyObservations = true;
    await expect(s.call("gk_fs_file_read", { path: "text" })).rejects.toThrow();
    s.queue.denyObservations = false;
    let checks = 0;
    s.queue.authorizeObservation = async () => { if (++checks === 2) throw new Error("revoked"); };
    await expect(s.call("gk_fs_file_read", { path: "text" })).rejects.toThrow("revoked");
    expect(checks).toBe(2);
  });
  it("denies forged fields, mismatched queues, observers, revoked accounts and closed sessions", async () => {
    const s = await setup();
    await expect(s.call("gk_fs_dir_list", { operatorId: "owner" })).rejects.toThrow();
    await expect(s.session.call("gk_fs_dir_list", { grant }, { ...s.queue.context(), queue: new TestApprovalQueue() })).rejects.toThrow();
    await expect(s.session.call("gk_fs_dir_list", { grant }, { ...s.queue.context(), observers: ["stranger"] })).rejects.toThrow();
    await s.session.close(); await expect(s.call("gk_fs_dir_list")).rejects.toThrow();
    const session = await s.gatekeeper.startSession(s.queue);
    await s.account.revoke(); await expect(session.call("gk_fs_dir_list", { grant }, s.queue.context())).rejects.toThrow();
  });
  it("dry passes and denied submissions cannot modify host files or return their contents", async () => {
    const s = await setup(), p = { grant, path: "new", content: "pending fixture" };
    const dry = await s.session.call("gk_fs_file_write", p, { ...s.queue.context(), dryRun: true });
    expect("kind" in dry && dry.kind).toBe("action"); expect(JSON.stringify(dry)).not.toContain(p.content);
    expect(s.queue.actions).toEqual([]); expect(readdirSync(root)).toEqual([]);
    s.queue.denyActions = true; await expect(s.call("gk_fs_file_write", p)).rejects.toThrow();
    expect(readdirSync(root)).toEqual([]);
  });
  it("reflects queued writes through reads/listings and refreshes, without changing disk", async () => {
    writeFileSync(join(root, "text"), "baseline"); const s = await setup();
    expect(details(await s.call("gk_fs_file_write", { path: "text", content: "pending" }))).toEqual({ path: "text", bytes: 7 });
    expect(readFileSync(join(root, "text"), "utf8")).toBe("baseline");
    writeFileSync(join(root, "text"), "external edit");
    expect(details(await s.call("gk_fs_file_read", { path: "text" }))).toEqual({ path: "text", content: "pending" });
    await s.call("gk_fs_file_write", { path: "new", content: "new content" });
    expect(existsSync(join(root, "new"))).toBe(false);
    expect(details(await s.call("gk_fs_dir_list"))).toEqual({ entries: [{ name: "new", kind: "file" }, { name: "text", kind: "file" }] });
    expect(JSON.stringify(s.queue.actions)).not.toContain("new content");
    await s.gatekeeper.rejectAction(s.queue.actions[0]!.id);
    expect(details(await s.call("gk_fs_file_read", { path: "text" }))).toEqual({ path: "text", content: "external edit" });
    await s.gatekeeper.rejectAction(s.queue.actions[1]!.id);
    await expect(s.call("gk_fs_file_read", { path: "new" })).rejects.toThrow();
  });
  it("survives a vendor restart, isolates operators, and retains pending rejection", async () => {
    const s = await setup(); await s.call("gk_fs_file_write", { path: "new", content: "persistent" }); await s.session.close();
    const r = await resource(), q = new TestApprovalQueue(), session = await r.gatekeeper.startSession(q);
    expect(details(await session.call("gk_fs_file_read", { grant, path: "new" }, q.context()))).toEqual({ path: "new", content: "persistent" });
    const other = await resource(vendor(), "other"), oq = new TestApprovalQueue(), os = await other.gatekeeper.startSession(oq);
    await expect(os.call("gk_fs_file_read", { grant, path: "new" }, oq.context())).rejects.toThrow();
    await r.gatekeeper.rejectAction(1);
    await expect(session.call("gk_fs_file_read", { grant, path: "new" }, q.context())).rejects.toThrow();
  });
  it("does not inherit journals when a directory is replaced across restart", async () => {
    const s = await setup(); await s.call("gk_fs_file_write", { path: "new", content: "old pending" }); await s.session.close();
    renameSync(root, `${root}-old`); mkdirSync(root);
    await expect(resource()).rejects.toThrow();
  });
  it("keeps all host application disabled and preserves external edits and pending rejection", async () => {
    writeFileSync(join(root, "text"), "baseline"); const s = await setup();
    await s.call("gk_fs_file_write", { path: "text", content: "pending" });
    writeFileSync(join(root, "text"), "external");
    await expect(s.gatekeeper.applyAction(1)).rejects.toThrow();
    expect(readFileSync(join(root, "text"), "utf8")).toBe("external");
    await s.gatekeeper.rejectAction(1);
    await s.call("gk_fs_file_write", { path: "new", content: "pending" });
    await expect(s.gatekeeper.applyAction(2)).rejects.toThrow(); expect(existsSync(join(root, "new"))).toBe(false);
    await s.gatekeeper.rejectAction(2);
  });
  it("refuses grants overlapping private state and private state with unsafe permissions", async () => {
    const v = new FsVendor({ stateDir: join(base, "state"), pluginConfig: { roots: [base] }, logger });
    const a = await v.createAccount("owner");
    await expect(a.getGatekeeperFor(pathToFileURL(base).href)).rejects.toThrow();
    const s = await setup();
    const accountStore = join(base, "state", "os", "gatekeepers", "fs");
    const operator = readdirSync(accountStore)[0]!, dir = join(accountStore, operator, readdirSync(join(accountStore, operator)).find(name => !name.endsWith(".json"))!);
    expect(lstatSync(dir).mode & 0o077).toBe(0);
    chmodSync(dir, 0o755);
    await expect(s.call("gk_fs_file_write", { path: "new", content: "pending" })).rejects.toThrow();
  });
});

// This is a fixture-only proof of why prechecks cannot justify enabling host writes.
// Production ConfinedIO exposes no rename/replace API and create() always denies.
describe("host-write feasibility gate", () => {
  it("demonstrates a check-then-rename would overwrite an intervening external edit", () => {
    const target = join(root, "target"), proposed = join(root, "proposed");
    writeFileSync(target, "baseline"); writeFileSync(proposed, "proposal");
    expect(readFileSync(target, "utf8")).toBe("baseline"); // obsolete precheck
    writeFileSync(target, "external edit");
    renameSync(proposed, target); // exactly the unsafe pattern the driver must not use
    expect(readFileSync(target, "utf8")).toBe("proposal");
    expect(() => new ConfinedIO(DirectoryBinding.capture(root)).create("target", "denied", base)).toThrow();
  });
});
