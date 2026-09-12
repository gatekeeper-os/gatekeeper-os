/** Strict chat grammar; text selects an operation, never supplies authority. */
export function isOperatorCommand(body:string):boolean {
  return /^\/(approvals|approve|reject|grants|grant)(?:\s|$)/u.test(body);
}
/** Parse exact aliases and bounded positive decimal IDs. */
export function operatorCommand(body:string):{surface:"approvals"|"grants";verb:string;ids?:number[]|"all";handle?:string;url?:string}|undefined {
  if(!isOperatorCommand(body))return;
  if(body.length>2048)throw new Error("Command too long.");
  let [surface,verb="list",argument,...extra]=body.trim().slice(1).split(/\s+/u);
  if(surface==="approve"||surface==="reject") {argument=verb;verb=surface==="approve"?"apply":"reject";surface="approvals";if(body.trim().split(/\s+/u).length!==2)throw new Error("Invalid command.");}
  if(surface==="grant") {
    if(body.trim().split(/\s+/u).length!==2)throw new Error("Invalid command.");
    const url=new URL(verb);
    if(!["https:","http:","file:"].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error("Invalid resource URL.");
    return{surface:"grants",verb:"introduce",url:verb};
  }
  if(extra.length)throw new Error("Invalid command.");
  if(verb==="list"&&!argument)return{surface:surface as "approvals"|"grants",verb};
  if(surface==="grants"&&verb==="revoke"&&/^grant:[a-z0-9]{8}$/.test(argument??""))return{surface,verb,handle:argument!};
  if(surface==="approvals"&&["preview","apply","reject","revert","grant","reject-request"].includes(verb)&&argument){
    if(argument!=="all"&&!/^[1-9][0-9]*(?:,[1-9][0-9]*)*$/.test(argument))throw new Error("Invalid action IDs.");
    const ids=argument==="all"?"all":argument.split(",").map(Number);
    if(ids!=="all"&&(ids.length>100||ids.some(id=>!Number.isSafeInteger(id))||new Set(ids).size!==ids.length))throw new Error("Invalid action IDs.");
    return{surface,verb,ids};
  }
  throw new Error("Use /approvals list|preview|apply|reject|revert [IDs or all], /approve IDs, /reject IDs, /grants, or /grant URL.");
}
