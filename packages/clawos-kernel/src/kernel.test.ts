import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HookCtx, HookEvent, OpenClawPluginApi } from "./upstream/sdk.js";
import { Kernel } from "./kernel.js";

// Driver and SDK transport are test doubles; kernel store, grants and hook handlers are real.
// This does not claim live channel dispatch or upstream hook ordering acceptance.
const fixture=vi.hoisted(()=>({call:vi.fn(),close:vi.fn(),introduce:vi.fn(),authority:vi.fn(),apply:vi.fn(),reject:vi.fn(),notify:vi.fn()}));
vi.mock("./upstream/sdk.js",()=>({createPluginRuntimeStore:()=>{let runtime:unknown;return{
  tryGetRuntime:()=>runtime,getRuntime:()=>{if(!runtime)throw new Error("Kernel unavailable");return runtime;},
  setRuntime:(value:unknown)=>{runtime=value;},clearRuntime:()=>{runtime=undefined;},
};}}));
vi.mock("./upstream/notify.js",()=>({sendOperatorDigest:fixture.notify}));
vi.mock("./upstream/channel-authority.js",()=>({resolveChannelTurnAuthority:fixture.authority}));
vi.mock("./registry.js",()=>({instanceId:()=>"fixture-instance",Registry:class{
  tools=[{name:"gk_test_read",description:"Read a fixture",parameters:{type:"object"}}];
  entries=new Map([["test",{tools:[{name:"gk_test_read",resourceType:"item"}],resources:[{type:"item",observerStrategy:"private-only"}]}]]);
  resources(){return[{entry:{vendor:"test"},resource:{urlPattern:"https://fixture.invalid/:id"}}];}
  introduce(...args:unknown[]){fixture.introduce(...args);return Promise.resolve({resource:{type:"item",title:"Fixture"},resourceKey:"fixture"});}
  openSession(){return Promise.resolve({session:{call:fixture.call,close:fixture.close},instanceId:"fixture-instance",gatekeeper:{applyAction:fixture.apply,rejectAction:fixture.reject}});}
  toolNames(){return["gk_test_read"];}
  health(){return [{vendor:"test",healthy:true}];}
}}));

let kernel:Kernel;let api:Partial<OpenClawPluginApi>;
const ctx={agentId:"agent-a",sessionKey:"agent:agent-a:private",runId:"run-a",channel:"fixture"};
async function dispatch(senderId="owner",senderIsOwner=true){
  fixture.authority.mockReturnValue({...ctx,senderId,senderIsOwner,privateAudience:true,text:"Read https://fixture.invalid/item"});
  await kernel.onReplyDispatch({} as HookEvent<"reply_dispatch">,{} as HookCtx<"reply_dispatch">);
}
async function grant(){
  await dispatch();
  const prompt=await kernel.onBeforePromptBuild({prompt:"Read",messages:[]},ctx);
  const handle=prompt.appendContext?.match(/grant:[a-z0-9]+/)?.[0];
  expect(handle).toBeTruthy();
  return{handle:handle!,prompt};
}
beforeEach(async()=>{
  vi.stubEnv("OPENCLAW_STATE_DIR",mkdtempSync(join(tmpdir(),"clawos-kernel-hooks-")));
  vi.stubEnv("CLAWOS_CELL","hook-tests");
  fixture.call.mockReset();fixture.close.mockReset();fixture.introduce.mockReset();fixture.authority.mockReset();
  fixture.close.mockResolvedValue(undefined);fixture.apply.mockReset().mockResolvedValue(undefined);fixture.reject.mockReset().mockResolvedValue(undefined);fixture.notify.mockReset().mockResolvedValue(undefined);
  fixture.call.mockImplementation(async(_tool,_params,call)=>call.dryRun?{kind:"observation",description:{title:"Read",description:""}}:{content:[{type:"text",text:"fixture"}]});
  api={pluginConfig:{operators:[{channel:"fixture",senderId:"owner"}],egress:{denyPatterns:["blocked-marker"]}}};
  kernel=new Kernel(api as OpenClawPluginApi);
  await kernel.start();
});
afterEach(async()=>{await kernel.stop();vi.unstubAllEnvs();});

describe("kernel channel-policy regression boundaries",()=>{
  it("preserves only native groups under upstream policy without exposing ungranted plugin tools",async()=>{
    const result=await kernel.onBeforePromptBuild({prompt:"Read",messages:[]},ctx);
    expect(result.toolsAllow).toEqual(["group:openclaw","group:fs","group:runtime","os_request_access","os_list_grants"]);
    expect(result.toolsAllow).not.toContain("group:plugins");
    expect(result.toolsAllow).not.toContain("gk_test_read");
  });

  it("consumes a queued session introduction notice even when prompt context has a run ID",async()=>{
    const{prompt}=await grant();
    expect(prompt.appendContext).toContain("You now have access to test item");
    expect(prompt.toolsAllow).toContain("gk_test_read");
    const next=await kernel.onBeforePromptBuild({prompt:"Next",messages:[]},{...ctx,runId:"run-b"});
    expect(next.appendContext).not.toContain("You now have access");
    expect(next.appendContext).toContain("Available grants:");
  });
  it.each([
    {senderId:"owner",senderIsOwner:false},
    {senderId:"owner"},
    {senderId:"stranger",senderIsOwner:true},
    {senderIsOwner:true},
  ])("does not introduce a URL without both trusted owner and configured sender: %j",async sender=>{
    await dispatch(sender.senderId??"",sender.senderIsOwner===true);
    expect(fixture.introduce).not.toHaveBeenCalled();
    expect((await kernel.onBeforePromptBuild({prompt:"Read",messages:[]},ctx)).toolsAllow).not.toContain("gk_test_read");
  });
  it("accepts an authenticated Control UI admin without a sender allowlist duplicate",async()=>{
    fixture.authority.mockReturnValue({...ctx,privateAudience:true,channel:"webchat",senderId:"gateway-device:device-1",senderIsOwner:true,text:"Read https://fixture.invalid/item"});
    await kernel.onReplyDispatch({} as HookEvent<"reply_dispatch">,{} as HookCtx<"reply_dispatch">);
    expect(fixture.introduce).toHaveBeenCalledOnce();
    expect((await kernel.onBeforePromptBuild({prompt:"Read",messages:[]},ctx)).toolsAllow).toContain("gk_test_read");
  });
  it("never introduces from the late model gate, even with a trusted owner bit",async()=>{
    await kernel.onBeforeAgentRun({prompt:"https://fixture.invalid/item",messages:[],senderId:"owner",senderIsOwner:true},ctx);
    expect(fixture.introduce).not.toHaveBeenCalled();
  });
  it("narrows owner-only grants before prompt construction when an observer arrives",async()=>{
    await grant();await dispatch("observer",false);
    expect((await kernel.onBeforePromptBuild({prompt:"Read",messages:[]},ctx)).toolsAllow).not.toContain("gk_test_read");
  });
  it("blocks an owner-only call if a non-owner arrives after preflight",async()=>{
    const{handle}=await grant();
    const tools:Parameters<OpenClawPluginApi["registerTool"]>[0][]=[];
    kernel.registerGatekeeperTools({registerTool:tool=>{tools.push(tool);}} as OpenClawPluginApi);
    const event={toolName:"gk_test_read",toolCallId:"call-a",params:{grant:handle}};
    expect(await kernel.onBeforeToolCall(event,{...ctx,toolName:event.toolName})).toEqual({});
    await kernel.onBeforeAgentRun({prompt:"Hello",messages:[],senderId:"observer",senderIsOwner:false},ctx);
    const tool=tools[0];
    if(!tool||typeof tool==="function"||Array.isArray(tool))throw new Error("Unexpected tool registration");
    await expect(tool.execute("call-a",event.params)).rejects.toThrow("Operation denied.");
    expect(fixture.call).toHaveBeenCalledTimes(1); // dry-run only: no resource read after audience changed
    expect((await kernel.onBeforePromptBuild({prompt:"Read",messages:[]},ctx)).toolsAllow).not.toContain("gk_test_read");
  });
  it("refuses an owner's first group introduction before anyone else speaks",async()=>{
    fixture.authority.mockReturnValue({...ctx,senderId:"owner",senderIsOwner:true,privateAudience:false,text:"Read https://fixture.invalid/item"});
    await kernel.onReplyDispatch({} as HookEvent<"reply_dispatch">,{} as HookCtx<"reply_dispatch">);
    expect(fixture.introduce).not.toHaveBeenCalled();
    expect((await kernel.onBeforePromptBuild({prompt:"Read",messages:[]},ctx)).toolsAllow).not.toContain("gk_test_read");
  });
  it("locks existing authority before a shared prompt and does not clear it on owner return",async()=>{
    const {handle}=await grant();
    const event={toolName:"gk_test_read",toolCallId:"group-race",params:{grant:handle}};
    const tools:Parameters<OpenClawPluginApi["registerTool"]>[0][]=[];
    kernel.registerGatekeeperTools({registerTool:tool=>{tools.push(tool);}} as OpenClawPluginApi);
    expect(await kernel.onBeforeToolCall(event,{...ctx,toolName:event.toolName})).toEqual({});
    fixture.authority.mockReturnValue({...ctx,senderId:"owner",senderIsOwner:true,privateAudience:false,text:"Read https://fixture.invalid/item"});
    await kernel.onReplyDispatch({} as HookEvent<"reply_dispatch">,{} as HookCtx<"reply_dispatch">);
    const narrowed=await kernel.onBeforePromptBuild({prompt:"Read",messages:[]},ctx);
    expect(narrowed.toolsAllow).not.toContain("gk_test_read");
    expect(narrowed.appendContext).toBeUndefined();
    expect(kernel.capabilityPolicy().evaluate(event,{...ctx,toolName:event.toolName})).toMatchObject({block:true});
    await expect(kernel.resolveGrant(ctx.agentId,ctx.sessionKey,handle)).rejects.toThrow("audience");
    const tool=tools[0];if(!tool||typeof tool==="function"||Array.isArray(tool))throw new Error("Unexpected tool");
    await expect(tool.execute(event.toolCallId,event.params)).rejects.toThrow("Operation denied");
    await dispatch();
    expect((await kernel.onBeforePromptBuild({prompt:"Read",messages:[]},ctx)).toolsAllow).not.toContain("gk_test_read");
    expect(fixture.call).toHaveBeenCalledTimes(1);
  });
  it("blocks egress matches and permits safe content",async()=>{
    expect(await kernel.onMessageSending({to:"peer",content:"blocked-marker"},{channelId:"fixture",sessionKey:ctx.sessionKey})).toMatchObject({cancel:true});
    expect(await kernel.onMessageSending({to:"peer",content:"safe response"},{channelId:"fixture",sessionKey:ctx.sessionKey})).toBeUndefined();
  });
});

async function rpc(method:string,params:Record<string,unknown>={},scopes:string[]=["operator.admin"]){let output:unknown;let ok=false;const handler=kernel.gatewayMethods().find(([name])=>name===method)?.[1];if(!handler)throw new Error("Missing RPC");await handler({params,client:{connect:{role:"operator",scopes,device:{id:"paired-operator"}},isDeviceTokenAuth:true},respond:(success:boolean,value:unknown)=>{ok=success;output=value;}} as Parameters<typeof handler>[0]);return{ok,output};}
it("binds action authority at submission and rechecks it on operator apply",async()=>{
  const {handle}=await grant();const resolved=await kernel.resolveGrant(ctx.agentId,ctx.sessionKey,handle);
  await resolved.queue.submitAction(1,{title:"Fixture",description:"",implementsRevert:false});
  expect((await rpc("os.approvals.list")).output).toMatchObject({actions:[{id:1,status:"pending"}],requests:[]});
  await rpc("os.grants.revoke",{handle});
  expect((await rpc("os.approvals.apply",{ids:[1]})).ok).toBe(false);expect(fixture.apply).not.toHaveBeenCalled();
});
it("persists request target and grants only after a paired operator decision",async()=>{
  const p={url:"https://fixture.invalid/item",reason:"Need fixture"};
  await kernel.onBeforeToolCall({toolName:"os_request_access",toolCallId:"request",params:p},{...ctx,toolName:"os_request_access"});
  await kernel.requestAccess("request",p);expect(fixture.introduce).not.toHaveBeenCalled();
  expect((await rpc("os.approvals.list")).output).toMatchObject({actions:[],requests:[{id:1,agentId:ctx.agentId}]});
  expect((await rpc("os.requests.approve",{ids:[1]})).ok).toBe(true);
  expect((await kernel.onBeforePromptBuild({prompt:"Next",messages:[]},ctx)).appendContext).toContain("You now have access");
  expect((await rpc("os.requests.approve",{ids:[1]})).ok).toBe(false);
});
it("denies shared grant minting even for paired operators",async()=>{
  expect((await rpc("os.grants.introduce",{agentId:"agent-a",url:"https://fixture.invalid/item",audience:"shared"})).ok).toBe(false);
  expect(fixture.introduce).not.toHaveBeenCalled();
});
it("batches an operator digest once per run, never sends resource descriptions",async()=>{
  api.pluginConfig={...api.pluginConfig,notify:{channel:"fixture",target:"operator"}};
  const {handle}=await grant();const resolved=await kernel.resolveGrant(ctx.agentId,ctx.sessionKey,handle);
  await resolved.queue.submitAction(1,{title:"Private fixture",description:"private body",implementsRevert:false});
  await resolved.queue.submitAction(2,{title:"Private fixture",description:"private body",implementsRevert:false});
  await kernel.onAgentEnd({messages:[],success:true},ctx);await kernel.onAgentEnd({messages:[],success:true},ctx);
  expect(fixture.notify).toHaveBeenCalledExactlyOnceWith({channel:"fixture",target:"operator"},2,0);
});
it('resumes eligible work immediately after its non-eligible head is rejected',async()=>{
  api.pluginConfig={...api.pluginConfig,autoApprove:['github.issue.comment']};
  const {handle}=await grant();const resolved=await kernel.resolveGrant(ctx.agentId,ctx.sessionKey,handle);
  const d={title:'Fixture',description:'',implementsRevert:false,autoApprovable:true,actionKind:{tag:'github.issue.comment',label:'Comment'}};
  await resolved.queue.submitAction(1,{...d,autoApprovable:false});await resolved.queue.submitAction(2,d);
  await kernel.onAgentEnd({messages:[],success:true},ctx);expect(fixture.apply).not.toHaveBeenCalled();
  expect((await rpc('os.approvals.reject',{ids:[1]})).ok).toBe(true);expect(fixture.apply).toHaveBeenCalledExactlyOnceWith(2);
});
it('only returns decided previews through explicitly requested authenticated list',async()=>{
  const{handle}=await grant();const resolved=await kernel.resolveGrant(ctx.agentId,ctx.sessionKey,handle);
  await resolved.queue.submitAction(1,{title:'Fixture',description:'',implementsRevert:false});
  await rpc('os.approvals.reject',{ids:[1]});expect((await rpc('os.approvals.list')).output).toMatchObject({actions:[]});
  expect((await rpc('os.approvals.list',{includeDecided:true})).output).toMatchObject({actions:[{id:1,status:'rejected'}]});
});
it.each(['/approvals apply 1','/reject 1','/grant https://fixture.invalid/item','/approvals'])('silently claims unauthorized %s at trusted dispatch',async body=>{
  fixture.authority.mockReturnValue({...ctx,senderId:'outsider',senderIsOwner:false,privateAudience:true,text:body});
  const sendFinalReply=vi.fn();const dispatchCtx={cfg:{},dispatcher:{sendFinalReply,sendToolResult:vi.fn(),sendBlockReply:vi.fn(),waitForIdle:async()=>{},getFailedCounts:()=>({tool:0,block:0,final:0}),markComplete:()=>{},getQueuedCounts:()=>({tool:0,block:0,final:0})},recordProcessed:vi.fn(),markIdle:vi.fn()};
  const result=await kernel.onReplyDispatch({} as HookEvent<'reply_dispatch'>,dispatchCtx as HookCtx<'reply_dispatch'>);
  expect(result).toMatchObject({handled:true,queuedFinal:false});expect(sendFinalReply).not.toHaveBeenCalled();expect(fixture.introduce).not.toHaveBeenCalled();
});

it.each(['/approvals apply 1','/reject 1','/grant https://fixture.invalid/item','/approvals'])('silently claims malformed-authority %s without granting authority',async body=>{
  fixture.authority.mockReturnValue(undefined);
  const sendFinalReply=vi.fn();const dispatchCtx={dispatchKind:"agent",cfg:{},dispatcher:{sendFinalReply,sendToolResult:vi.fn(),sendBlockReply:vi.fn(),waitForIdle:async()=>{},getFailedCounts:()=>({tool:0,block:0,final:0}),markComplete:()=>{},getQueuedCounts:()=>({tool:0,block:0,final:0})},recordProcessed:vi.fn(),markIdle:vi.fn()};
  const result=await kernel.onReplyDispatch({ctx:{commandText:body}} as HookEvent<'reply_dispatch'>,dispatchCtx as HookCtx<'reply_dispatch'>);
  expect(result).toMatchObject({handled:true,queuedFinal:false});expect(sendFinalReply).not.toHaveBeenCalled();expect(fixture.introduce).not.toHaveBeenCalled();
});

describe('update maintenance barrier',()=>{
  it('tracks admitted runs and removes only the completed run',async()=>{
    await kernel.onBeforeAgentRun({} as HookEvent<'before_agent_run'>,ctx);
    await kernel.onBeforeAgentRun({} as HookEvent<'before_agent_run'>,{...ctx,runId:'run-b'});
    expect(await kernel.status()).toMatchObject({activeRuns:2,activeRunTrackingComplete:true,kernelSchema:1});
    await kernel.onAgentEnd({} as HookEvent<'agent_end'>,ctx);
    expect(await kernel.status()).toMatchObject({activeRuns:1});
  });
  it('fails draining closed when upstream omits run identity',async()=>{
    const {runId,...missing}=ctx;
    await kernel.onBeforeAgentRun({} as HookEvent<'before_agent_run'>,missing);
    expect(await kernel.status()).toMatchObject({activeRuns:1,activeRunTrackingComplete:false});
  });
  it('does not admit or count a maintenance-blocked run',async()=>{
    api.pluginConfig={maintenance:true};
    expect(await kernel.onBeforeAgentRun({} as HookEvent<'before_agent_run'>,ctx)).toMatchObject({outcome:'block',reason:'maintenance'});
    expect(await kernel.status()).toMatchObject({activeRuns:0,maintenance:true});
  });
});

it('persists operator maintenance and blocks non-admin changes without granting authority',async()=>{
  expect((await rpc('os.maintenance.set',{enabled:true})).ok).toBe(true);
  expect((await rpc('os.grants.introduce',{agentId:'a',url:'https://fixture.invalid/a'})).ok).toBe(false);
  expect((await rpc('os.status')).ok).toBe(true);
  expect((await rpc('os.maintenance.set',{enabled:false})).ok).toBe(true);
});

it('does not let a read-only paired client pause the cell',async()=>{
  expect((await rpc('os.maintenance.set',{enabled:true},['operator.read'])).ok).toBe(false);
  expect((await kernel.status()).maintenance).toBe(false);
});


it('fuzzes post-preflight parameter rewriting without executing a changed call', async () => {
  const { handle } = await grant();
  const tools: Parameters<OpenClawPluginApi['registerTool']>[0][] = [];
  kernel.registerGatekeeperTools({ registerTool: tool => { tools.push(tool); } } as OpenClawPluginApi);
  const tool = tools[0];
  if (!tool || typeof tool === 'function' || Array.isArray(tool)) throw new Error('Unexpected tool');
  let seed = 0x9e3779b9;
  const next = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  for (let index = 0; index < 256; index++) {
    const id = `fuzz-${index}`, value = next();
    const params: Record<string, unknown> = { grant: handle, item: { value, list: [value, null, 'fixture'] } };
    expect(await kernel.onBeforeToolCall({ toolName: 'gk_test_read', toolCallId: id, params }, { ...ctx, toolName: 'gk_test_read' })).toEqual({});
    const changed = structuredClone(params);
    switch (index % 4) {
      case 0: changed.grant = 'grant:00000000'; break;
      case 1: changed.item = { value: next(), list: [] }; break;
      case 2: changed.endpoint = 'https://unreviewed.invalid'; break;
      case 3: delete changed.item; break;
    }
    await expect(tool.execute(id, changed)).rejects.toThrow('Operation denied');
    await expect(tool.execute(id, params)).rejects.toThrow('Operation denied');
  }
  expect(fixture.call.mock.calls.every(call => call[2].dryRun === true)).toBe(true);
});
