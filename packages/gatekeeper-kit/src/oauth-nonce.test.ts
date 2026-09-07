import { describe, expect, it } from "vitest";
import { OAuthNonceMachine } from "./oauth-nonce.js";

describe("OAuthNonceMachine", () => {
  it("consumes once", () => { const m = new OAuthNonceMachine(); const n = m.issue("op"); expect(m.consume(n)).toBe("op"); expect(m.consume(n)).toBeNull(); });
  it("rejects expired", () => { const m = new OAuthNonceMachine(-1); const n = m.issue("op"); expect(m.consume(n)).toBeNull(); });
  it("rejects unknown", () => { expect(new OAuthNonceMachine().consume("nope")).toBeNull(); });
});
