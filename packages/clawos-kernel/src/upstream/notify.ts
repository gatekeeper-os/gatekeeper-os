/** Fixed operator-only digest through the installed upstream message CLI (plan §4.4). */
import { execFile } from "node:child_process";
/** Never send action bodies, URLs, prompts or credentials; routing comes only from operator configuration. */
export function sendOperatorDigest(target:{channel:string;target:string},actions:number,requests:number):Promise<void>{
  if(!target.channel||!target.target||target.channel.length>64||target.target.length>512||/[\u0000-\u001f\u007f]/u.test(target.channel+target.target)||![actions,requests].every(n=>Number.isSafeInteger(n)&&n>=0))return Promise.reject(new Error("Invalid notification configuration."));
  const message=`OpenClaw OS: ${actions} pending action(s), ${requests} access request(s). Use /approvals in your private operator conversation or clawos approvals list.`;
  return new Promise((resolve,reject)=>{execFile("openclaw",["message","send","--channel",target.channel,"--target",target.target,"--message",message,"--json"],{env:process.env,timeout:30_000,maxBuffer:65_536},error=>{if(error)reject(new Error("Operator digest delivery unconfirmed."));else resolve();});});
}
