import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, copyFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenStore } from "./token-store.js";
const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), "clawos-token-test-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
describe("TokenStore", () => {
  it("round-trips encrypted with fresh nonces and private file permissions", () => {
    const d = dir(), key = randomBytes(32), store = new TokenStore(d, key);
    const record = { token: "test-credential-not-a-real-token" };
    store.put("operator", record); const path = join(d, readdirSync(d)[0]!); const first = readFileSync(path, "utf8");
    expect(first).not.toContain(record.token); expect(statSync(path).mode & 0o777).toBe(0o600); expect(statSync(d).mode & 0o777).toBe(0o700);
    store.put("operator", record); expect(readFileSync(path, "utf8")).not.toBe(first);
    expect(new TokenStore(d, key).get("operator")).toEqual(record); expect(store.get("absent")).toBeNull();
  });
  it("treats operator ids as opaque strings, never filesystem paths", () => {
    const d = dir(), store = new TokenStore(d, randomBytes(32));
    for (const id of ["../../escape", "/absolute", "channel:user", "🦞"]) { store.put(id, { value: id }); expect(store.get(id)).toEqual({ value: id }); }
    expect(readdirSync(d).every(name => /^[0-9a-f]{64}\.json$/.test(name))).toBe(true);
  });
  it("rejects tampering, wrong keys and ciphertext copied across accounts or stores", () => {
    const d = dir(), key = randomBytes(32), store = new TokenStore(d, key);
    store.put("a", { value: "private" }); const source = join(d, readdirSync(d)[0]!);
    expect(() => new TokenStore(d, randomBytes(32)).get("a")).toThrow(/decrypted/);
    store.put("b", { value: "other" }); const dest = join(d, readdirSync(d).find(name => join(d, name) !== source)!);
    copyFileSync(source, dest); expect(() => store.get("b")).toThrow(/decrypted/);
    const other = dir(); copyFileSync(source, join(other, source.split("/").at(-1)!)); expect(() => new TokenStore(other, key).get("a")).toThrow(/decrypted/);
    const envelope = JSON.parse(readFileSync(source, "utf8")); envelope.ct = "AAAA"; writeFileSync(source, JSON.stringify(envelope)); expect(() => store.get("a")).toThrow(/decrypted/);
  });
  it("coalesces refresh and recovers from failure without leaking vendor messages", async () => {
    const store = new TokenStore(dir(), randomBytes(32)), refresh = vi.fn(async () => ({ value: 2 }));
    expect(await Promise.all([store.refresh("op", refresh), store.refresh("op", refresh)])).toEqual([{ value: 2 }, { value: 2 }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    await expect(store.refresh("op", async () => { throw new Error("private vendor body"); })).rejects.toThrow("Credential refresh failed.");
    expect(await store.refresh("op", refresh)).toEqual({ value: 2 });
  });
  it("does not resurrect credentials after revocation during a refresh", async () => {
    const store = new TokenStore(dir(), randomBytes(32)); store.put("op", { value: 1 });
    let finish!: (value: unknown) => void;
    const pending = store.refresh("op", () => new Promise(resolve => { finish = resolve; }));
    await Promise.resolve(); store.remove("op"); finish({ value: 2 });
    await expect(pending).rejects.toThrow(/failed/); expect(store.get("op")).toBeNull();
  });
});
