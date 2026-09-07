import { randomBytes, timingSafeEqual } from "node:crypto";

/** Two-stage OAuth nonce machine (cloudflare-os SKELETON.md): 10-minute lifetime, timing-safe compare, single use. */
export class OAuthNonceMachine {
  private pending = new Map<string, { operatorId: string; expiresAt: number; stage: 1 | 2 }>();
  constructor(private ttlMs = 10 * 60_000) {}
  issue(operatorId: string): string {
    const nonce = randomBytes(24).toString("base64url");
    this.pending.set(nonce, { operatorId, expiresAt: Date.now() + this.ttlMs, stage: 1 });
    return nonce;
  }
  /** Consumes the nonce. Returns the operator id or null (expired, unknown, or replayed). */
  consume(nonce: string): string | null {
    for (const [k, v] of this.pending) {
      if (k.length === nonce.length && timingSafeEqual(Buffer.from(k), Buffer.from(nonce))) {
        this.pending.delete(k);
        return v.expiresAt > Date.now() ? v.operatorId : null;
      }
    }
    return null;
  }
  sweep() { const now = Date.now(); for (const [k, v] of this.pending) if (v.expiresAt <= now) this.pending.delete(k); }
}
