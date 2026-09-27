// VM checkpoint scenarios for real filesystem apply (plans/fs-contract.md, Amendment 2026-09-27).
// Runs the product driver from source on the guest's Node; prints structural evidence only (no host paths or bodies).
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TestApprovalQueue } from "../../packages/gatekeeper-kit/src/testing.ts";
import { FsDirectory } from "../../packages/gkos-gatekeeper-fs/src/directory.ts";
import { DirectoryBinding } from "../../packages/gkos-gatekeeper-fs/src/paths.ts";
import { ConfinedIO } from "../../packages/gkos-gatekeeper-fs/src/io.ts";
import { systemPublisher } from "../../packages/gkos-gatekeeper-fs/src/publish.ts";
import type { Boundary } from "../../packages/gkos-gatekeeper-fs/src/apply.ts";

const [mode, workRoot] = process.argv.slice(2);
if (!workRoot) throw new Error("usage: fs-apply-checkpoint.ts scenarios|mount-probe <dir>");

if (mode === "mount-probe") {
  // Called while a root-created bind mount covers <dir>/root/sub. Resolution must refuse to cross it.
  const io = new ConfinedIO(DirectoryBinding.capture(join(workRoot, "root")));
  let read = "denied", anchor = "denied";
  try { read = JSON.stringify(io.read("sub/file")); } catch { /* expected */ }
  try { io.anchor("sub").close(); anchor = "opened"; } catch { /* expected */ }
  process.stdout.write(JSON.stringify({ mountInterposition: read === "denied" && anchor === "denied" ? "refused" : "crossed" }) + "\n");
  process.exit(0);
}

const grant = "grant:01234567";
const results: Record<string, unknown> = { publishMode: systemPublisher().mode };
function assert(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(`fs-apply checkpoint: ${code}`); }
const text = (path: string) => readFileSync(path, "utf8");

async function scenario(name: string, fn: (ctx: { root: string; outside: string; state: string; open: (at?: Boundary, mutate?: () => void) => Promise<{ gatekeeper: FsDirectory; write: (path: string, content: string) => Promise<unknown> }> }) => Promise<unknown>) {
  const base = mkdtempSync(join(workRoot, `${name}-`)), root = join(base, "root"), outside = join(base, "outside"), state = join(base, "state");
  mkdirSync(root); mkdirSync(outside); writeFileSync(join(outside, "sentinel"), "OUTSIDE_SENTINEL");
  const open = async (at?: Boundary, mutate?: () => void) => {
    let fired = false;
    const gatekeeper = new FsDirectory(DirectoryBinding.capture(root), () => {}, state, at ? { hooks: { at: point => { if (point === at && !fired) { fired = true; mutate!(); } } } } : {});
    const queue = new TestApprovalQueue(), session = await gatekeeper.startSession(queue);
    let n = 0;
    return { gatekeeper, write: (path: string, content: string) => session.call("gk_fs_file_write", { grant, path, content }, queue.context(String(++n))) };
  };
  try {
    results[name] = await fn({ root, outside, state, open });
    assert(text(join(outside, "sentinel")) === "OUTSIDE_SENTINEL", `${name}-outside-sentinel`);
  } finally { rmSync(base, { recursive: true, force: true }); }
}
const receipt = (state: string, id: number) => JSON.parse(readFileSync(join(state, `apply-${id}.receipt.json`), "utf8")) as { publish: string; bytes: number; path: string };
const phase = (state: string, id: number, kind = "apply") => existsSync(join(state, `${kind}-${id}.tx.json`)) ? (JSON.parse(readFileSync(join(state, `${kind}-${id}.tx.json`), "utf8")) as { phase: string }).phase : "none";

await scenario("realWrite", async ({ root, state, open }) => {
  writeFileSync(join(root, "file"), "baseline\n");
  const w = await open();
  await w.write("file", "applied\n"); await w.write("new", "created\n");
  assert(text(join(root, "file")) === "baseline\n" && !existsSync(join(root, "new")), "premature-effect");
  await w.gatekeeper.applyAction(1); await w.gatekeeper.applyAction(2);
  assert(text(join(root, "file")) === "applied\n" && text(join(root, "new")) === "created\n", "write-not-landed");
  assert(readdirSync(root).sort().join() === "file,new", "stage-left-behind");
  return { replace: receipt(state, 1).publish, create: receipt(state, 2).publish, receipts: phase(state, 1) === "applied" && phase(state, 2) === "applied" };
});

await scenario("refusal", async ({ root, outside, state, open }) => {
  writeFileSync(join(root, "stale"), "baseline"); writeFileSync(join(root, "link"), "baseline");
  const w = await open();
  await w.write("stale", "desired"); await w.write("link", "desired");
  writeFileSync(join(root, "stale"), "external edit");
  let refusedStale = false; try { await w.gatekeeper.applyAction(1); } catch { refusedStale = true; }
  assert(refusedStale && text(join(root, "stale")) === "external edit" && phase(state, 1) === "none", "stale-baseline-not-refused");
  await w.gatekeeper.rejectAction(1);
  rmSync(join(root, "link")); symlinkSync(join(outside, "sentinel"), join(root, "link"));
  let refusedLink = false; try { await w.gatekeeper.applyAction(2); } catch { refusedLink = true; }
  assert(refusedLink && lstatSync(join(root, "link")).isSymbolicLink() && phase(state, 2) === "none", "symlink-target-not-refused");
  return { staleBaseline: "refused", symlinkTarget: "refused", mutated: false };
});

async function ce2(at: Boundary) {
  let outcome: Record<string, unknown> = {};
  await scenario(`ce2-${at}`, async ({ root, state, open }) => {
    writeFileSync(join(root, "file"), "BASELINE");
    const w = await open(at, () => { writeFileSync(join(root, ".editor"), "EXTERNAL EDIT"); renameSync(join(root, ".editor"), join(root, "file")); });
    await w.write("file", "DESIRED");
    let applied = true; try { await w.gatekeeper.applyAction(1); } catch { applied = false; }
    const kept = readdirSync(root).map(name => text(join(root, name)));
    let blocked = false; try { await w.gatekeeper.applyAction(1); } catch { blocked = true; }
    outcome = { detected: !applied, externalKept: kept.includes("EXTERNAL EDIT"), oursKept: kept.includes("DESIRED"), phase: phase(state, 1), blocked };
    return outcome;
  });
  return outcome;
}
// Before the final check CE-2 is refused in every mode; in the window only exchange can observe it (documented residual for rename).
const before = await ce2("publishing");
assert(before.detected && before.externalKept && before.oursKept && before.phase === "uncertain" && before.blocked, "ce2-before-recheck");
const window = await ce2("rechecked");
if (results.publishMode === "exchange") assert(window.detected && window.externalKept && window.oursKept, "ce2-exchange-window");
results.ce2 = { beforeRecheck: "detected, both kept, resource blocked", window: results.publishMode === "exchange" ? "detected, both kept" : window.externalKept ? "kept" : "lost (documented rename residual)" };

await scenario("revert", async ({ root, open }) => {
  writeFileSync(join(root, "file"), "BASELINE"); writeFileSync(join(root, "edited"), "BASELINE");
  const w = await open();
  await w.write("file", "DESIRED"); await w.write("edited", "DESIRED");
  await w.gatekeeper.applyAction(1); await w.gatekeeper.applyAction(2);
  await w.gatekeeper.revertAction(1);
  assert(text(join(root, "file")) === "BASELINE", "revert-not-restored");
  writeFileSync(join(root, "edited"), "LATER EDIT");
  let refused = false; try { await w.gatekeeper.revertAction(2); } catch { refused = true; }
  assert(refused && text(join(root, "edited")) === "LATER EDIT", "revert-overwrote-edit");
  return { restored: true, interveningEdit: "refused" };
});

process.stdout.write(JSON.stringify(results) + "\n");
