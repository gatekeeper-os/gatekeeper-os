import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Encrypted-at-rest per-operator credential store: <stateDir>/os/gatekeepers/<vendor>/accounts/<operatorId>.json (plan §7.4). */
export class TokenStore {
  constructor(private dir: string, private cellKey: Buffer) { mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  put(operatorId: string, value: unknown) {
    const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", this.cellKey, iv);
    const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
    writeFileSync(join(this.dir, `${operatorId}.json`), JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") }), { mode: 0o600 });
  }
  get<T = unknown>(operatorId: string): T | null {
    try {
      const j = JSON.parse(readFileSync(join(this.dir, `${operatorId}.json`), "utf8"));
      const d = createDecipheriv("aes-256-gcm", this.cellKey, Buffer.from(j.iv, "base64")); d.setAuthTag(Buffer.from(j.tag, "base64"));
      return JSON.parse(Buffer.concat([d.update(Buffer.from(j.ct, "base64")), d.final()]).toString("utf8")) as T;
    } catch { return null; }
  }
}
