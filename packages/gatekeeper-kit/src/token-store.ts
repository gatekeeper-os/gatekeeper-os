import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./atomic-json.js";

/** AES-256-GCM account storage. Ciphertext is bound to both canonical store and exact operator identity. */
export class TokenStore {
  private readonly key: Buffer;
  private readonly dir: string;
  private refreshes = new Map<string, Promise<unknown>>();
  private generations = new Map<string, number>();
  constructor(dir: string, cellKey: Buffer) {
    if (cellKey.length !== 32) throw new Error("A 32-byte cell key is required.");
    mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
    this.dir = realpathSync(dir); this.key = Buffer.from(cellKey);
  }
  private path(id: string): string {
    if (!id) throw new Error("Operator required.");
    return join(this.dir, `${createHash("sha256").update(id).digest("hex")}.json`);
  }
  private aad(id: string): Buffer { return Buffer.from(JSON.stringify(["clawos-token-v1", this.dir, id])); }
  /** Encrypt and atomically replace one account record; plaintext is never written. */
  put(operatorId: string, value: unknown): void {
    const path = this.path(operatorId);
    const plaintext = JSON.stringify(value);
    if (plaintext === undefined) throw new Error("Token record must be JSON.");
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.aad(operatorId));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    writeJsonAtomic(path, { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64") });
    this.generations.set(operatorId, (this.generations.get(operatorId) ?? 0) + 1);
  }
  /** Return null only for an absent account. Tampering, wrong keys and corrupt envelopes fail closed. */
  get<T = unknown>(operatorId: string): T | null {
    const path = this.path(operatorId);
    try {
      const data = readJson(path);
      if (data === undefined) return null;
      const j = data as { v: unknown; iv: string; tag: string; ct: string };
      if (j.v !== 1 || typeof j.iv !== "string" || typeof j.tag !== "string" || typeof j.ct !== "string") throw new Error();
      const iv = Buffer.from(j.iv, "base64"), tag = Buffer.from(j.tag, "base64");
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(this.aad(operatorId)); decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(j.ct, "base64")), decipher.final()]).toString("utf8")) as T;
    } catch { throw new Error("Credential record could not be decrypted."); }
  }
  /** Delete an account and invalidate any in-flight refresh so it cannot restore revoked credentials. */
  remove(operatorId: string): void {
    const path = this.path(operatorId);
    try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Credential removal failed."); }
    this.generations.set(operatorId, (this.generations.get(operatorId) ?? 0) + 1);
  }
  /** Share one refresh per account. A concurrent put/remove makes its stale result fail closed. */
  refresh<T>(operatorId: string, operation: () => Promise<T>): Promise<T> {
    this.path(operatorId);
    const existing = this.refreshes.get(operatorId);
    if (existing) return existing as Promise<T>;
    const generation = this.generations.get(operatorId) ?? 0;
    const pending = Promise.resolve().then(operation).then(value => {
      if ((this.generations.get(operatorId) ?? 0) !== generation) throw new Error("Credential refresh superseded.");
      this.put(operatorId, value); return value;
    }).catch(() => { throw new Error("Credential refresh failed."); });
    this.refreshes.set(operatorId, pending);
    void pending.finally(() => { if (this.refreshes.get(operatorId) === pending) this.refreshes.delete(operatorId); }).catch(() => {});
    return pending;
  }
}
