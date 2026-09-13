/** Schema-validated append-only audit log. */
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Value } from "typebox/value";
import { AuditRecordSchema, type AuditRecord } from "@gatekeeper-os/shared";
export class AuditLog {
  constructor(private readonly dir:string){mkdirSync(dir,{recursive:true,mode:0o700});}
  write(record:AuditRecord):void{if(!Value.Check(AuditRecordSchema,record))throw new Error("Invalid audit record.");const day=record.ts.slice(0,10);appendFileSync(join(this.dir,`${day}.jsonl`),`${JSON.stringify(record)}\n`,{mode:0o600});}
  query(limit=100):AuditRecord[]{const files=readdirSync(this.dir).filter(f=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().reverse();const out:AuditRecord[]=[];for(const file of files){for(const line of readFileSync(join(this.dir,file),"utf8").trim().split("\n").reverse()){if(!line)continue;const value=JSON.parse(line) as AuditRecord;if(Value.Check(AuditRecordSchema,value))out.push(value);if(out.length>=Math.min(1000,Math.max(1,limit)))return out;}}return out;}
  async flush():Promise<void>{}
}
