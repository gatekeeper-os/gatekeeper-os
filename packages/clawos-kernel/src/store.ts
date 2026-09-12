/** Persistent kernel state. All mutations are synchronous, transactional, and fail closed. */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { ActionDescription, Grant, GrantStatus, PendingAction } from "@clawos/shared";

type Database = import("node:sqlite").DatabaseSync;
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
export interface InstanceRecord { id:string; vendor:string; resourceKey:string; operatorId:string; observerStrategy:string; lockdown:number; }
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grants(handle TEXT PRIMARY KEY,agentId TEXT NOT NULL,cellId TEXT NOT NULL,vendor TEXT NOT NULL,resourceType TEXT NOT NULL,resourceKey TEXT NOT NULL,operatorId TEXT NOT NULL,scope TEXT NOT NULL,audience TEXT NOT NULL,status TEXT NOT NULL,createdAt INTEGER NOT NULL,createdBy TEXT NOT NULL,expiresAt INTEGER,title TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS grant_identity ON grants(agentId,vendor,resourceType,resourceKey,operatorId,scope);
CREATE TABLE IF NOT EXISTS instances(id TEXT PRIMARY KEY,vendor TEXT NOT NULL,resourceKey TEXT NOT NULL,operatorId TEXT NOT NULL,observerStrategy TEXT NOT NULL,lockdown INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS actions(id INTEGER PRIMARY KEY AUTOINCREMENT,gatekeeperInstance TEXT NOT NULL,actionId INTEGER NOT NULL,descriptionJson TEXT NOT NULL,status TEXT NOT NULL,submittedAt INTEGER NOT NULL,decidedBy TEXT,decidedAt INTEGER,appliedAt INTEGER,error TEXT,UNIQUE(gatekeeperInstance,actionId));
CREATE TABLE IF NOT EXISTS notifications(runId TEXT PRIMARY KEY,createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS action_bindings(id INTEGER PRIMARY KEY,handle TEXT NOT NULL,agentId TEXT NOT NULL,sessionKey TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS introductions(id INTEGER PRIMARY KEY AUTOINCREMENT,agentId TEXT NOT NULL,sessionKey TEXT,url TEXT NOT NULL,reason TEXT,status TEXT NOT NULL,createdAt INTEGER NOT NULL,requestedBy TEXT);
CREATE TABLE IF NOT EXISTS observers(sessionKey TEXT NOT NULL,observerId TEXT NOT NULL,tainted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(sessionKey,observerId));
CREATE TABLE IF NOT EXISTS approval_decisions(toolCallId TEXT PRIMARY KEY,tool TEXT NOT NULL,paramsJson TEXT NOT NULL,decision TEXT NOT NULL,operatorId TEXT,decidedAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_index(ts TEXT NOT NULL,kind TEXT NOT NULL,agentId TEXT,handle TEXT,file TEXT NOT NULL,line INTEGER NOT NULL);
INSERT OR REPLACE INTO meta(k,v) VALUES('schema','1');`;

/** One connection to the OS-owned SQLite database. */
export class Store {
  private readonly db: Database;
  constructor(path:string){ mkdirSync(dirname(path),{recursive:true,mode:0o700}); this.db=new DatabaseSync(path); this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;"); }
  /** Refuse forward-schema rollback; an existing current schema is never rewritten at startup. */
  migrate():void{const exists=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get();if(exists){const schema=this.db.prepare("SELECT v FROM meta WHERE k='schema'").get();if(schema?.v!=="1")throw new Error("Kernel schema incompatible.");return;}this.db.exec(SCHEMA); }
  close():void{ this.db.close(); }
  getGrant(handle:string):Grant|null{ return grantRow(this.db.prepare("SELECT * FROM grants WHERE handle=?").get(handle)); }
  isActiveHandle(handle:unknown,now=Date.now()):boolean{ if(typeof handle!=="string")return false; const g=this.getGrant(handle); return g?.status==="active"&&(g.expiresAt===undefined||g.expiresAt>now); }
  authorizeGrant(expected:Grant,agentId:string,sessionKey:string,cellId:string,now=Date.now()):Grant|null{const current=this.getGrant(expected.handle);if(!current||current.status!=="active"||current.audience!=="owner-only"||(current.expiresAt!==undefined&&current.expiresAt<=now)||current.agentId!==agentId||current.cellId!==cellId||(current.scope!=="agent"&&current.scope!==`session:${sessionKey}`)||current.vendor!==expected.vendor||current.resourceType!==expected.resourceType||current.resourceKey!==expected.resourceKey||current.operatorId!==expected.operatorId)return null;return current;}
  listGrants(agentId:string,activeOnly=true):Grant[]{ return this.db.prepare(`SELECT * FROM grants WHERE agentId=?${activeOnly?" AND status='active'":""} ORDER BY createdAt,handle`).all(agentId).map(r=>grantRow(r)!); }
  allGrants(agentId?:string):Grant[]{ const rows=agentId?this.db.prepare("SELECT * FROM grants WHERE agentId=? ORDER BY createdAt").all(agentId):this.db.prepare("SELECT * FROM grants ORDER BY createdAt").all(); return rows.map(r=>grantRow(r)!); }
  insertGrant(g:Grant):Grant{
    this.db.prepare(`INSERT OR IGNORE INTO grants(handle,agentId,cellId,vendor,resourceType,resourceKey,operatorId,scope,audience,status,createdAt,createdBy,expiresAt,title) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(g.handle,g.agentId,g.cellId,g.vendor,g.resourceType,g.resourceKey,g.operatorId,g.scope,g.audience,g.status,g.createdAt,g.createdBy,g.expiresAt??null,g.title??null);
    return grantRow(this.db.prepare("SELECT * FROM grants WHERE agentId=? AND vendor=? AND resourceType=? AND resourceKey=? AND operatorId=? AND scope=?").get(g.agentId,g.vendor,g.resourceType,g.resourceKey,g.operatorId,g.scope))!;
  }
  setGrantStatus(handle:string,status:GrantStatus):boolean{ return Number(this.db.prepare("UPDATE grants SET status=? WHERE handle=?").run(status,handle).changes)===1; }
  upsertInstance(r:InstanceRecord):void{ this.db.prepare(`INSERT INTO instances(id,vendor,resourceKey,operatorId,observerStrategy,lockdown) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET observerStrategy=excluded.observerStrategy,lockdown=MAX(instances.lockdown,excluded.lockdown)`).run(r.id,r.vendor,r.resourceKey,r.operatorId,r.observerStrategy,r.lockdown); }
  getInstance(id:string):InstanceRecord|null{ return (this.db.prepare("SELECT * FROM instances WHERE id=?").get(id) as InstanceRecord|undefined)??null; }
  lockdownInstance(id:string):void{ this.db.prepare("UPDATE instances SET lockdown=1 WHERE id=?").run(id); }
  addIntroduction(v:{agentId:string;sessionKey?:string;url:string;reason?:string;requestedBy?:string}):number{ return Number(this.db.prepare("INSERT INTO introductions(agentId,sessionKey,url,reason,status,createdAt,requestedBy) VALUES(?,?,?,?,?,?,?)").run(v.agentId,v.sessionKey??null,v.url,v.reason??null,"pending",Date.now(),v.requestedBy??null).lastInsertRowid); }
  /** Operator-visible pending resource introductions, bounded by the caller. */
  listIntroductions(){return this.db.prepare("SELECT id,agentId,sessionKey,url,reason FROM introductions WHERE status='pending' ORDER BY id LIMIT 100").all() as Array<{id:number;agentId:string;sessionKey:string|null;url:string;reason:string|null}>;}
  /** Claim before awaiting grant creation, so overlapping operator decisions cannot duplicate it. */
  claimIntroduction(id:number):boolean{return Number(this.db.prepare("UPDATE introductions SET status='resolving' WHERE id=? AND status='pending'").run(id).changes)===1;}
  /** Complete an already-claimed introduction without changing its bound agent or resource. */
  finishIntroduction(id:number,status:"granted"|"rejected"|"failed"):void{this.db.prepare("UPDATE introductions SET status=? WHERE id=? AND status='resolving'").run(status,id);}
  /** Claim a run digest before delivery: uncertain sends are not repeated. */
  claimNotification(runId:string):boolean{return Number(this.db.prepare("INSERT OR IGNORE INTO notifications(runId,createdAt) VALUES(?,?)").run(runId,Date.now()).changes)===1;}
  countPendingRequests():number{ return this.count("introductions"); }
  addAction(instance:string,actionId:number,d:ActionDescription):PendingAction{ this.db.prepare("INSERT OR IGNORE INTO actions(gatekeeperInstance,actionId,descriptionJson,status,submittedAt) VALUES(?,?,?,?,?)").run(instance,actionId,JSON.stringify(d),"pending",Date.now()); return this.db.prepare("SELECT * FROM actions WHERE gatekeeperInstance=? AND actionId=?").get(instance,actionId) as unknown as PendingAction; }
  listActions(pendingOnly=true):PendingAction[]{ return this.db.prepare(`SELECT * FROM actions${pendingOnly?" WHERE status='pending'":""} ORDER BY id`).all() as unknown as PendingAction[]; }
  getAction(id:number):PendingAction|null{ return (this.db.prepare("SELECT * FROM actions WHERE id=?").get(id) as unknown as PendingAction|undefined)??null; }
  decideAction(id:number,status:"applied"|"rejected"|"reverted"|"failed",operatorId:string,error?:string):boolean{ const now=Date.now(); return Number(this.db.prepare("UPDATE actions SET status=?,decidedBy=?,decidedAt=?,appliedAt=CASE WHEN ?='applied' THEN ? ELSE appliedAt END,error=? WHERE id=?").run(status,operatorId,now,status,now,error??null,id).changes)===1; }
  /** Persist the originating capability separately; duplicate submissions cannot rebind it. */
  bindAction(id:number,handle:string,agentId:string,sessionKey:string):void{this.db.prepare("INSERT OR IGNORE INTO action_bindings(id,handle,agentId,sessionKey) VALUES(?,?,?,?)").run(id,handle,agentId,sessionKey);}
  /** Only an original binding may authorize an external approval effect. */
  actionBinding(id:number):{handle:string;agentId:string;sessionKey:string}|null{return this.db.prepare("SELECT handle,agentId,sessionKey FROM action_bindings WHERE id=?").get(id) as {handle:string;agentId:string;sessionKey:string}|undefined??null;}
  /** A crash during an effect leaves a terminal, non-retryable uncertain record. */
  claimAction(id:number,expected:"pending"|"applied",operator:string):boolean{return Number(this.db.prepare("UPDATE actions SET status='failed',decidedBy=?,decidedAt=?,error='Outcome unconfirmed; reconcile before retry' WHERE id=? AND status=?").run(operator,Date.now(),id,expected).changes)===1;}
  countPending():number{ return this.count("actions"); }
  setObservers(sessionKey:string,observers:readonly string[]):void{this.db.exec("BEGIN IMMEDIATE");try{this.db.prepare("DELETE FROM observers WHERE sessionKey=? AND tainted=0").run(sessionKey);const q=this.db.prepare("INSERT OR IGNORE INTO observers(sessionKey,observerId,tainted) VALUES(?,?,0)");for(const id of observers)q.run(sessionKey,id);this.db.exec("COMMIT");}catch(error){this.db.exec("ROLLBACK");throw error;} }
  observers(sessionKey:string):string[]{ return (this.db.prepare("SELECT observerId FROM observers WHERE sessionKey=? ORDER BY observerId").all(sessionKey) as Array<{observerId:string}>).map(r=>r.observerId); }
  taintObserver(sessionKey:string,observerId:string):void{ this.db.prepare("INSERT INTO observers(sessionKey,observerId,tainted) VALUES(?,?,1) ON CONFLICT(sessionKey,observerId) DO UPDATE SET tainted=1").run(sessionKey,observerId); }
  recordToolDecision(toolCallId:string,tool:string,params:Record<string,unknown>,decision:string,operatorId?:string):void{ this.db.prepare("INSERT OR REPLACE INTO approval_decisions(toolCallId,tool,paramsJson,decision,operatorId,decidedAt) VALUES(?,?,?,?,?,?)").run(toolCallId,tool,JSON.stringify(params),decision,operatorId??null,Date.now()); }
  consumeToolApproval(toolCallId:string,tool:string,params:Record<string,unknown>):boolean{this.db.exec("BEGIN IMMEDIATE");try{const r=this.db.prepare("SELECT tool,paramsJson,decision FROM approval_decisions WHERE toolCallId=?").get(toolCallId) as {tool:string;paramsJson:string;decision:string}|undefined;this.db.prepare("DELETE FROM approval_decisions WHERE toolCallId=?").run(toolCallId);const ok=!!r&&r.tool===tool&&r.paramsJson===JSON.stringify(params)&&r.decision.startsWith("allow");this.db.exec("COMMIT");return ok;}catch(error){this.db.exec("ROLLBACK");throw error;} }
  private count(table:"actions"|"introductions"):number{return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE status='pending'`).get() as {n:number}).n);}
}
function grantRow(row:unknown):Grant|null{ if(!row)return null;const r=row as Grant&{expiresAt:number|null;title:string|null};const {expiresAt,title,...base}=r;return {...base,...(expiresAt===null?{}:{expiresAt}),...(title===null?{}:{title})}; }
