import { randomBytes, timingSafeEqual } from "node:crypto";

/** Two-stage, operator-bound OAuth nonces. Advancing never extends the original lifetime. */
export class OAuthNonceMachine {
  private pending = new Map<string, { operatorId: string; expiresAt: number; stage: 1 | 2 }>();
  constructor(private readonly ttlMs = 10 * 60_000, private readonly now: () => number = Date.now) {}
  /** Issue the first nonce for a local operator-initiated authorization flow. */
  issue(operatorId: string): string {
    if (!operatorId) throw new Error("Operator required.");
    this.sweep();
    const nonce = randomBytes(24).toString("base64url");
    this.pending.set(nonce, { operatorId, expiresAt: this.now() + this.ttlMs, stage: 1 });
    return nonce;
  }
  /** Consume stage one and mint a distinct callback nonce for stage two. */
  advance(nonce: string): string | null { return this.advanceBound(nonce)?.nonce ?? null; }
  /** Rotate stage one while returning its trusted binding to the authorization router. */
  advanceBound(nonce: string): { nonce: string; operatorId: string } | null {
    const record = this.take(nonce, 1);
    if (!record) return null;
    const next = randomBytes(24).toString("base64url");
    this.pending.set(next, { ...record, stage: 2 });
    return { nonce: next, operatorId: record.operatorId };
  }
  /** Consume only a stage-two callback, exactly once. Invalid, expired and replayed values deny. */
  consume(nonce: string): string | null { return this.take(nonce, 2)?.operatorId ?? null; }
  private take(nonce: string, stage: 1 | 2) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(nonce)) return null;
    for (const [key, record] of this.pending) {
      if (timingSafeEqual(Buffer.from(key), Buffer.from(nonce))) {
        this.pending.delete(key);
        return record.stage === stage && record.expiresAt > this.now() ? record : null;
      }
    }
    return null;
  }
  /** Remove expired records without accepting them. */
  sweep(): void { for (const [key, record] of this.pending) if (record.expiresAt <= this.now()) this.pending.delete(key); }
}
