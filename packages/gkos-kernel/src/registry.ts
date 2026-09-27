/** Catalog-backed gatekeeper registry. The kernel loads and owns every catalog driver; no plugin hands it one. */
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Value } from "typebox/value";
import { GatekeeperToolDefSchema, SupportedResourceSchema, type ApprovalQueue, type Gatekeeper, type GatekeeperSession, type GatekeeperToolDef, type GatekeeperVendor, type Grant, type SupportedResource } from "@gatekeeper-os/shared";
import { defineGatekeeperDriver, gatekeeperDriverPath, startGatekeeperDriver, validateGatekeeperManifest, type GatekeeperDefinition, type LiveGatekeeper, type VendorContext } from "@gatekeeper-os/gatekeeper-kit";

/** Enabled gatekeeper identity and static, schema-checked catalog metadata. */
export interface CatalogEntry { pluginId:string; vendor:string; apiVersion:1; root:string; tools:GatekeeperToolDef[]; resources:SupportedResource[]; enabled?:boolean; }
interface CatalogFile { version:1; gatekeepers:CatalogEntry[]; }
/** Runtime binding retained only for the duration of a resolved grant session. */
export interface OpenedSession { session:GatekeeperSession; gatekeeper:Gatekeeper; instanceId:string; }

/** Validates static metadata and owns the live drivers it starts from catalog roots. */
export class Registry {
  readonly entries=new Map<string,CatalogEntry>();
  /** Kernel-owned live drivers keyed by vendor; populated only by start() and revoked by stop(). */
  readonly drivers=new Map<string,LiveGatekeeper>();
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
      if(!/^gkos-gatekeeper-[a-z][a-z0-9_]*$/.test(raw.pluginId)||raw.pluginId!==`gkos-gatekeeper-${raw.vendor}`||raw.apiVersion!==1||this.entries.has(raw.vendor))throw new Error("Invalid gatekeeper catalog identity.");
      const root=realpathSync(raw.root);if(!Array.isArray(raw.tools)||!Array.isArray(raw.resources))throw new Error("Invalid gatekeeper catalog metadata.");
      for(const tool of raw.tools){if(!Value.Check(GatekeeperToolDefSchema,tool)||names.has(tool.name)||!tool.name.startsWith(`gk_${raw.vendor}_`))throw new Error("Invalid gatekeeper catalog tool.");names.add(tool.name);}
      for(const resource of raw.resources)if(!Value.Check(SupportedResourceSchema,resource)||resource.tools.some(n=>!raw.tools.some(t=>t.name===n&&t.resourceType===resource.type)))throw new Error("Invalid gatekeeper catalog resource.");
      validateGatekeeperManifest(root,raw.pluginId,raw.tools.map(tool=>tool.name));
      const entry={...raw,root,tools:structuredClone(raw.tools),resources:structuredClone(raw.resources)};this.entries.set(entry.vendor,entry);this.tools.push(...entry.tools);
    }
  }
  /**
   * Load each enabled catalog driver from its manifest-declared module inside the validated root, re-validate it with
   * the kernel's own kit, and start it. A failing driver stays unavailable and never blocks the kernel.
   */
  async start(host:{config:unknown;logger:VendorContext["logger"]}):Promise<void>{
    this.stop();
    for(const entry of this.entries.values()){
      try{
        const pluginConfig=enabledPluginConfig(host.config,entry.pluginId);if(!pluginConfig)throw new Error();
        const loaded:unknown=(await import(pathToFileURL(gatekeeperDriverPath(entry.root)).href)).default;
        const def=defineGatekeeperDriver(loaded as GatekeeperDefinition);
        if(def.id!==entry.pluginId||def.vendor!==entry.vendor||def.apiVersion!==entry.apiVersion||def.tools.length!==entry.tools.length||entry.tools.some(t=>!def.tools.some(d=>d.name===t.name)))throw new Error();
        this.drivers.set(entry.vendor,startGatekeeperDriver(def,{pluginConfig:structuredClone(pluginConfig),stateDir:realpathSync(this.stateDir),logger:host.logger}));
      }catch{host.logger.warn(`GatekeeperOS: gatekeeper ${entry.vendor} unavailable.`);}
    }
  }
  /** Revoke every driver; retained vendor, account, resource and session handles fail closed. */
  stop():void{for(const driver of this.drivers.values())driver.revoke();this.drivers.clear();}
  private live(vendor:string){
    const entry=this.entries.get(vendor),driver=this.drivers.get(vendor);if(!entry||!driver)throw new Error("Gatekeeper unavailable.");
    return {entry,vendor:driver.vendor};
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
/** Upstream enablement for a catalog plugin and its lifecycle-owned config; undefined when upstream would not load it. */
function enabledPluginConfig(config:unknown,id:string):Record<string,unknown>|undefined{
  const plugins=(config as {plugins?:{enabled?:boolean;allow?:unknown;deny?:unknown;entries?:Record<string,{enabled?:boolean;config?:Record<string,unknown>}|undefined>}}|undefined)?.plugins;
  if(plugins?.enabled===false||(Array.isArray(plugins?.deny)&&plugins.deny.includes(id))||(Array.isArray(plugins?.allow)&&!plugins.allow.includes(id)))return;
  const entry=plugins?.entries?.[id];if(entry?.enabled===false)return;
  return entry?.config??{};
}
/** Stable cell-local resource/account key; never an authorization decision on its own. */
export function instanceId(g:Grant):string{return `${g.vendor}\u0000${g.operatorId}\u0000${g.resourceKey}`;}
