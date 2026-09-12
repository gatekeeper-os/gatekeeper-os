import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { VendorContext } from "@clawkeepers/gatekeeper-kit";
import { TestApprovalQueue } from "@clawkeepers/gatekeeper-kit";
import { FsVendor } from "./vendor.js";
import { directoryUrl } from "./paths.js";

let base: string, root: string, project: string;
const error = "Filesystem resource unavailable.";
function vendor(pluginConfig: Record<string, unknown> = { roots: [root] }) {
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  return new FsVendor({ pluginConfig, stateDir: join(base, "state"), logger } satisfies VendorContext);
}
const url = (path: string) => pathToFileURL(path).href;
beforeEach(() => {
  base = mkdtempSync(join(realpathSync(tmpdir()), "clawos-fs-test-"));
  root = join(base, "root"); project = join(root, "project");
  mkdirSync(project, { recursive: true });
});
afterEach(() => { rmSync(base, { recursive: true, force: true }); });

describe("original file URL validation", () => {
  it.each([
    "file://localhost/tmp", "file://remote/tmp", "file://user:pass@host/tmp", "file://:80/tmp",
    "https:///tmp", "file:/tmp", "file:////tmp", "file:///tmp?", "file:///tmp#",
    "file:///tmp/../etc", "file:///tmp/./dir", "file:///tmp/%2e%2E/etc",
    "file:///tmp/%2fetc", "file:///tmp/%5cetc", "file:///tmp/\\etc",
    "file:///tmp/%00", "file:///tmp/%", "file:///tmp/%FF", "file:///tmp/%0a",
    "file:///tmp//dir", "file:///tmp/a b", " file:///tmp", "file:///tmp\n",
  ])("rejects malformed/non-local/traversing URL #%#", value => {
    expect(() => directoryUrl(value)).toThrow(error);
  });
  it("decodes once, preserving literal percent names and encoded spaces", () => {
    expect(directoryUrl("file:///one%20two/%252e%252e/")).toBe("/one two/%2e%2e");
  });
  it("enforces decoded UTF-8 byte length and rejects invalid Unicode", () => {
    expect(() => directoryUrl(`file:///${"é".repeat(2048)}`)).toThrow(error);
    expect(() => directoryUrl("file:///\ud800")).toThrow(error);
  });
});

describe("operator root boundary", () => {
  it("denies everything by default and never provisions merely by looking up an account", async () => {
    const v = vendor({});
    expect(await v.getAccount("operator")).toBeNull();
    const account = await v.createAccount("operator");
    await expect(account.getGatekeeperFor(url(project))).rejects.toThrow(error);
  });
  it.each([{ roots: null }, { roots: "all" }, { roots: [1] }, { roots: ["relative"] },
    { roots: ["/tmp/../etc"] }, { roots: ["/tmp//a"] }, { roots: ["/tmp/\\a"] },
    { roots: [], ambient: true }])("rejects malformed configuration #%#", config => {
    expect(() => vendor(config)).toThrow(error);
  });
  it("allows the root and descendants, not a sibling prefix, outside path, file, or missing path", async () => {
    const account = await vendor().createAccount("operator");
    expect((await account.getGatekeeperFor(url(root))).resource.type).toBe("dir");
    const child = await account.getGatekeeperFor(url(project));
    expect(child.resourceKey).toBe(url(project));
    expect((await child.gatekeeper.describe()).title).toBe("Directory");
    const sibling = `${root}-other`; mkdirSync(sibling);
    writeFileSync(join(root, "file"), "fixture");
    for (const path of [base, sibling, join(root, "missing"), join(root, "file")]) {
      await expect(account.getGatekeeperFor(url(path))).rejects.toThrow(error);
    }
  });
  it("accepts encoded spaces, not decoded-twice traversal", async () => {
    const path = join(root, "one two", "%2e%2e"); mkdirSync(path, { recursive: true });
    const account = await vendor().createAccount("operator");
    expect((await account.getGatekeeperFor(url(path))).resourceKey).toBe(url(path));
  });
  it("rejects symlinks even when their target is inside the configured root", async () => {
    const account = await vendor().createAccount("operator");
    symlinkSync(project, join(root, "alias"));
    symlinkSync(base, join(root, "escape"));
    for (const path of [join(root, "alias"), join(root, "escape"), join(root, "alias", "child")]) {
      await expect(account.getGatekeeperFor(url(path))).rejects.toThrow(error);
    }
  });
  it("rejects configured symlinks and symlink ancestors, not just the final component", async () => {
    const alias = join(base, "alias"); symlinkSync(root, alias);
    await expect(vendor({ roots: [alias] }).createAccount("operator")).rejects.toThrow(error);
    await expect(vendor({ roots: [join(alias, "project")] }).createAccount("operator")).rejects.toThrow(error);
  });
  it("fails closed if any configured root is unavailable", async () => {
    await expect(vendor({ roots: [root, join(base, "missing")] }).createAccount("operator")).rejects.toThrow(error);
  });
  it("captures configuration instead of allowing caller mutation to broaden roots", async () => {
    const config = { roots: [project] }, v = vendor(config);
    config.roots[0] = base;
    const account = await v.createAccount("operator");
    await expect(account.getGatekeeperFor(url(root))).rejects.toThrow(error);
  });
  it("rejects target replacement and does not silently rebind a cached resource", async () => {
    const account = await vendor().createAccount("operator");
    const result = await account.getGatekeeperFor(url(project));
    renameSync(project, `${project}-old`); mkdirSync(project);
    await expect(result.gatekeeper.describe()).rejects.toThrow(error);
    await expect(account.getGatekeeperFor(url(project))).rejects.toThrow(error);
  });
  it("rejects root replacement and symlink substitution after account creation", async () => {
    const account = await vendor().createAccount("operator");
    renameSync(root, `${root}-old`); mkdirSync(project, { recursive: true });
    await expect(account.getGatekeeperFor(url(project))).rejects.toThrow(error);
    rmSync(root, { recursive: true }); symlinkSync(`${root}-old`, root);
    await expect(account.getGatekeeperFor(url(project))).rejects.toThrow(error);
  });
});

describe("account lifetime and fail-closed application", () => {
  it("reuses live accounts/resources and permanently revokes retained objects", async () => {
    const v = vendor(), account = await v.createAccount("operator");
    expect(await v.createAccount("operator")).toBe(account);
    const result = await account.getGatekeeperFor(url(project));
    expect((await account.getGatekeeperFor(`${url(project)}/`)).gatekeeper).toBe(result.gatekeeper);
    const other = await v.createAccount("other");
    await account.revoke(); await account.revoke();
    expect(await v.getAccount("operator")).toBeNull();
    expect(await v.getAccount("other")).toBe(other);
    await expect(account.describe()).rejects.toThrow(error);
    await expect(account.getGatekeeperFor(url(project))).rejects.toThrow(error);
    await expect(result.gatekeeper.describe()).rejects.toThrow(error);
    expect(await v.createAccount("operator")).not.toBe(account);
    await expect(result.gatekeeper.describe()).rejects.toThrow(error);
  });
  it("offers metadata and guarded sessions but no host application, verifier, or observer path", async () => {
    const v = vendor(), account = await v.createAccount("operator");
    expect((await v.getTools()).map(tool => tool.name)).toEqual(["gk_fs_dir_list", "gk_fs_file_read", "gk_fs_file_write"]);
    expect(await account.getSupportedResources()).toEqual(await v.getSupportedResources());
    const { gatekeeper } = await account.getGatekeeperFor(url(project));
    expect(await gatekeeper.getAutoApprovableActions()).toEqual([]);
    const queue = new TestApprovalQueue();
    const session = await gatekeeper.startSession(queue);
    await session.close();
    await expect(session.call("gk_fs_dir_list", { grant: "grant:01234567" }, queue.context())).rejects.toThrow();
    await expect(gatekeeper.applyAction(1)).rejects.toThrow(error);
    await expect(gatekeeper.rejectAction(1)).rejects.toThrow();
    await expect(gatekeeper.revertAction!(1)).rejects.toThrow(error);
    await expect(gatekeeper.addObserver("other", { vendor: "fs", opaque: "forged" })).rejects.toThrow();
    await expect(account.getVerifier()).rejects.toThrow(error);
    await expect(account.reconnect()).rejects.toThrow(error);
    await expect(v.connectAccount()).rejects.toThrow(error);
  });
  it("returns detached metadata, and only sanitized errors", async () => {
    const v = vendor();
    (await v.getSupportedResources())[0]!.tools.length = 0;
    expect((await v.getSupportedResources())[0]!.tools.length).toBe(3);
    const account = await v.createAccount("operator");
    try { await account.getGatekeeperFor(url(join(root, "private-missing"))); throw new Error("Expected denial"); }
    catch (caught) { expect((caught as Error).message).toBe(error); }
  });
});
