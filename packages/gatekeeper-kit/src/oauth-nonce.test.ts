import { describe, expect, it } from "vitest";
import { OAuthNonceMachine } from "./oauth-nonce.js";
describe("OAuthNonceMachine", () => {
  it("requires both stages, rotates the nonce, and rejects replay at each stage", () => {
    const m = new OAuthNonceMachine(), first = m.issue("op"), second = m.advance(first)!;
    expect(second).not.toBe(first); expect(m.advance(first)).toBeNull();
    expect(m.consume(second)).toBe("op"); expect(m.consume(second)).toBeNull();
  });
  it("cannot consume a stage-one nonce as a callback", () => {
    const m = new OAuthNonceMachine(), first = m.issue("op");
    expect(m.consume(first)).toBeNull(); expect(m.advance(first)).toBeNull();
  });
  it("does not extend expiry during transition and rejects exact-boundary expiry", () => {
    let now = 0; const m = new OAuthNonceMachine(100, () => now);
    const first = m.issue("op"); now = 99; const second = m.advance(first)!;
    now = 100; expect(m.consume(second)).toBeNull();
    const expired = m.issue("op"); now = 201; expect(m.advance(expired)).toBeNull();
  });
  it("isolates operators and safely rejects malformed unicode and unknown values", () => {
    const m = new OAuthNonceMachine(), a = m.advance(m.issue("a"))!, b = m.advance(m.issue("b"))!;
    for (const bad of ["nope", "é".repeat(32), "x".repeat(32), ""]) expect(m.consume(bad)).toBeNull();
    expect(m.consume(a)).toBe("a"); expect(m.consume(b)).toBe("b");
  });
  it("sweeps expired records", () => { const m = new OAuthNonceMachine(-1); const n = m.issue("op"); m.sweep(); expect(m.advance(n)).toBeNull(); });
});
