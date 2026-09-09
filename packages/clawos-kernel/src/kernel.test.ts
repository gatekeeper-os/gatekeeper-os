import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HookCtx, HookEvent, OpenClawPluginApi } from "./upstream/sdk.js";
import { Kernel } from "./kernel.js";

// Driver and SDK transport are test doubles; kernel store, grants and hook handlers are real.
// This does not claim live channel dispatch or upstream hook ordering acceptance.
const fixture=vi.hoisted(()=>({call:vi.fn(),close:vi.fn(),introduce:vi.fn(),authority:vi.fn()}));
vi.mock("./upstream/sdk.js",()=>({createPluginRuntimeStore:()=>{let runtime:unknown;return{
  tryGetRuntime:()=>runtime,getRuntime:()=>{if(!runtime)throw new Error("Kernel unavailable");return runtime;},
  setRuntime:(value:unknown)=>{runtime=value;},clearRuntime:()=>{runtime=undefined;},
};}}));
vi.mock("./upstream/channel-authority.js",()=>({resolveChannelTurnAuthority:fixture.authority}));
vi.mock("./registry.js",()=>({instanceId:()=>"fixture-instance",Registry:class{
  tools=[{name:"gk_test_read",description:"Read a fixture",parameters:{type:"object"}}];
  entries=new Map([["test",{tools:[{name:"gk_test_read",resourceType:"item"}],resources:[{type:"item",observerStrategy:"private-only"}]}]]);
  resources(){return[{entry:{vendor:"test"},resource:{urlPattern:"https://fixture.invalid/:id"}}];}
  introduce(...args:unknown[]){fixture.introduce(...args);return Promise.resolve({resource:{type:"item",title:"Fixture"},resourceKey:"fixture"});}
  openSession(){return Promise.resolve({session:{call:fixture.call,close:fixture.close},instanceId:"fixture-instance"});}
  toolNames(){return["gk_test_read"];}
}}));

let kernel:Kernel;
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
  fixture.close.mockResolvedValue(undefined);
  fixture.call.mockImplementation(async(_tool,_params,call)=>call.dryRun?{kind:"observation",description:{title:"Read",description:""}}:{content:[{type:"text",text:"fixture"}]});
  const api:Partial<OpenClawPluginApi>={pluginConfig:{operators:[{channel:"fixture",senderId:"owner"}],egress:{denyPatterns:["blocked-marker"]}}};
  kernel=new Kernel(api as OpenClawPluginApi);
  await kernel.start();
});
afterEach(async()=>{await kernel.stop();vi.unstubAllEnvs();});

describe("kernel channel-policy regression boundaries",()=>{
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
