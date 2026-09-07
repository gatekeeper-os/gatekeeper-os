import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TokenStore } from "./token-store.js";

describe("TokenStore", () => {
  it("round-trips and does not store plaintext", () => {
    const dir = mkdtempSync(join(tmpdir(), "ts-")); const s = new TokenStore(dir, randomBytes(32));
    s.put("op1", { token: "ghp_fakeTOKEN123" });
    expect(s.get("op1")).toEqual({ token: "ghp_fakeTOKEN123" });
    expect(readFileSync(join(dir, "op1.json"), "utf8")).not.toContain("ghp_");
  });
});
