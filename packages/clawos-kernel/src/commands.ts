/** Strict chat grammar; command text can select an operation but never supplies authority. */
export function operatorCommand(body:string):{surface:"approvals"|"grants";verb:string;ids?:number[]|"all";handle?:string}|undefined {
  if(!/^\/(approvals|grants)(?:\s|$)/u.test(body))return;
  if(body.length>2048)throw new Error("Command too long.");
  const [surface,verb="list",argument,...extra]=body.trim().slice(1).split(/\s+/u);
  if(extra.length)throw new Error("Invalid command.");
  if(verb==="list"&&!argument)return{surface:surface as "approvals"|"grants",verb};
  if(surface==="grants"&&verb==="revoke"&&/^grant:[a-z0-9]{8}$/.test(argument??""))return{surface,verb,handle:argument!};
  if(surface==="approvals"&&["apply","reject","revert","grant","reject-request"].includes(verb)&&argument){
    const ids=argument==="all"?"all":argument.split(",").map(Number);
    if(ids!=="all"&&(ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length))throw new Error("Invalid action IDs.");
    return{surface,verb,ids};
  }
  throw new Error("Use /approvals list|apply|reject|revert|grant|reject-request [IDs or all], or /grants list|revoke [handle].");
}
