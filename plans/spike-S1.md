# Spike S-1 — empirical answers to the UNVERIFIED items

Fill each entry with the exact command, its output (trimmed), the answer, and the plan sections updated. Do not start Phase 1
until every item is answered. Source of the questions: `docs/implementation-plan.md` §2.2 and §5.1; `docs/upstream-reference.md`.

Already settled from the published `openclaw@2026.9.2` package (see `docs/upstream-reference.md` §9) and therefore NOT part of
this spike: managed plugin root (`~/.openclaw/extensions`), `$include` semantics (sibling keys override; root/array includes
fail closed for OpenClaw-owned writes), `matcher` = explicit tool ids only (no wildcards), `execute(toolCallId, params, …)`,
`before_prompt_build` → `{ toolsAllow }`, `registerCli({ program: commander.Command })`, `registerService({ id, start, stop })`,
`registerGatewayMethod` handler `({ params, client, respond, context })`, backup covers the whole state directory.

| # | Question | Command / method | Answer | Plan sections updated |
|---|---|---|---|---|
| c | Allowed characters / max length for plugin tool names | register `gk_a_b_c`, a 64-char name, a dotted name; observe load diagnostics | | §3.4 |
| d | Does the manifest tolerate unknown top-level keys (`clawos`)? | `openclaw plugins validate` + load with the key present; check `plugins inspect --json` diagnostics | | §4.2 |
| e | Does `before_prompt_build` `toolsAllow` remove tool schemas from the model request? | inspect the `llm_input` payload | | §5.2 |
| f | Is `toolCallId` always present on `before_tool_call` for plugin tools? | log the event for 20 calls (probe writes `f:before_tool_call`) | | §5.2 |
| g | Which identity fields are populated on `GatewayClient` for a paired operator (`pairedClientId`, `authenticatedUserId`, `connect.role`)? | probe method `os-spike.report` logs `client` keys | | §5.4 |
| h | Can a plugin open its own SQLite under `OPENCLAW_STATE_DIR` while the gateway holds its DB? | probe opens `os/probe.sqlite` at `gateway_start` | | §5.3 |
| i | Can tools be registered after `register()` (at `gateway_start`)? | probe attempts late `api.registerTool` | | §5.1 |
| j | How does a plugin obtain the list of loaded plugin manifests (for gatekeeper discovery)? | explore `api.runtime` keys logged by the probe; else use the `os/gatekeepers.json` catalog | | §4.2 |
| m | Does `security.installPolicy` accept a command like `clawos install-policy` and what is its stdin/stdout contract? | read `docs/gateway/security` in the installed package; test with a dummy policy | | §7.5 |
