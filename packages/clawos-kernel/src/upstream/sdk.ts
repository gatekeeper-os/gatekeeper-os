/**
 * The ONLY file that imports upstream SDK types. An upstream API rename is a one-file change (plan §12 item 1).
 * Types below were confirmed against openclaw@2026.9.2's published declarations (dist/plugin-sdk/plugin-entry.d.ts).
 */
export type {
  OpenClawPluginApi,
  OpenClawPluginConfigSchema,
  OpenClawPluginServiceContext,
  PluginTrustedToolPolicyRegistration,
  AnyAgentTool,
} from "openclaw/plugin-sdk/plugin-entry";
export { definePluginEntry, buildJsonPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";
export { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

/** Handler options for api.registerGatewayMethod (VERIFIED 2026.9.2): { req, params, client, respond, context, … }. */
export type GatewayMethodOptions = Parameters<Parameters<import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginApi["registerGatewayMethod"]>[1]>[0];
/** Hook event/context types are not exported from the SDK subpaths (2026.9.2), so they are derived from api.on() via
 *  instantiation expressions. If upstream renames a hook, this is where the compiler complains. */
declare const on: import("openclaw/plugin-sdk/plugin-entry").OpenClawPluginApi["on"];
export type HookName = Parameters<typeof on>[0];
export type HookHandler<K extends HookName> = Parameters<typeof on<K>>[1];
export type HookEvent<K extends HookName> = Parameters<HookHandler<K>>[0];
export type HookCtx<K extends HookName> = Parameters<HookHandler<K>>[1];
export type HookResult<K extends HookName> = ReturnType<HookHandler<K>>;
