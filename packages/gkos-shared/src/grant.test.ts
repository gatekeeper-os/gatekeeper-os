import { describe, expect, it } from "vitest";
import { GRANT_HANDLE_RE } from "./grant.js";

describe("grant handle", () => {
  it("accepts 8-char base32 handles", () => { expect(GRANT_HANDLE_RE.test("grant:7k3m9q2p")).toBe(true); });
  it("rejects resource-bearing strings", () => { expect(GRANT_HANDLE_RE.test("grant:owner/repo")).toBe(false); });
});
