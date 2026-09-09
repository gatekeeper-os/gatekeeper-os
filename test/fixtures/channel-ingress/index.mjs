// VM-only fixed synthetic channel ingress. Never represents real Slack transport.
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { dispatchInboundMessageWithDispatcher } from 'openclaw/plugin-sdk/reply-runtime';
let ownerResolutions=0;
let lastDispatchShape;
export default definePluginEntry({id:'clawos-channel-ingress',name:'VM channel ingress',register(api){
 if(process.env.CLAWOS_KERNEL_VM!=='1'||process.env.OPENCLAW_STATE_DIR!=='/home/tester/.openclaw-kernel-test')throw new Error('VM required');
 api.on('reply_dispatch',(event,context)=>{lastDispatchShape={provider:event.ctx.Provider,surface:event.ctx.Surface,dispatchKind:context.dispatchKind,isTailDispatch:event.isTailDispatch,aborted:context.abortSignal?.aborted===true,agent:event.ctx.AgentId,sessionKey:event.sessionKey,hasSender:typeof event.ctx.SenderId==='string',hasDevice:typeof event.ctx.ApprovalReviewerDeviceId==='string',scopes:event.ctx.GatewayClientScopes??null,hasInternalSource:event.ctx.InternalTurnSource!==undefined,hasProvenance:event.ctx.InputProvenance!==undefined,hasCommandText:typeof event.ctx.commandText==='string',sessionMatches:event.ctx.SessionKey===event.sessionKey,hasAgent:typeof event.ctx.AgentId==='string'};},{eligibleDispatchKinds:['agent']});
 api.registerGatewayMethod('vm.channel.last-dispatch-shape',async({respond})=>respond(true,lastDispatchShape??null),{scope:'operator.admin'});
 api.registerChannel({plugin:{id:'vmchan',meta:{id:'vmchan',label:'VM channel',selectionLabel:'VM channel',docsPath:'/vm',blurb:'VM fixture'},capabilities:{chatTypes:['direct','group']},gateway:{startAccount:async(ctx)=>{ctx.setStatus({...ctx.getStatus(),running:true,connected:true});await new Promise(resolve=>ctx.abortSignal.aborted?resolve():ctx.abortSignal.addEventListener('abort',resolve,{once:true}));}},config:{listAccountIds:()=>['default'],resolveAccount:()=>({accountId:'default',enabled:true}),resolveAllowFrom:()=>{ownerResolutions++;return ['operator'];}}}});
 api.registerGatewayMethod('vm.channel.dispatch',async({params,respond})=>{
  const cases={owner:{sender:'operator',agent:'main'},nonowner:{sender:'outsider',agent:'stranger'},forged:{sender:'operator',agent:'forged',scopes:true},observer:{sender:'outsider',agent:'main',group:true},'group-owner':{sender:'operator',agent:'group-new',group:true},'group-existing':{sender:'operator',agent:'main',group:true,sharedKey:true},'group-return':{sender:'operator',agent:'main',sharedKey:true}};
  const scenario=cases[params.scenario];if(!scenario){respond(false,undefined,{code:'INVALID_REQUEST',message:'Unknown scenario'});return;}
  const before=ownerResolutions;let delivered=0;
  const text='Inspect file:///home/tester/kernel-resource/';
  const key='agent:'+scenario.agent+':vmchan:group:'+(scenario.sharedKey?'shared':'fixture');
  try{await dispatchInboundMessageWithDispatcher({cfg:api.config,ctx:{Body:text,BodyForAgent:text,BodyForCommands:text,From:'vmchan:'+scenario.sender,To:'vmchan:fixture',Provider:'vmchan',Surface:'vmchan',SenderId:scenario.sender,AgentId:scenario.agent,SessionKey:key,AccountId:'default',ChatType:scenario.group?'group':'direct',WasMentioned:true,CommandAuthorized:true,MessageSid:'vm-'+params.scenario,...(scenario.scopes?{GatewayClientScopes:['operator.admin']}: {})},dispatcherOptions:{deliver:async()=>{delivered++;}}});respond(true,{dispatched:true,ownerResolverCalled:ownerResolutions>before,delivered});}catch{respond(false,undefined,{code:'UNAVAILABLE',message:'Fixture dispatch failed'});}
 },{scope:'operator.admin'});
}});
