/** Public SDK lifecycle operations kept behind the kernel adapter boundary. */
import type { OpenClawPluginApi } from "./sdk.js";
import type { HookCtx, HookEvent, HookResult } from "./sdk.js";
/** Persist a one-shot recovery note instead of resetting or reading upstream session storage. */
export function enqueueRejectionNote(api:OpenClawPluginApi,binding:{agentId:string;sessionKey:string},id:number){return api.session.workflow.enqueueNextTurnInjection({...binding,text:`Action ${id} was rejected. Discard its simulated effects and re-read the resource before continuing.`,idempotencyKey:`clawos-reject-${id}`,placement:"prepend_context"});}
/** Deliver a claimed operator command through the host-owned dispatcher, respecting suppression/send policy. */
export function finishOperatorCommand(event:HookEvent<"reply_dispatch">,ctx:HookCtx<"reply_dispatch">,text:string):NonNullable<Awaited<HookResult<"reply_dispatch">>>{
  const queuedFinal=event.sendPolicy!=="deny"&&!event.suppressUserDelivery?ctx.dispatcher.sendFinalReply({text:text.slice(0,8192)}):false;
  ctx.recordProcessed("completed",{reason:"clawos operator command"});ctx.markIdle("clawos operator command");
  return{handled:true,queuedFinal,counts:ctx.dispatcher.getQueuedCounts()};
}
