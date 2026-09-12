import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestApprovalQueue } from "@clawkeepers/gatekeeper-kit";
import { McpServer, describeAppend, projectNote } from "./server.js";
import { FixtureNotesServer, NotesFixture } from "./testing/notes-fixture.js";
const dirs: string[] = [];
const read = "gk_mcp_demo_read_note", append = "gk_mcp_demo_append_note";
const params = { grant: "grant:abcd1234", noteId: "note1" };
const write = { ...params, text: "-append" };
function setup(fixture = false) {
  const path = mkdtempSync(join(tmpdir(), "mcp-session-")); dirs.push(path);
  let active = true;
  const live = () => { if (!active) throw new Error("revoked"); };
  const provider = new NotesFixture(), fetch = vi.fn(async (id: string) => provider.read(id));
  const server = fixture ? new FixtureNotesServer(provider, live, path) : new McpServer(live, fetch, path);
  const queue = new TestApprovalQueue();
  return { path, provider, fetch, server, queue, live, revoke: () => { active = false; } };
}
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });
it("keeps descriptions pure, generic flags truthful and native append entirely unavailable", async () => {
  const { server, fetch, queue, path } = setup(), session = await server.startSession(queue);
  expect(describeAppend(write)).toMatchObject({ awaitDecision: true, autoApprovable: false, implementsRevert: false });
  expect(server.actions[append]?.simulate).toBeUndefined(); expect(server.actions[append]?.revert).toBeUndefined();
  expect(server.resource.tools).toEqual([read]);
  await session.call(read, params, { ...queue.context(), dryRun: true });
  expect(fetch).not.toHaveBeenCalled(); expect(queue.observations).toHaveLength(0); expect(existsSync(join(path, "cache/latest.json"))).toBe(false);
  await expect(session.call(append, write, { ...queue.context(), actionApproval: { toolCallId: "test-call", tool: append, params: write } })).rejects.toThrow();
  await expect(server.actions[append]!.apply(write, 1)).rejects.toThrow();
  await expect(server.applyAction(1)).rejects.toThrow(); expect(queue.actions).toHaveLength(0);
});
it("authorizes before fetching and again before release, persists only bounded projected fields", async () => {
  const { server, fetch, queue, path } = setup(), session = await server.startSession(queue);
  fetch.mockResolvedValueOnce({ noteId: "note1", text: "x".repeat(9000), revision: 2, extra: "not-retained" } as ReturnType<NotesFixture["read"]>);
  const result = await session.call(read, params, queue.context());
  expect(result).toHaveProperty("details", { noteId: "note1", text: "x".repeat(8192), revision: 2, truncated: true });
  expect(queue.observations).toHaveLength(2); expect(readFileSync(join(path, "cache/latest.json"), "utf8")).not.toContain("not-retained");
  queue.denyObservations = true;
  await expect(session.call(read, params, queue.context())).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
});
it("refreshes on every read and never falls back to stale cache on provider failure", async () => {
  const { server, fetch, queue, provider } = setup(), session = await server.startSession(queue);
  await session.call(read, params, queue.context()); provider.text = "changed";
  expect(await session.call(read, params, queue.context())).toHaveProperty("details.text", "changed");
  fetch.mockRejectedValueOnce(new Error("private-server-error"));
  await expect(session.call(read, params, queue.context())).rejects.toThrow("MCP boundary unavailable.");
});
it("denies revocation during I/O and during final authorization", async () => {
  for (const stage of ["fetch", "authorize"]) {
    const { server, fetch, queue, revoke, provider } = setup(), session = await server.startSession(queue);
    if (stage === "fetch") fetch.mockImplementationOnce(async id => { revoke(); return provider.read(id); });
    else { let count = 0; queue.authorizeObservation = async () => { if (++count === 2) revoke(); }; }
    await expect(session.call(read, params, queue.context())).rejects.toThrow();
  }
});
it("denies foreign queues, shared audiences, closed sessions and injected parameters before reads", async () => {
  const { server, fetch, queue } = setup(), session = await server.startSession(queue);
  for (const ctx of [{ ...queue.context(), queue: new TestApprovalQueue() }, { ...queue.context(), observers: ["observer"] }, { ...queue.context(), agentId: "" }])
    await expect(session.call(read, params, ctx)).rejects.toThrow();
  for (const p of [{ ...params, endpoint: "https://evil.invalid" }, { ...params, noteId: "../note" }, { ...params, tool: "notes.append" }, { ...params, text: "injection" }])
    await expect(session.call(read, p, queue.context())).rejects.toThrow();
  await expect(server.addObserver("other", { vendor: "mcp", opaque: "fake" })).rejects.toThrow();
  await session.close(); await expect(session.call(read, params, queue.context())).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
it.each([null, { noteId: "wrong", text: "x", revision: 1 }, { noteId: "note1", text: {}, revision: 1 }, { noteId: "note1", text: "x", revision: -1 }, { noteId: "note1", text: "x", revision: 1.1 }, { noteId: "note1", text: "x".repeat(65537), revision: 1 }])("rejects invalid output %#", value => {
  expect(() => projectNote(value, "note1")).toThrow();
});
it("fixture deferred path simulates without effect, replays on refresh/restart, applies once, and rejects without effect", async () => {
  const { server, queue, provider, path, live } = setup(true), session = await server.startSession(queue);
  await session.call(append, write, queue.context("one")); expect(provider.effects).toBe(0);
  expect(queue.actions[0]!.description).toMatchObject({ awaitDecision: false, implementsRevert: false, autoApprovable: false });
  provider.text = "refreshed";
  expect(await session.call(read, params, queue.context())).toHaveProperty("details.text", "refreshed-append");
  const restored = new FixtureNotesServer(provider, live, path), second = await restored.startSession(queue);
  expect(await second.call(read, params, queue.context())).toHaveProperty("details.text", "refreshed-append");
  await restored.applyAction(1); await restored.applyAction(1); expect(provider.effects).toBe(1);
  expect(await second.call(read, params, queue.context())).toHaveProperty("details.text", "refreshed-append");
  await second.call(append, write, queue.context("two")); await restored.rejectAction(2);
  expect(await second.call(read, params, queue.context())).toHaveProperty("details.text", "refreshed-append");
  await expect(restored.revertAction(1)).rejects.toThrow();
  await expect(second.call(append, write, queue.context("one"))).rejects.toThrow(); expect(provider.effects).toBe(1);
});
it("fixture ambiguous write blocks replay and further sessions across restart", async () => {
  const { server, queue, provider, path, live } = setup(true), session = await server.startSession(queue);
  await session.call(append, write, queue.context()); provider.failAfterEffect = true;
  await expect(server.applyAction(1)).rejects.toThrow(); expect(provider.effects).toBe(1);
  expect(JSON.parse(readFileSync(join(path, "actions.json"), "utf8")).records[0].status).toBe("uncertain");
  const restored = new FixtureNotesServer(provider, live, path);
  await expect(restored.applyAction(1)).rejects.toThrow(); await expect(restored.rejectAction(1)).rejects.toThrow();
  await expect(restored.startSession(queue)).rejects.toThrow(); expect(provider.effects).toBe(1);
});
it("fixture queue failure creates no effect and fails closed across restart", async () => {
  const { server, queue, provider, path, live } = setup(true), session = await server.startSession(queue); queue.denyActions = true;
  await expect(session.call(append, write, queue.context())).rejects.toThrow(); expect(provider.effects).toBe(0);
  await expect(new FixtureNotesServer(provider, live, path).startSession(queue)).rejects.toThrow();
});
