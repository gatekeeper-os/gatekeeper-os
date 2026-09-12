import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenStore } from "@clawkeepers/gatekeeper-kit";
import { bindingKey, boundaryResource, canonical, checkInventory, configuredServers, reviewedInventory } from "./manifest.js";
import { McpVendor } from "./vendor.js";
import { proposedResourceUrl } from "./resources.js";
const dirs: string[] = [];
const binding = {id: "demo" as const, endpoint: "https://example.com/mcp", operatorId: "operator", credentialEnv: "CLAWOS_MCP_FIXTURE"};
const logger = {debug:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()};
function setup(inspect = vi.fn(async (_endpoint:string,_bearer:string) => ({ tools: structuredClone(reviewedInventory) }))) {
  const root = mkdtempSync(join(tmpdir(), "clawos-mcp-boundary-")); dirs.push(root);
  mkdirSync(join(root,"os")); writeFileSync(join(root,"os","cell.key"), Buffer.alloc(32,7).toString("base64")+"\n", {mode:0o600});
  process.env.CLAWOS_MCP_FIXTURE = "synthetic-fixture-credential-not-real";
  const config = { servers:[{...binding}] };
  return { root, config, inspect, vendor:new McpVendor({pluginConfig:config,stateDir:root,logger},inspect) };
}
afterEach(()=>{ for(const path of dirs.splice(0)) rmSync(path,{recursive:true,force:true}); delete process.env.CLAWOS_MCP_FIXTURE; vi.clearAllMocks(); });
it("denies unknown config, operator, server and noncanonical URLs before network",async()=>{
  for(const config of [{servers:[{...binding,credential:"no"}]},{servers:[{...binding,id:"other"}]},{servers:[binding,binding]},{servers:[{...binding,endpoint:"https://example.com/mcp?token=x"}]},{servers:[{...binding,endpoint:"https://user@example.com/mcp"}]},{servers:[{...binding,credentialEnv:"PATH"}]},{servers:[],fixtureLoopback:true}]) expect(()=>configuredServers(config)).toThrow();
  const {vendor,inspect}=setup(); await expect(vendor.createAccount("other")).rejects.toThrow(); expect(inspect).not.toHaveBeenCalled();
  const account=await vendor.createAccount("operator");inspect.mockClear();
  for(const url of [proposedResourceUrl("other"),proposedResourceUrl("demo")+"/",proposedResourceUrl("demo")+"?url=https://evil.invalid"])
    await expect(account.getGatekeeperFor(url)).rejects.toThrow();
  expect(inspect).not.toHaveBeenCalled();
});
it("checks inventory identity/schema drift rather than trusting annotations",()=>{
  checkInventory(structuredClone(reviewedInventory));
  for(const tools of [[],[...reviewedInventory,reviewedInventory[0]!],reviewedInventory.map(t=>({...t,inputSchema:{type:"object"}})),reviewedInventory.map(t=>({...t,outputSchema:{type:"object"}}))]) expect(()=>checkInventory(tools)).toThrow();
  expect(canonical({b:2,a:1})).toBe(canonical({a:1,b:2}));
  const recursive:Record<string,unknown>={};recursive.self=recursive;expect(()=>canonical(recursive)).toThrow();
});
it("requires explicit credentials; stores encrypted exact binding; restores without environment",async()=>{
  const {root,vendor,inspect,config}=setup(); delete process.env.CLAWOS_MCP_FIXTURE;
  await expect(vendor.createAccount("operator")).rejects.toThrow(); expect(inspect).not.toHaveBeenCalled();
  process.env.CLAWOS_MCP_FIXTURE="synthetic-fixture-credential-not-real";
  const account=await vendor.createAccount("operator");
  expect(await account.describe()).toEqual({displayName:"Configured MCP credential account"});
  const files=readdirSync(join(root,"os","gatekeepers","mcp","accounts"));
  expect(files.length).toBe(1);
  expect(readFileSync(join(root,"os","gatekeepers","mcp","accounts",files[0]!),"utf8")).not.toContain(process.env.CLAWOS_MCP_FIXTURE);
  delete process.env.CLAWOS_MCP_FIXTURE;
  const restarted=new McpVendor({pluginConfig:config,stateDir:root,logger},inspect);
  expect(await restarted.getAccount("operator")).toBeNull();
  expect(await restarted.createAccount("operator")).toBeTruthy();
});
it("prevents binding rotation from reusing persisted credentials",async()=>{
  const {root,vendor,inspect}=setup();await vendor.createAccount("operator");delete process.env.CLAWOS_MCP_FIXTURE;
  const changed=new McpVendor({pluginConfig:{servers:[{...binding,endpoint:"https://example.org/mcp"}]},stateDir:root,logger},inspect);
  await expect(changed.createAccount("operator")).rejects.toThrow();
});
it("checks exact server on every introduction; observations open and native effects deny",async()=>{
  const {vendor,inspect}=setup();const account=await vendor.createAccount("operator");
  const first=await account.getGatekeeperFor(proposedResourceUrl("demo"));
  expect(first.resourceKey).toBe(proposedResourceUrl("demo"));expect(first.resource).toEqual(boundaryResource("demo"));
  expect(await first.gatekeeper.describe()).toHaveProperty("suggestedName","MCP");
  expect((await vendor.getTools()).map(tool=>tool.name)).toEqual(["gk_mcp_demo_read_note"]);expect(await first.gatekeeper.getAutoApprovableActions()).toEqual([]);
  const session = await first.gatekeeper.startSession({authorizeObservation:async()=>{},submitAction:async()=>{}}); await session.close();
  await expect(first.gatekeeper.applyAction(1)).rejects.toThrow();await expect(first.gatekeeper.rejectAction(1)).rejects.toThrow();
  await expect(first.gatekeeper.revertAction!(1)).rejects.toThrow();await expect(account.getVerifier()).rejects.toThrow();
  inspect.mockResolvedValueOnce({tools:[]});await expect(account.getGatekeeperFor(proposedResourceUrl("demo"))).rejects.toThrow();
});
it("revokes retained resources and prevents environment reprovisioning across restart",async()=>{
  const {root,config,vendor,inspect}=setup();const account=await vendor.createAccount("operator");const {gatekeeper}=await account.getGatekeeperFor(proposedResourceUrl("demo"));
  await account.revoke();await expect(gatekeeper.describe()).rejects.toThrow();await expect(account.getSupportedResources()).rejects.toThrow();
  expect(await vendor.getAccount("operator")).toBeNull();await expect(vendor.createAccount("operator")).rejects.toThrow();
  await expect(new McpVendor({pluginConfig:config,stateDir:root,logger},inspect).createAccount("operator")).rejects.toThrow();
});
it("rejects an in-flight introduction after account revocation",async()=>{
  const {vendor,inspect}=setup();const account=await vendor.createAccount("operator");
  let resolve!: (value:{tools:typeof reviewedInventory})=>void;
  inspect.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  const pending=account.getGatekeeperFor(proposedResourceUrl("demo"));await account.revoke();resolve({tools:structuredClone(reviewedInventory)});
  await expect(pending).rejects.toThrow();
});
it("rejects retained resources after credential replacement",async()=>{
  const {root,vendor}=setup();const account=await vendor.createAccount("operator");const {gatekeeper}=await account.getGatekeeperFor(proposedResourceUrl("demo"));
  const store=new TokenStore(join(root,"os","gatekeepers","mcp","accounts"),Buffer.alloc(32,7));store.put(bindingKey(binding),{version:1,binding:bindingKey(binding),bearer:"replacement-fixture"});
  await expect(gatekeeper.describe()).rejects.toThrow();
});
it("coalesces provisioning and copies config; no provider error enters logs",async()=>{
  const {vendor,inspect,config}=setup();config.servers[0]!.operatorId="attacker";
  const [a,b]=await Promise.all([vendor.createAccount("operator"),vendor.createAccount("operator")]);expect(a).toBe(b);expect(inspect).toHaveBeenCalledTimes(1);
  inspect.mockRejectedValueOnce(new Error("raw-server-body-and-credential"));
  await expect(a.getGatekeeperFor(proposedResourceUrl("demo"))).rejects.toThrow("MCP boundary unavailable.");
  for(const fn of Object.values(logger))expect(fn).not.toHaveBeenCalled();
});
it("rejects malformed or permissive cell keys before credential import",async()=>{
  const {root,vendor,inspect}=setup();writeFileSync(join(root,"os","cell.key"),Buffer.alloc(31));await expect(vendor.createAccount("operator")).rejects.toThrow();expect(inspect).not.toHaveBeenCalled();
});
