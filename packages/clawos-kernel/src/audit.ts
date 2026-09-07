/** Append-only JSONL audit log (plan §4.8). Never contains secrets, prompts, headers, tokens, or bodies. */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AuditRecord } from "@clawos/shared";

export class AuditLog {
  constructor(private dir: string) { mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  write(r: AuditRecord) { const day = r.ts.slice(0, 10); appendFileSync(join(this.dir, `${day}.jsonl`), JSON.stringify(r) + "\n", { mode: 0o600 }); }
  async flush() {}
}
