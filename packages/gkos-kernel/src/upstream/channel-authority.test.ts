import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HookCtx, HookEvent } from "./sdk.js";
import { resolveChannelTurnAuthority } from "./channel-authority.js";

// Adapter contract tests, not a claim that a transport delivered authenticated identity.
const sdk=vi.hoisted(()=>({authorize:vi.fn(),agent:vi.fn()}));
vi.mock("openclaw/plugin-sdk/command-auth",()=>({resolveCommandAuthorization:sdk.authorize}));
vi.mock("openclaw/plugin-sdk/agent-scope-runtime",()=>({resolveSessionAgentIdStrict:sdk.agent}));
const event=():HookEvent<"reply_dispatch">=>({
  ctx:{Provider:"slack",ChatType:"direct",SenderId:"U123",SessionKey:"agent:main:slack:direct:U123",AgentId:"main",commandText:"https://example.invalid/user",agentText:"https://example.invalid/history",rawText:"https://example.invalid/user",CommandAuthorized:true},
  sessionKey:"agent:main:slack:direct:U123",inboundAudio:false,shouldRouteToOriginating:false,shouldSendToolSummaries:false,shouldSendFullToolDetails:false,sendPolicy:"allow",
});
const context=():HookCtx<"reply_dispatch">=>({dispatchKind:"agent",cfg:{},dispatcher:{} as HookCtx<"reply_dispatch">["dispatcher"],recordProcessed:()=>{},markIdle:()=>{}});
beforeEach(()=>{sdk.authorize.mockReset().mockReturnValue({providerId:"slack",senderId:"U123",senderIsOwner:true});sdk.agent.mockReset().mockReturnValue("main");});
describe("public channel-authority adapter",()=>{
  it("uses the upstream owner resolver and clean current-message text",()=>{
    const e=event(),c=context();
    expect(resolveChannelTurnAuthority(e,c)).toMatchObject({senderIsOwner:true,text:e.ctx.commandText,agentId:"main"});
    expect(sdk.authorize).toHaveBeenCalledWith({ctx:e.ctx,cfg:c.cfg,commandAuthorized:true});
    expect(sdk.agent).toHaveBeenCalledWith({sessionKey:e.sessionKey,config:c.cfg,agentId:"main"});
  });
  it.each(["group","channel",undefined] as const)("does not treat owner identity as a private audience: %s",ChatType=>{
    const e=event();if(ChatType)e.ctx.ChatType=ChatType;else delete e.ctx.ChatType;
    expect(resolveChannelTurnAuthority(e,context())).toMatchObject({senderIsOwner:true,privateAudience:false});
  });
  it.each([
    {GatewayClientScopes:[]},{GatewayClientScopes:["operator.admin"]},
    {Provider:undefined},{SenderId:undefined},{SessionKey:"other"},{commandText:undefined},
    {InternalTurnSource:"cron" as const},{InputProvenance:{kind:"inter_session" as const}},
  ])("rejects unproven/mismatched ingress before owner resolution: %j",patch=>{
    const e=event();Object.assign(e.ctx,patch);
    expect(resolveChannelTurnAuthority(e,context())).toBeUndefined();expect(sdk.authorize).not.toHaveBeenCalled();
  });
  it("admits an authenticated Control UI admin device without trusting a sender label",()=>{
    const e=event();
    Object.assign(e.ctx,{Provider:"webchat",Surface:"webchat",SenderId:undefined,GatewayClientScopes:["operator.admin"],ApprovalReviewerDeviceId:"device-1"});
    e.sessionKey="agent:main:main";e.ctx.SessionKey=e.sessionKey;
    expect(resolveChannelTurnAuthority(e,context())).toMatchObject({channel:"webchat",senderId:"gateway-device:device-1",senderIsOwner:true,agentId:"main"});
    expect(sdk.authorize).not.toHaveBeenCalled();
  });
  it.each([
    {GatewayClientScopes:[]},{GatewayClientScopes:["operator.read"]},{ApprovalReviewerDeviceId:undefined},{SenderId:"gateway-owner"},
  ])("rejects an unproven Control UI turn: %j",patch=>{
    const e=event();Object.assign(e.ctx,{Provider:"webchat",Surface:"webchat",SenderId:undefined,GatewayClientScopes:["operator.admin"],ApprovalReviewerDeviceId:"device-1"},patch);
    e.sessionKey="agent:main:main";e.ctx.SessionKey=e.sessionKey;
    expect(resolveChannelTurnAuthority(e,context())).toBeUndefined();
  });
  it.each(["acp",undefined] as const)("rejects unsupported dispatch %s",dispatchKind=>{
    const c=context();if(dispatchKind)c.dispatchKind=dispatchKind;else delete c.dispatchKind;
    expect(resolveChannelTurnAuthority(event(),c)).toBeUndefined();
  });
  it("does not interpret a matching sender as owner",()=>{
    sdk.authorize.mockReturnValue({providerId:"slack",senderId:"U123",senderIsOwner:false});
    expect(resolveChannelTurnAuthority(event(),context())?.senderIsOwner).toBe(false);
  });
  it("rejects an unscoped session without a routed agent instead of resolving a default",()=>{
    const e=event();e.sessionKey="unscoped";e.ctx.SessionKey="unscoped";delete e.ctx.AgentId;
    expect(resolveChannelTurnAuthority(e,context())).toBeUndefined();
    expect(sdk.authorize).not.toHaveBeenCalled();expect(sdk.agent).not.toHaveBeenCalled();
  });
  it("resolves a canonical agent key without an explicit agent label",()=>{
    const e=event();delete e.ctx.AgentId;
    expect(resolveChannelTurnAuthority(e,context())?.agentId).toBe("main");
  });
  it.each([{providerId:"discord",senderId:"U123"},{providerId:"slack",senderId:"other"}])("rejects resolver identity drift %j",authority=>{
    sdk.authorize.mockReturnValue({...authority,senderIsOwner:true});
    expect(resolveChannelTurnAuthority(event(),context())).toBeUndefined();
  });
  it("fails closed on owner resolver failure or conflicting agent scope",()=>{
    sdk.authorize.mockImplementation(()=>{throw new Error("private diagnostic");});
    expect(resolveChannelTurnAuthority(event(),context())).toBeUndefined();
    sdk.authorize.mockReturnValue({providerId:"slack",senderId:"U123",senderIsOwner:true});sdk.agent.mockReturnValue("other");
    expect(resolveChannelTurnAuthority(event(),context())).toBeUndefined();
  });
});
