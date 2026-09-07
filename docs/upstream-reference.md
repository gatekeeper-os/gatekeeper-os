# Upstream Reference — OpenClaw and Cloudflare OS facts

Quick reference of the facts the plan depends on, so the implementing agent does not re-research upstream. Everything here was checked on 2026-09-06 against https://docs.openclaw.ai, the `openclaw/openclaw` repository, the npm registry, and the `cloudflare/cloudflare-os` and `cloudflare-os-starter` repositories. Rows marked **UNVERIFIED** must be settled in Phase 0 spike S-1 and updated here with the evidence. If upstream behavior contradicts a VERIFIED row, record the discrepancy in `plans/spike-S1.md` and update this file — upstream may have moved.

## 1. Versions

| Item | Value |
|---|---|
| npm `latest` (stable) | `2026.9.2` |
| npm `beta` | `2026.9.1` |
| npm `extended-stable` | `2026.6.34` |
| Version scheme | `YYYY.M.PATCH`; pre-releases `2026.4.1-beta.1` |
| Node | `engines.node` in the published `openclaw@2026.9.2` package: `>=22.22.3 <23 \|\| >=24.15.0 <25 \|\| >=25.9.0` (matches the docs) |
| `node:sqlite` | unflagged from Node 22.13 — used for the kernel store |
| Docker image | `ghcr.io/openclaw/openclaw:latest` (mirror `openclaw/openclaw`) |

## 2. Install, service, health, update

```bash
curl -fsSL https://openclaw.ai/install.sh | bash                 # macOS/Linux/WSL2 (provisions Node if needed)
curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard
npm install -g openclaw@latest --allow-scripts=openclaw
openclaw onboard --install-daemon
openclaw gateway install            # creates ~/.config/systemd/user/openclaw-gateway[-<profile>].service (launchd on macOS)
openclaw gateway run                # foreground (explicit form of `openclaw gateway`)
openclaw gateway start|stop|restart|status
openclaw daemon …                   # legacy alias of `openclaw gateway` service commands
curl -fsS http://127.0.0.1:18789/healthz | /startupz | /readyz     # unauthenticated
openclaw update [--dry-run] [--channel stable|extended-stable|beta|dev] [--tag <version>]   # --channel persists to update.channel; --tag is one-off
openclaw backup create --output <dir> --verify
openclaw doctor [--fix|--repair] [--non-interactive] [--deep] [--lint] [--json]   # lint: exit 0 clean / 1 findings / 2 failure
openclaw security audit [--deep] [--fix] [--json]
openclaw uninstall [--service|--state|--workspace|--app|--all] [--yes] [--non-interactive] [--dry-run]
```

Update behavior: validates the new version while the current Gateway keeps serving, activates with verification, automatic schema-neutral rollback on verification failure. Systemd unit restarts always with a 5 s interval; hand-written units need explicit heap limits; set `OOMPolicy=continue`. Use `loginctl enable-linger` for always-on user units.

## 3. Paths and environment

| Item | Value |
|---|---|
| Config | `~/.openclaw/openclaw.json` (JSON5; mode 600; all fields optional) |
| State dir | `~/.openclaw/` (mode 700); profile → `~/.openclaw-<profile>/` |
| Workspace | `~/.openclaw/workspace` (cwd, **not** a sandbox); override `agents.defaults.workspace` |
| Per-agent store | `~/.openclaw/agents/<agentId>/agent/` (sessions in `openclaw-agent.sqlite`) — never share `agentDir` across agents |
| Upstream DB | `~/.openclaw/state/openclaw.sqlite` (exec approvals, cron jobs, …) — the OS never opens it |
| Internal hooks | `<stateDir>/hooks/` + `hooks.internal.load.extraDirs` |
| Skills | `<workspace>/skills` → `<workspace>/.agents/skills` → `~/.agents/skills` → `<stateDir>/skills` → workshop → bundled |
| Global env file | `~/.openclaw/.env` (precedence: process env → local `.env` → global `.env` → config `env` → shell import) |
| Managed plugin root | `~/.openclaw/extensions` (or `<workspace>/.openclaw/extensions`); only plugin package/bundle *directories* are auto-discovered there, standalone script files are not (`docs/cli/plugins.md` in the 2026.9.2 package) |
| Docker mounts | `/home/node/.openclaw`, `/home/node/.openclaw/workspace`, `/home/node/.config/openclaw` |

Env vars: `OPENCLAW_HOME`, `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, `OPENCLAW_WORKSPACE_DIR`, `OPENCLAW_PROFILE`, `OPENCLAW_GIT_DIR`, `OPENCLAW_INCLUDE_ROOTS`, `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_PORT`, `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_GATEWAY_PASSWORD`, `OPENCLAW_LOG_LEVEL`, `OPENCLAW_LOAD_SHELL_ENV`, `OPENCLAW_OFFLINE`, `OPENCLAW_NO_AUTO_UPDATE`. CLI global flags: `--dev` (state `~/.openclaw-dev`, port 19001), `--profile <name>`, `--container <name>`, `--log-level`, `--no-color`.

Workspace files: `AGENTS.md`, `SOUL.md`, `USER.md` (4,000-char limit), `IDENTITY.md`, `BOOT.md`, `BOOTSTRAP.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`, `skills/`.

## 4. Configuration

Top-level keys: `gateway`, `channels`, `agents`, `session`, `messages`, `talk`, `models`, `mcp`, `skills`, `plugins`, `browser`, `ui`, `desktop`, `worktreeRoot`, `cloudWorkers`, `hooks`, `tools`, `update`, `secrets`.

`gateway`: `mode: local|remote`, `port` (18789), `bind: auto|loopback|lan|tailnet|custom`, `publicOrigin`, `auth.mode: none|token|password|trusted-proxy`, `auth.token`, `auth.password`, `auth.allowTailscale`, `tls.{enabled,autoGenerate,certPath,keyPath}`, `reload.mode: off|hybrid` (hybrid default: hot-apply what it can, restart when required; port/bind/auth/roles/tailscale/TLS need restart), `nodes.pairing.autoApproveCidrs`. Port resolution: `--port` → `OPENCLAW_GATEWAY_PORT` → `gateway.port` → default.

`tools`: `profile: minimal|coding|messaging|full`, `allow[]`, `deny[]`, `byProvider.<provider>`, `toolsBySender.<sender>.{alsoAllow,deny}`, `elevated.{enabled,allowFrom}`, `agentToAgent.{enabled,allow}`, `sessions.visibility: self|tree|agent|all`, `exec.mode: deny|allowlist|ask|auto|full` (legacy `exec.security`/`exec.ask` auto-migrated by doctor), `exec.askFallback`, `exec.timeoutSeconds` (1800), `exec.backgroundMs` (10000), `exec.grantExpiryDays`. Groups: `group:runtime` (exec, process, code_execution), `group:fs` (read, write, edit, apply_patch), `group:sessions`, `group:plugins`, `group:openclaw`, `group:automation`. If policy removes a tool, the model does not receive its schema. Built-in tools: `exec`, `process`, `terminal`, `code_execution`, `read`, `write`, `edit`, `apply_patch`, `ask_user`, `secrets`, `web_search`, `x_search`, `web_fetch`, `browser`, `message`, `subagents`, `agents_list`, `session_status`, `cron`, `heartbeat_respond`, `image_generate`, `music_generate`, `video_generate`, `tts`.

`plugins`: `enabled`, `allow[]`, `deny[]` (authoritative — overrides allow and per-plugin enablement), `load.paths[]`, `entries.<id>.{enabled,config,…}`, `slots.{memory,contextEngine}`.

`agents.defaults.sandbox`: `mode: off|non-main|all`, `scope: agent|session|shared`, `backend: docker|podman|ssh|openshell`, `workspaceAccess: none|ro|rw`; Docker/Podman default `network: none`. Sandboxed: exec, ls, read, write, edit, apply_patch, process, optionally browser. Not sandboxed: Gateway process, native plugins, elevated tools.

`hooks`: HTTP webhooks `hooks.{enabled,token,path,allowedAgentIds,mappings,transformsDir}`; internal hooks `hooks.internal.{enabled,entries.<key>.{enabled,env},load.extraDirs}`.

`update`: `channel`, `auto.enabled`. `session.dmScope: per-channel-peer`. `skills.entries.<name>.{enabled,apiKey,env,config}`, `skills.load.extraDirs`, `agents.defaults.skills[]` (allowlists replace defaults; snapshots at session start).

Includes and substitution: `$include` — single file replaces the containing object; array deep-merges in order (later wins), ≤10 levels; **sibling keys are merged after includes and override them**; paths must resolve under the config file's directory or `OPENCLAW_INCLUDE_ROOTS`. **OpenClaw-owned writes** (`config patch`, doctor) write through only to a single-file include of one top-level section; **root includes, include arrays, and includes with sibling overrides fail closed for OpenClaw-owned writes**, and `$include` configs are not auto-migrated on startup — which is why the OS reconciles into `openclaw.json` instead of using `$include` (plan §6.2). `${VAR}` in string values (uppercase names only; `$${VAR}` escapes). SecretRef: `{ source: "env"|"file"|"exec", provider, id }`. Invalid external edits are rejected without rewriting the file (`config reload skipped (invalid config)` → `openclaw doctor --fix`).

```bash
openclaw config file|get <path>|schema|validate
openclaw config set <path> <value> [--merge|--replace] [--strict-json]
openclaw config patch --file <f> | --stdin [--dry-run] [--expect-current-json <v>] [--expect-current-absent]
openclaw config unset <path>
# patch semantics: objects merge recursively; arrays and scalars replace; null deletes;
# objects on agents.entries / plugins.entries require --merge to avoid data loss
```

Hardened baseline (upstream security page): `gateway.bind: loopback`, `auth.mode: token`, `session.dmScope: per-channel-peer`, `tools.profile: messaging`, `tools.deny: [group:automation, group:runtime, group:fs]`, `tools.exec: {security: deny, ask: always}` (→ `mode: deny`), `channels.whatsapp.dmPolicy: pairing`. Trust model: one Gateway = one trust boundary; for mixed trust use separate Gateways, credentials, OS users or hosts.

## 5. Plugin system

Manifest `openclaw.plugin.json`: `id`, `name`, `description`, `contracts.{tools[],agentToolResultMiddleware,trustedToolPolicies,gatewayMethodDispatch,workerProviders,…}`, `activation.onStartup`, `configSchema`, `toolMetadata.<tool>.optional`, `cliCommands`. Unknown top-level `clawos` metadata is **VERIFIED** to permit the S-1 probe load/RPC on 2026.9.2. This does not imply it is preserved in snapshot reports. `configSchema` remains mandatory, including disabled placeholder plugins (pinned `docs/plugins/manifest.md`). `openclaw.compat.pluginApi` is enforced at install time for non-bundled sources; `peerDependencies.openclaw` is npm metadata only.

`package.json`: `type: module`, `peerDependencies.openclaw`, `openclaw.extensions[]`, `openclaw.compat.{pluginApi,minGatewayVersion}`, `openclaw.build.{openclawVersion,pluginSdkVersion}`.

Entry definers: `defineToolPlugin`, `definePluginEntry({id,name,description,register(api),configSchema?,reload?})`, `defineChannelPluginEntry`, `defineSetupPluginEntry`. Registration modes: `full`, `discovery`, `tool-discovery`, `setup-only`, `setup-runtime`, `cli-metadata` — runtime unavailable in `setup-only`/`cli-metadata` (check `api.registrationMode`). SDK subpaths: `openclaw/plugin-sdk/plugin-entry`, `/core`, `/channel-core`, `/runtime-store`, `/gateway-method-runtime`. All plugin APIs are declared experimental.

Load precedence: `OPENCLAW_DEV_SOURCE_ROOT` bundled → tracked global installs → `plugins.load.paths` → workspace plugin dirs → global plugin roots → bundled. Three phases: metadata → registry → runtime. The metadata snapshot is immutable per Gateway session: manifest or discovery changes require `openclaw gateway restart`.

`api.*` (verified): `registerTool(tool, { optional? })` where `tool.execute(toolCallId, params, signal?, onUpdate?)` — **no per-call context argument**; `registerCommand`, `registerNodeHostCommand`, `registerWidgetPresenter`; `registerHook` (internal hook system — not for the typed catalog names); `registerHttpRoute({ path, auth: "gateway"|"plugin", match?: "exact"|"prefix", handleUpgrade?, replaceExisting?, handler(req,res) → true when handled })`; `registerGatewayMethod(name, handler, { profileAccess: "required"|"independent" })`; `registerCli(({ program }) => …, { commands?, descriptors?, parentPath? })`; `registerService({ id, start(ctx), stop() })` (ctx carries `gatewayEvents` when a broadcaster exists; shape inferred from docs prose); `registerTrustedToolPolicy(policy)` — runs before all `before_tool_call` hooks, accepts `matcher`, host-level only; providers (`registerProvider`, `registerChannel`, `registerEmbeddingProvider`, …); `api.session.state.registerSessionExtension()`, `api.session.workflow.enqueueNextTurnInjection()`, `api.session.controls.registerControlUiDescriptor()`, `api.lifecycle.registerRuntimeLifecycle()`, `api.agent.events.registerAgentEventSubscription()`, `api.registerContextEngine`, `api.registerMemoryCapability`. Fields: `api.id`, `api.config`, `api.pluginConfig`, `api.runtime`, `api.logger`, `api.resolvePath`. Reserved command namespaces (rejected for external plugins): `config.*`, `exec.approvals.*`, `wizard.*`, `update.*`.

```bash
openclaw plugins list [--enabled] [--json] | search <q> | inspect <id> [--runtime] [--json]
openclaw plugins install clawhub:<pkg>[@v] | npm:@scope/pkg@v | npm-pack:<tgz> | git:github.com/o/r@ref | ./dir [--link] [--pin] [--force] [--accept-capabilities]
openclaw plugins enable|disable <id> ; update <id>|--all [--dry-run] ; uninstall <id> [--keep-files]
openclaw plugins init <id> --name "…" ; build --entry ./dist/index.js ; validate --entry ./dist/index.js ; doctor
```
Local-path installs re-prompt for capability consent every time (no recorded integrity). A newly installed plugin that needs missing config is recorded but left disabled until `plugins.entries.<id>.config` is set and `plugins enable <id>` is run.

## 6. Plugin hooks (`api.on(name, handler, opts)`)

`opts`: `matcher?: string[]` (tool ids, for `before_tool_call`/`after_tool_call`), `priority?` (higher first), `registrationId?`, `timeoutMs?`, `eligibleTriggers?: ("cron"|"heartbeat"|"user")[]`, `eligibleDispatchKinds?`, `requiresToolAuthority?` (for `before_prompt_build`).

| Hook | Type | Handler shape |
|---|---|---|
| `before_agent_run` | Gate | `(e{prompt,messages}, ctx{agentId,sessionKey,sessionId,runId,channel,channelId,senderId?,chatId?}) → pass \| { outcome:"block", reason, message? }` — 15 s, fail closed |
| `before_prompt_build` | Modify | add context; narrow the turn's submitted tools in the ordinary phase (omit `requiresToolAuthority`) — 15 s, log+skip |
| `before_tool_call` | Modify/Gate | `(e{toolName,params,toolKind?,toolInputKind?,derivedPaths?,runId?,toolCallId?}, ctx{agentId,sessionKey,sessionId,runId,trace,abortSignal?,requester?}) → { params?, block?, blockReason?, requireApproval?: {title, description, severity?, timeoutMs?, allowedDecisions?, pluginId?, onResolution?} }` — `block:true` terminal; first `requireApproval` wins; 15 s fail closed |
| `after_tool_call` | Observe | results, errors, duration |
| `before_agent_reply` | Claim | short-circuit with synthetic reply or silence |
| `before_agent_finalize`, `agent_end` | Modify / Observe | — |
| `message_sending` | Modify/Gate | `→ { content?, cancel?, cancelReason?, metadata? }`; last `content` wins; `cancel` terminal |
| `before_message_write` | sync Modify/Gate | `→ { message? , block? }` — must not be async |
| `before_install` | Gate | `(e: staged skill/plugin material) → { block?, blockReason? }` — fail closed |
| `resolve_exec_env`, `tool_result_persist`, `inbound_claim`, `channel_pairing_requested` (2 s), `message_received`, `reply_payload_sending`, `message_sent`, `before_dispatch`, `reply_dispatch`, `session_start/end`, `before/after_compaction`, `before_reset`, `subagent_*`, `gateway_start`, `gateway_stop` (5 s), `cron_*`, `skill_*`, `model_call_*`, `llm_input`, `llm_output` | — | see docs |

Internal hooks (separate system): `HOOK.md` frontmatter (`name`, `description`, `metadata.openclaw.{events[],export,hookKey,requires…}`) + `handler.ts` exporting `default function(event)`; events `command:*`, `session:*`, `agent:bootstrap` (only documented mutable field: `context.bootstrapFiles`), `gateway:startup|shutdown|pre-restart`, `message:*`. Discovery: bundled → plugin-declared → `<stateDir>/hooks/` → `extraDirs` → `<workspace>/hooks/`. Run unsandboxed in the Gateway process. `openclaw hooks list|info|check|enable|disable`; `hooks install` is a deprecated alias of `plugins install`.

## 7. Agents, channels, approvals, cron, messaging

```bash
openclaw agents add <id> --workspace <dir> [--model <id>] [--agent-dir <dir>] [--bind channel[:account]] --non-interactive [--json]
openclaw agents list --bindings
openclaw channels status --probe ; openclaw channels login --channel <c> [--account <id>]
openclaw pairing list <channel> ; openclaw pairing approve <channel> <CODE> [--notify]
openclaw devices list|approve <id>|reject <id>
openclaw message send --channel <c> --target <t> --message "<text>" [--media] [--reply-to] [--json] [--dry-run]
openclaw approvals get|set [--gateway|--node <id>] ; approvals grants list|revoke <id>
openclaw exec-policy show|set --host <auto|sandbox|gateway|node> --security … --ask … |preset yolo|cautious|deny-all
openclaw automations|cron create "<cron>" "<prompt>" --name … --agent … [--every|--at|--tz|--announce|--webhook|--session isolated|main] ; list|run|runs|enable|disable
openclaw skills install @owner/<slug> [--global] | git:o/r@ref | ./path --as name ; update --all ; check
openclaw sandbox list|explain|recreate
clawhub package publish your-org/your-plugin [--dry-run]
```

Bindings resolve most-specific-wins: exact peer → parent peer → peer wildcard → guild+roles → guild → team → account → channel → default agent. DM policies: `pairing` (default), `allowlist`, `open`, `disabled`. Gateway wire: WebSocket JSON frames; first frame `connect`; `req/res/event`; events are not replayed. Exec approvals: `exec.approval.requested` / `exec.approval.resolve` events; state in `state/openclaw.sqlite`; socket `<stateDir>/exec-approvals.sock`.

## 8. Cloudflare OS facts the design ports

OS mapping (README): kernel = `workshop-backend`; drivers = `gatekeeper-*`; shell = `workshop-frontend`; processes = gadgets; executables = blueprints; ACLs = shared permissions; agents get their own row. Gatekeeper tiers: `GatekeeperVendor` (WorkerEntrypoint) → `GatekeeperUser` (per human) → `Gatekeeper<Session>` (per resource, DO facet of the Overseer). Interfaces in `packages/workshop-shared/src/gatekeeper.ts`: `ApprovalQueue.{authorizeObservation, submitAction, bindHook, getGitCache}`, `Gatekeeper.{describe, getTypeScriptTypes, getAutoApprovableActions, startSession, addObserver, removeObserver, applyAction, rejectAction, revertAction?}`, `ObservationDescription.{title, description, prohibitAllSharing?, excludeObservers?}`, `ActionDescription.{title, description, implementsRevert, awaitDecision?, autoApprovable?, actionKind?}`, `ActionKind{tag,label}`. Discovery by binding-name prefix `GATEKEEPER_` (`auth-vendors.ts`); chokepoint `getGatekeeperClassFor()` in `user.ts`. Auto-approval = user rule on `tag` AND per-action `autoApprovable`; `AutoApprovalDrainer` applies in id order, single-flight, stops at first non-eligible. Simulation strategies: mutate-the-cache or overlay-at-read. Observer strategies A/B/C/D; `excludeObservers` errs toward blocking. Sandbox: `globalOutbound: null` for gadget and agent code. Starter: git submodule pin, `deployment.jsonc` (never secrets), `scripts/deploy.ts` derives `wrangler.prod.jsonc` from upstream base, catalog must stay byte-identical with the submodule, seven-step upgrade with recorded rollback point. Contribution stance: kernel reviewed line-by-line; "never log secrets, prompts, headers, tokens, or request/response bodies"; "a gatekeeper must never assert its own ambience".

## 9. Confirmed from the published `openclaw@2026.9.2` package (types and bundled docs)

`pnpm install` in the repo skeleton pulls `openclaw@2026.9.2` as a peer, so `node_modules/openclaw/dist/plugin-sdk/*.d.ts` and
`node_modules/openclaw/docs/**` are available offline. The kernel skeleton type-checks against these declarations. Facts read
directly from them:

- `api.on(hookName, handler, opts)` is the typed hook API; hook event/context types are **not** exported from any
  `plugin-sdk/*` subpath — derive them from `OpenClawPluginApi["on"]` with instantiation expressions (see
  `packages/clawos-kernel/src/upstream/sdk.ts`).
- `PluginToolMatcher = readonly [string, ...string[]]` — a non-empty list of canonical tool ids. **Wildcards, blanks, and
  aliases are invalid** (`docs/plugins/hooks.md`). The kernel passes the explicit `gk_*` list or omits the matcher.
- `registerTrustedToolPolicy({ id, description, matcher?, evaluate(event, ctx) })` → `PluginHookBeforeToolCallResult | { allow?, reason? } | void`.
- `PluginHookBeforeToolCallEvent = { toolName, params, toolKind?, toolInputKind?, runId?, toolCallId?, derivedPaths? }`;
  `PluginHookToolContext = { agentId?, sessionKey?, sessionId?, runId?, abortSignal?, trace?, toolName, toolCallId?, channelId?, requester?, getSessionExtension? }` — every identity field is optional: **fail closed when absent**.
- `PluginHookBeforeToolCallResult.requireApproval` adds `scope?`, `timeoutReason?`, and a deprecated `timeoutBehavior` (unresolved approvals always deny).
- `PluginHookBeforePromptBuildResult = { systemPrompt?, prependContext?, appendContext?, prependSystemContext?, toolsAllow?: string[] }` — `toolsAllow` is the per-turn tool narrowing.
- `PluginHookBeforeAgentRunEvent = { prompt, messages, systemPrompt?, accountId?, channelId?, senderId?, senderIsOwner?, … }`.
- `registerTool(tool, { name?, names?, optional? })`; `tool.execute(toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult<T>>` with `AgentToolResult = { content: (TextContent|ImageContent)[], details: T, progress?, terminate? }`. Helper `jsonResult(payload)` exists in `openclaw/plugin-sdk/core`.
- `registerGatewayMethod(name, handler, { scope?, profileAccess?: "independent"|"required" })`; `handler({ req, params, client: GatewayClient | null, respond(ok, payload?, error?, meta?), context, … })`. `GatewayClient` carries `connect`, `connId`, `clientIp`, `pairedClientId?`, `authenticatedUserId?`, ….
- `registerHttpRoute({ path, handler(req: IncomingMessage, res: ServerResponse) → boolean|void, auth: "gateway"|"plugin", match?: "exact"|"prefix", handleUpgrade?, replaceExisting?, gatewayRuntimeScopeSurface?: "write-default"|"trusted-operator" })`.
- `registerCli(registrar: ({ program: commander.Command, parentPath, config, workspaceDir? }) => void, opts)`; commander is the CLI framework.
- `registerService({ id, start(ctx), stop?(ctx), reload?: { configPrefixes } })`; `ctx = { config, stateDir, workspaceDir?, logger, gatewayEvents?, getCron?, serviceHealth?, … }`.
- `configSchema` on `definePluginEntry` is an `OpenClawPluginConfigSchema` — build it with `buildJsonPluginConfigSchema(jsonSchema)` (or `buildPluginConfigSchema(zod)` / `emptyPluginConfigSchema()`), all exported from `openclaw/plugin-sdk/plugin-entry`.
- Also on the API: `registerToolMetadata`, `registerControlUiDescriptor`, `registerRuntimeLifecycle`, `registerSecurityAuditCollector`, `registerConfigMigration`, `registerReload({ restartPrefixes, hotPrefixes })`, `enqueueNextTurnInjection`, `api.source`, `api.rootDir`.
- `security.installPolicy` (operator config) runs a trusted local command that returns `allow` / `warn` / `block` for skill and plugin installs after staging; it is the primary install boundary and fails closed when enabled but unavailable. `before_install` is a secondary plugin-runtime hook that trusted/bundled install paths may skip. `plugins.installs`, `plugins.load`, and `security.installPolicy` changes: installPolicy hot-applies; `plugins.load`/`plugins.installs` need a restart.
- `openclaw backup create` sources: the state directory (usually `~/.openclaw`, so `os/` is included), the active config path, `credentials/` if outside the state dir, and every configured agent directory.
- Trusted sources for install are ClawHub packages and the bundled/official catalog; arbitrary npm/git/local sources warn and need `--force` non-interactively — which is why the OS installer passes `--force --pin --accept-capabilities` for `@clawos/*` until they are published to ClawHub.

## 10. Historical S-1 observations and discrepancy (2026-09-07)

**Superseded diagnosis:** the continuation below identifies the full-only registration
guard and wrong prompt phase. These failure counts are retained as historical evidence,
not the current hook outcome. See the final continuation report in `plans/spike-S1.md`.

Evidence and exact commands: `plans/spike-S1.md`; latest run
`vm-artifacts/20260907-184712-phase-0/`, Ubuntu 24.04 / Node 24.20.0 /
OpenClaw 2026.9.2, reset from `base`. Phase 0 has **not** passed.

- **VERIFIED configuration prerequisite:** non-bundled plugins require
  `plugins.entries.<id>.hooks.allowConversationAccess: true` for conversation hooks.
  Source: pinned package `docs/plugins/hooks.md`, Permissions and scope. Missing
  permission produced explicit registration diagnostics in the second run; the
  third run had the opt-in and no such diagnostics.
- **BLOCKING discrepancy:** `before_tool_call` and `llm_input` did not fire on the
  scripted `openclaw agent` test path, although 20 plugin tool bodies executed.
  The intended gate-hook and narrowing guarantees above are **not validated** for
  this path. Root cause is unresolved; do not infer universal absence of these
  hooks, and do not claim the capability mechanism works.
- **VERIFIED S-1 h:** `node:sqlite` works through Node `createRequire()` inside the
  lifecycle; a static import failed plugin loading. No upstream patch was used.
- **VERIFIED S-1 i:** late registration returned successfully but its tool was
  absent from all 40 model requests. Use the plan's existing catalog-cache path.
- **VERIFIED S-1 m:** the absolute executable receives JSON `protocolVersion: 1`;
  JSON results with `protocolVersion: 1` and `decision` are enforced. Block and
  malformed results denied installation; allow succeeded. Pinned documentation:
  `docs/tools/skills-config.md`, `security.installPolicy`.
- **Observed, incomplete:** dotted and 64/65-character tool names reached the
  local model; no universal maximum was established. Unknown `clawos` manifest
  metadata did not prevent runtime loading; CLI validation is still pending.
  CLI shared-auth clients had operator role/scopes but no paired device or
  authenticated user ID; this does not answer the paired-client question.

## Continuation diagnostic surface (2026-09-07)

Read-only hook counts are obtained through the published
`openclaw/plugin-sdk/plugin-runtime` export `getGlobalHookRunner()` →
`getHookCount(name)`. VERIFIED source: pinned `dist/plugin-sdk/plugin-runtime.d.ts`
and `docs/plugins/sdk-subpaths.md` (deprecated public barrel). Used only by the
throwaway probe, never to reset, initialize, replace or invoke upstream hooks.

The paired-device probe uses `GatewayClient` from the documented public
`openclaw/plugin-sdk/gateway-runtime` subpath (`docs/plugins/sdk-subpaths.md`).
The SDK owns device identity generation, signing, pairing-token storage and the
wire handshake; the probe supplies isolated config auth only in memory and stores
only identity-presence flags. No upstream database is read by OS code.

Read-only diagnosis of the pinned distribution identifies the registration path:
`runtime-plugins-BDPJ7y4t.js:82` loads a non-activated registry handle;
`loader-DPiOPJjR.js:824` selects `discovery` for that handle;
`generation-scope-Cf83d_iq.js:9` carries it into the turn;
`hook-runner-global-0kfmMG4T.js:134` prefers this exact scoped registry.
A `full`-only early return therefore leaves turn hooks empty even while fallback
tools from the startup registry execute. These are inspection references, never
private imports. See `sdk-entrypoints.md` registration-mode table and
`sdk-runtime.md` for the live runtime available during discovery.

Two further scaffold corrections from the pinned public contracts:
- `before_prompt_build` must return `toolsAllow` in the ordinary phase, **without**
  `requiresToolAuthority`. That flag selects post-policy enrichment and permits only
  context additions, not tool changes (`docs/plugins/hooks.md`, Authorized prompt
  enrichment). The scaffold's interpretation of the flag was wrong.
- `plugins validate --root scripts/spike-probe --entry dist/index.js --json`
  exited 1 in fresh-base run `20260907-190538-phase-0`, reporting only
  `plugin entry does not expose tool or feature authoring metadata`. This command
  validates generated tool/feature authoring metadata, not every ordinary
  `definePluginEntry` plugin. Use config/manifest loading plus runtime inspection
  and an actual registered RPC for this probe; preserve the CLI limitation.

Cross-registration identity storage uses the documented
`openclaw/plugin-sdk/runtime-store` → `createPluginRuntimeStore({pluginId,
errorMessage})`. The object overload provides a shared process-local slot even
across duplicate SDK modules; the string overload does not. The probe initializes
its own slot only during full registration and accesses it lazily in hooks/tools.
Pinned SDK declarations are generic (`createPluginRuntimeStore<T>`); no upstream
registry is replaced or mutated by the probe. Source: `sdk-runtime.md`, Storing
runtime references; `dist/plugin-sdk/runtime-store.d.ts`.

Ordinary-plugin CI validation uses the documented `plugins inspect --all --json`
snapshot path (no `--runtime`), with entries disabled in a fresh isolated config.
It validates discovery/config-schema presence and rejects error diagnostics; it
does **not** claim plugin execution or runtime conformance. The executable
entrypoints are built and checked to remain inside their package roots.

## Completed continuation retest (2026-09-07)

`CLAWOS_VM_DRIVER=libvirt scripts/vm/test.sh phase-0`, fresh snapshot `base`,
artifacts `vm-artifacts/20260907-192654-phase-0/`, **exit 0**. Hook correlation
20/20; narrowed `llm_input` 20/20; actual narrowed model requests 40/40; SQLite,
paired SDK device-token reconnect, all three install-policy outcomes, dev Gateway
start/stop, and metadata-only inspection of five workspace plugins passed.
The old full-only-guard failure above is resolved for this path.

Paired identity fields observed: `connect.role`, `connect.scopes`,
`connect.device.id`, and `isDeviceTokenAuth` on token reconnect. No populated
`pairedClientId` or `authenticatedUserId` on either paired connection. Shared-auth
CLI role alone is not a pairing guarantee. This positive probe does not replace
negative operator-authorization conformance.

Phase 0 is still incomplete: S-1 c/j are partial and live CI has no destination.
The kernel source is still a scaffold; only the probe's runtime is verified here.


## 12. S-1 naming and live attachment continuation (2026-09-07)

**Documented provider naming contract (not paid-provider execution):**
- OpenAI Chat Completions function `name`: letters, digits, underscores/dashes;
  maximum 64 characters. Read via `web_fetch`:
  https://developers.openai.com/api/reference/resources/chat (Function definition).
- Anthropic user-defined tool `name`: `^[a-zA-Z0-9_-]{1,64}$`. Read via `web_fetch`:
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools.
- Pinned OpenClaw `docs/plugins/sdk-overview.md`, Node-host `agentTool.name`,
  independently documents a letter-first, 64-character provider-safe subset.
  That Node-host restriction is not claimed for generic `registerTool()`.

OS tool names retain §3.4's lowercase underscore convention with an explicit
64-character total bound. The kit/catalog must reject invalid names, never
silently truncate or rename (Phase 2). Dotted/65-character names being accepted
by the local OpenAI-compatible stub does not make them portable. Boundary-schema
acceptance and its exact run are in `plans/spike-S1.md`.

**Supported attachment surface:** `openclaw/plugin-sdk/runtime-store` exports
`createPluginRuntimeStore<T>({pluginId,errorMessage})`, `setRuntime`,
`tryGetRuntime`, `getRuntime`, `clearRuntime`. Object keys share one process-local
slot across independently loaded modules. `api.registerService` owns start/stop;
see pinned `docs/plugins/sdk-runtime.md` under Storing runtime references and
Gateway service events. It is not an upstream manifest enumerator or an
unforgeable identity mechanism. The OS-owned catalog selects roots/ids; live
slot checks distinguish available drivers from mere installed metadata. Native
plugins already share process trust. S-1 fixture evidence (including disabled
and retained-handle denial) is recorded separately; kernel security conformance
is not inferred from it.

`os-spike.discovery` is an OS test RPC registered with public
`api.registerGatewayMethod`, `profileAccess: independent`; it returns only
presence/outcome booleans. There is no registration RPC or driver serialization.
