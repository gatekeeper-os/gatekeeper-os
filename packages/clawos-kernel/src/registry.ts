/** Catalog-backed gatekeeper registry with checked live runtime attachment. */
import { readFileSync, realpathSync } from "node:fs";
import { Value } from "typebox/value";
import { GatekeeperToolDefSchema, SupportedResourceSchema, type ApprovalQueue, type Gatekeeper, type GatekeeperSession, type GatekeeperToolDef, type GatekeeperVendor, type Grant, type SupportedResource } from "@clawos/shared";
import { gatekeeperRuntimeSlot } from "@clawos/gatekeeper-kit";

/** Enabled gatekeeper identity and static, schema-checked catalog metadata. */
export interface CatalogEntry { pluginId:string; vendor:string; apiVersion:1; root:string; tools:GatekeeperToolDef[]; resources:SupportedResource[]; enabled?:boolean; }
interface CatalogFile { version:1; gatekeepers:CatalogEntry[]; }
/** Runtime binding retained only for the duration of a resolved grant session. */
export interface OpenedSession { session:GatekeeperSession; gatekeeper:Gatekeeper; instanceId:string; }

/** Validates static metadata and resolves a fresh, identity-checked runtime slot for every use. */
export class Registry {
  readonly entries=new Map<string,CatalogEntry>();
  readonly tools:GatekeeperToolDef[]=[];
  constructor(readonly catalogPath:string,readonly stateDir:string){ this.load(); }
  toolNames():string[]{return this.tools.map(t=>t.name);}
  resources():Array<{entry:CatalogEntry;resource:SupportedResource}>{return [...this.entries.values()].flatMap(entry=>entry.resources.map(resource=>({entry,resource})));}
  entryForTool(name:string):CatalogEntry|undefined{return [...this.entries.values()].find(e=>e.tools.some(t=>t.name===name));}
  private load():void{
    let parsed:CatalogFile;try{parsed=JSON.parse(readFileSync(this.catalogPath,"utf8")) as CatalogFile;}catch{ return; }
    if(parsed.version!==1||!Array.isArray(parsed.gatekeepers))throw new Error("Invalid gatekeeper catalog.");
    const names=new Set<string>();
    for(const raw of parsed.gatekeepers){
      if(raw.enabled===false)continue;
      if(!/^gatekeeper-[a-z][a-z0-9_]*$/.test(raw.pluginId)||raw.pluginId!==`gatekeeper-${raw.vendor}`||raw.apiVersion!==1||this.entries.has(raw.vendor))throw new Error("Invalid gatekeeper catalog identity.");
      const root=realpathSync(raw.root);if(!Array.isArray(raw.tools)||!Array.isArray(raw.resources))throw new Error("Invalid gatekeeper catalog metadata.");
      for(const tool of raw.tools){if(!Value.Check(GatekeeperToolDefSchema,tool)||names.has(tool.name)||!tool.name.startsWith(`gk_${raw.vendor}_`))throw new Error("Invalid gatekeeper catalog tool.");names.add(tool.name);}
      for(const resource of raw.resources)if(!Value.Check(SupportedResourceSchema,resource)||resource.tools.some(n=>!raw.tools.some(t=>t.name===n&&t.resourceType===resource.type)))throw new Error("Invalid gatekeeper catalog resource.");
      const entry={...raw,root,tools:structuredClone(raw.tools),resources:structuredClone(raw.resources)};this.entries.set(entry.vendor,entry);this.tools.push(...entry.tools);
    }
  }
  private live(vendor:string){
    const entry=this.entries.get(vendor);if(!entry)throw new Error("Gatekeeper unavailable.");
    const runtime=gatekeeperRuntimeSlot(entry.pluginId).tryGetRuntime();
    if(!runtime||runtime.pluginId!==entry.pluginId||runtime.vendor!==entry.vendor||runtime.apiVersion!==entry.apiVersion||realpathSync(runtime.root)!==entry.root||realpathSync(runtime.stateDir)!==realpathSync(this.stateDir))throw new Error("Gatekeeper unavailable.");
    return {entry,vendor:runtime.getVendor()};
  }
  /** Resolve a live vendor for operator-only account setup, never for resource access. */
  connection(vendorName:string):GatekeeperVendor{return this.live(vendorName).vendor;}
  /** Resolve account and resource afresh; this is called only by Kernel.resolveGrant. */
  async openSession(grant:Grant,queue:ApprovalQueue):Promise<OpenedSession>{
    const {vendor}=this.live(grant.vendor);const account=await vendor.getAccount(grant.operatorId)??await vendor.createAccount?.(grant.operatorId);if(!account)throw new Error("Gatekeeper unavailable.");
    const resolved=await account.getGatekeeperFor(grant.resourceKey);if(resolved.resource.type!==grant.resourceType||resolved.resourceKey!==grant.resourceKey)throw new Error("Gatekeeper unavailable.");
    return {session:await resolved.gatekeeper.startSession(queue),gatekeeper:resolved.gatekeeper,instanceId:instanceId(grant)};
  }
  /** Validate an introduction through the operator's live account. */
  async introduce(vendorName:string,operatorId:string,url:string){
    const {entry,vendor}=this.live(vendorName);let account=await vendor.getAccount(operatorId);if(!account&&vendor.createAccount)account=await vendor.createAccount(operatorId);if(!account)throw new Error("Gatekeeper account unavailable.");
    const resolved=await account.getGatekeeperFor(url);if(!entry.resources.some(r=>r.type===resolved.resource.type))throw new Error("Unsupported resource.");return resolved;
  }
  /** Return safe health metadata without exposing resource identities. */
  health(){return [...this.entries.values()].map(entry=>{try{this.live(entry.vendor);return {vendor:entry.vendor,healthy:true,accounts:0};}catch{return {vendor:entry.vendor,healthy:false,accounts:0};}});}
}
/** Stable cell-local resource/account key; never an authorization decision on its own. */
export function instanceId(g:Grant):string{return `${g.vendor}\u0000${g.operatorId}\u0000${g.resourceKey}`;}
