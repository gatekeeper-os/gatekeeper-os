/** Kernel state store on node:sqlite (plan §5.3). Forward-only migrations; schema version recorded in clawos.lock.json. */
import { DatabaseSync } from "node:sqlite";
import type { Grant } from "@clawos/shared";

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS grants (handle TEXT PRIMARY KEY, agentId TEXT NOT NULL, cellId TEXT NOT NULL, vendor TEXT NOT NULL,
     resourceType TEXT NOT NULL, resourceKey TEXT NOT NULL, operatorId TEXT NOT NULL, scope TEXT NOT NULL, audience TEXT NOT NULL,
     status TEXT NOT NULL, createdAt INTEGER NOT NULL, createdBy TEXT NOT NULL, expiresAt INTEGER, title TEXT);
   CREATE TABLE IF NOT EXISTS instances (id TEXT PRIMARY KEY, vendor TEXT NOT NULL, resourceKey TEXT NOT NULL, operatorId TEXT NOT NULL,
     observerStrategy TEXT NOT NULL, lockdown INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS actions (id INTEGER PRIMARY KEY AUTOINCREMENT, gatekeeperInstance TEXT NOT NULL, actionId INTEGER NOT NULL,
     descriptionJson TEXT NOT NULL, status TEXT NOT NULL, submittedAt INTEGER NOT NULL, decidedBy TEXT, decidedAt INTEGER, appliedAt INTEGER, error TEXT);
   CREATE TABLE IF NOT EXISTS introductions (id INTEGER PRIMARY KEY AUTOINCREMENT, agentId TEXT NOT NULL, url TEXT NOT NULL, reason TEXT,
     status TEXT NOT NULL, createdAt INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS observers (sessionKey TEXT NOT NULL, observerId TEXT NOT NULL, PRIMARY KEY (sessionKey, observerId));
   CREATE TABLE IF NOT EXISTS audit_index (ts TEXT NOT NULL, kind TEXT NOT NULL, agentId TEXT, handle TEXT, file TEXT NOT NULL, line INTEGER NOT NULL);
   INSERT OR REPLACE INTO meta (k, v) VALUES ('schema', '1');`,
];

export class Store {
  private db: DatabaseSync;
  constructor(path: string) { this.db = new DatabaseSync(path); this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;"); }
  migrate() { for (const sql of MIGRATIONS) this.db.exec(sql); }
  getGrant(handle: string): Grant | null { return (this.db.prepare("SELECT * FROM grants WHERE handle = ?").get(handle) as Grant | undefined) ?? null; }
  isActiveHandle(handle: unknown): boolean { return typeof handle === "string" && this.getGrant(handle)?.status === "active"; }
  listGrants(agentId: string): Grant[] { return this.db.prepare("SELECT * FROM grants WHERE agentId = ? AND status = 'active'").all(agentId) as unknown as Grant[]; }
  countPending(): number { return Number((this.db.prepare("SELECT COUNT(*) AS n FROM actions WHERE status = 'pending'").get() as { n: number }).n); }
  // TODO(phase-3): insertGrant, setGrantStatus, actions CRUD, introductions, observers, audit index.
}
