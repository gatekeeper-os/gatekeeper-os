# OpenClaw OS — Implementation Plan

**Version:** 1.0 · **Date:** 2026-09-06 · **Status:** Ready to build
**Upstream pin at time of writing:** `openclaw@2026.9.2` (npm dist-tag `latest`) · **Reference model:** `cloudflare/cloudflare-os` @ `main`, `cloudflare/cloudflare-os-starter` @ `main`

---

## 0. How to use this document

This plan is written so that an autonomous coding agent (or a human) can build OpenClaw OS end-to-end without further design decisions. It is organized as: principles → architecture → contracts → phased build plan → installation → operations. Each phase ends with acceptance criteria that must pass before the next phase begins.

Conventions used throughout:

| Marker | Meaning |
|---|---|
| **VERIFIED** | Confirmed against upstream docs or source on 2026-09-06 (sources in Appendix D). Safe to rely on. |
| **UNVERIFIED** | Believed correct but not confirmed. The implementing agent must confirm empirically in Phase 0 before hardcoding. |
| **DECISION** | A design choice made by this plan. Do not re-litigate unless it breaks an acceptance test. |
| **INVARIANT** | A rule that must hold in every phase and every future change. Violating it is a build failure. |

The two hard constraints from the project brief are restated here as invariants because everything else follows from them:

> **INVARIANT 1 — No upstream modification.** OpenClaw OS never patches, forks, vendors, or monkey-patches the `openclaw` package. All behavior is added through OpenClaw's public extension surfaces (plugins, plugin hooks, internal hooks, config, skills, CLI, HTTP/WebSocket API) and through host tooling that sits *outside* the OpenClaw process. Any file under the upstream install root is read-only to us.
>
> **INVARIANT 2 — Upstream must remain updatable.** A user must be able to move to a newer OpenClaw release with one OS command, and the OS must detect incompatibility *before* activating the new version and roll back cleanly if it fails. All OS state lives in OS-owned paths so an upstream update (or reinstall) never destroys it.

---

## 1. Goals, non-goals, principles

### 1.1 What "OpenClaw OS" means

Cloudflare OS uses "operating system" in two senses, and we adopt both: an operating system *for a person or company to be productive with AI safely*, and an operating system *for AI workloads*, in the sense that a traditional OS manages compute workloads. Concretely, OpenClaw OS adds to upstream OpenClaw the four things an OS provides that a bare agent runtime does not:

1. **A capability model.** Each agent starts with access to nothing. Resources (a GitHub repo, a Google Doc, a folder, an MCP server) are *introduced* to an agent one at a time, and the agent can only reach them through a mediating driver — a **Gatekeeper**.
2. **Drivers with human-in-the-loop that doesn't block.** Gatekeepers log every observation, queue every side-effecting action for approval, and *simulate* the effect locally so the agent keeps working while the human approves later, in bulk, when convenient.
3. **Process and user management.** Agents, sessions, and sandboxes are provisioned from **Blueprints**; trust boundaries are enforced by running one OpenClaw Gateway per boundary (a **Cell**).
4. **A stable, upgradeable base.** Upstream is pinned, updated deliberately, verified against a conformance suite, and rolled back automatically on failure — the `cloudflare-os-starter` pattern applied to a self-hosted daemon.

### 1.2 Non-goals

OpenClaw OS does not replace the OpenClaw Gateway, its Control UI, its channels, or its model routing; it does not attempt hostile multi-tenant isolation inside one Gateway (upstream explicitly does not support it — **VERIFIED**, `gateway/security`); it does not re-implement OAuth flows that a gatekeeper can delegate to an existing OpenClaw provider; and it does not target Windows natively in v1 (WSL2 is supported because upstream supports it).

### 1.3 Design principles (carried over from Cloudflare OS, adapted)

**Capabilities, not ACLs.** "Each agent, and each Gadget, by default has access to nothing… you must *introduce* each agent to any particular resources you want it to access" (cloudflare-os README). In OpenClaw OS the introduction primitive is a URL; a grant is an opaque handle the agent passes to gatekeeper tools.

**The kernel is small and held to a higher bar.** Cloudflare OS reviews *every line* of `workshop-backend`. Our kernel is one plugin (`clawos-kernel`) plus one shared contracts package; gatekeepers and UI are held to a normal bar. Fewer kernel lines = easier review.

**Prefer wrapper-owned components over patches.** From `cloudflare-os-starter/docs/customization.md`: "Prefer wrapper-owned Workers and service bindings over patches inside the submodule." Translated: prefer an OS plugin over a config hack, and a config hack over anything touching upstream files (which is forbidden anyway).

**Config is derived from upstream, not overlaid blindly.** The starter derives `wrangler.prod.jsonc` from upstream's base so incompatible base changes are visible in review. We do the same: OS config fragments are reconciled into `openclaw.json` through CLI dry-run plus the public SDK transactional writer with a base-revision guard, and `openclaw doctor --lint --json` is the gate.

**Deferred approval beats synchronous approval.** The cloudflare-os README's critique is the reason this project exists: synchronous approval makes people reach for `--dangerously-skip-permissions`. Gatekeepers simulate, queue, and let the human approve later.

**The abstraction must be invisible to the agent.** Gatekeeper tool descriptions never mention approvals, queues, caches, or OAuth. If simulation is correct, the agent does not need to know.

**A resource becomes ambient only through user or admin configuration. A gatekeeper must never assert its own ambience.** (cloudflare-os `AGENTS.md`, adopted verbatim as an invariant.)

**Never log secrets, prompts, headers, tokens, or request/response bodies.** (cloudflare-os `AGENTS.md`, adopted verbatim.)

---

## 2. What we are building on (verified facts)

This section is the factual foundation. Every claim here was checked on 2026-09-06; the implementing agent should re-check the **UNVERIFIED** rows in Phase 0.

### 2.1 Cloudflare OS: the concepts we port

| Normal OS | Cloudflare OS (verbatim from README) | OpenClaw OS (this plan) |
|---|---|---|
| kernel | `packages/workshop-backend` | OpenClaw Gateway (upstream, untouched) **+** `packages/clawos-kernel` plugin |
| device drivers | `packages/gatekeeper-*` | `packages/gatekeeper-*` OpenClaw plugins |
| shell | `packages/workshop-frontend` | OpenClaw Control UI / channels / TUI (untouched) **+** `clawos` CLI **+** `os.*` gateway methods |
| processes | gadgets | agent sessions and subagent runs (one OpenClaw agent = one long-lived process) |
| executables | blueprints | **Blueprints**: versioned agent templates (workspace files, skills, tool policy, sandbox profile, bindings) |
| users | users | operators (paired senders and devices) |
| ACLs | shared permissions | **grants** (capability records in the kernel store) |
| ??? | agents | agents |
| — | (n/a) | **Cells**: one Gateway per trust boundary, managed as a unit |

Gatekeeper responsibilities, in Cloudflare OS's own enumeration (`.agents/skills/write-gatekeeper/SKILL.md`), all of which we keep: (1) auth management, (2) capability-oriented API design, (3) fine-grained resource granting, (4) logging and approvals via an approval queue, (5) caching, (6) simulation of pending actions, (7) observer verification. Their three-tier hierarchy (Vendor → User → Instance) and their four observer strategies (A private-only, B ACL check, C data-set tracking, D low-stakes) are ported in §4.

Discovery in Cloudflare OS is a pure naming convention: the kernel scans its environment for bindings prefixed `GATEKEEPER_` and "installing a gatekeeper is purely a binding change." We port this as a manifest convention (§4.2) so that installing a gatekeeper is purely `openclaw plugins install`.

Their upgrade discipline (`cloudflare-os-starter/docs/customization.md`) is ported as our Phase 7: record the current pin for rollback → move the pin → review contract changes → re-sync shared dependency ranges → install, lint, check → deploy and verify → restore the previous pin if needed. "Do not update the submodule blindly."

### 2.2 OpenClaw: the extension surfaces we use

All rows **VERIFIED** unless marked.

| Surface | What it gives us | Key facts |
|---|---|---|
| **Plugins** (`openclaw.plugin.json` + `register(api)`) | Tools, hooks, HTTP routes, gateway RPC methods, CLI subcommands, background services | Manifest `contracts` declares ownership without loading code. `package.json` → `openclaw.compat.pluginApi` and `minGatewayVersion` are the sanctioned version-gating mechanism. All plugin APIs are declared experimental. |
| **Plugin hooks** (`api.on(name, handler, opts)`) | Gate/Modify/Claim/Observe points in the agent loop | `before_tool_call` (Modify/Gate; returns `{params?, block?, blockReason?, requireApproval?}`), `before_agent_run` (Gate), `before_prompt_build` (Modify; can narrow the turn's submitted tools in the ordinary phase, without `requiresToolAuthority`), `before_install` (Gate, fail-closed), `message_sending` (Modify/Gate), `before_message_write` (sync Modify/Gate), `after_tool_call`, `agent_end`, `llm_input/llm_output`, `gateway_start/stop`. Gate hooks default to a 15 s budget and **fail closed**. `matcher: [toolIds]` and `priority` supported. `api.registerHook` is a different, internal system — do not use it for these names. |
| **Trusted tool policy** | `api.registerTrustedToolPolicy()` runs before plugin policy | Privileged OS-level injection point. Manifest `contracts.trustedToolPolicies`. |
| **Config** (`~/.openclaw/openclaw.json`, JSON5) | Declarative policy | `tools.profile/allow/deny/byProvider/toolsBySender`, `plugins.deny` (authoritative), `agents.defaults.sandbox.{mode,scope,backend,workspaceAccess}`, `gateway.auth`, `update.channel`, `update.auto.enabled`. `$include` supports single file (replaces containing object) or array (deep-merged in order, later wins, ≤10 levels); include paths must resolve under the directory holding `openclaw.json` or under `OPENCLAW_INCLUDE_ROOTS`. `${VAR}` substitution in string values. Invalid external edits are rejected without rewriting the file. |
| **`openclaw config`** | Safe writes | `config patch --file/--stdin [--dry-run]`: objects merge recursively, arrays and scalars replace, `null` deletes; `config set` alone supports `--expect-current-json` / `--expect-current-absent`; the SDK transactional writer accepts `baseHash`. `config validate`, `config schema`. |
| **`openclaw doctor`** | CI gate | `--lint --json` is read-only, structured findings, exit 0 clean / 1 findings / 2 failure. |
| **Exec approvals** | Native synchronous approval for `exec` | `tools.exec.mode: deny|allowlist|ask|auto|full`; grants persisted per agent; approval events `exec.approval.requested/resolve`; CLI `openclaw approvals`, `openclaw exec-policy`. Reserved command namespaces for plugins: `config.*`, `exec.approvals.*`, `wizard.*`, `update.*`. |
| **State/paths** | Where things live | `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, `OPENCLAW_WORKSPACE_DIR`, `OPENCLAW_PROFILE` (→ `~/.openclaw-<profile>`), `OPENCLAW_GATEWAY_PORT`, `OPENCLAW_NO_AUTO_UPDATE`. Workspace files: `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `BOOT.md`, `MEMORY.md`, `memory/`, `skills/`. Per-agent store `~/.openclaw/agents/<agentId>/agent/`. Required perms: config `600`, state dir `700`. |
| **Service** | Daemon management | Linux: user unit `~/.config/systemd/user/openclaw-gateway[-<profile>].service`, created by `openclaw gateway install`; `openclaw gateway restart|stop|status`. macOS launchd via the same command. |
| **Health** | Supervisor probes | Unauthenticated `GET /healthz`, `/startupz`, `/readyz` on the gateway port (default `18789`). |
| **Update** | Version control | `openclaw update [--dry-run] [--channel stable\|extended-stable\|beta\|dev] [--tag <version>]`. Validates the new version while the current Gateway keeps serving, activates with verification, and performs automatic schema-neutral rollback on verification failure. `openclaw backup create --output <dir> --verify`. Versioning is `YYYY.M.PATCH`. |
| **Sandbox** | Containment | `agents.defaults.sandbox.mode: off|non-main|all`, `scope: agent|session|shared`, `backend: docker|podman|ssh|openshell`, `workspaceAccess: none|ro|rw`. Docker/Podman default to `network: none`. Not sandboxed: the Gateway process, native plugins, elevated tools. |
| **Multi-agent** | Process model | `agents.defaults.*`, `agents.entries.<id>.*`, bindings resolve most-specific-wins; never share `agentDir` between agents. Trust boundary = one Gateway; use separate Gateways (profiles/users/hosts) for mutually distrusting parties. |
| **Skills** | Instruction-level behavior | `SKILL.md` frontmatter (`name`, `description`, `user-invocable`, `command-dispatch`…); discovery order workspace → `~/.agents/skills` → state dir → bundled; snapshots taken at session start; agent skill allowlists replace defaults. `before_install` can vet staged skill/plugin material. |
| **Internal hooks** | Trusted in-process handlers without plugin packaging | `HOOK.md` + `handler.ts` in `<stateDir>/hooks/` or `hooks.internal.load.extraDirs`; events like `gateway:startup`, `agent:bootstrap`, `message:received`. |
| **Node** | Runtime | 22.22.3+, 24.15+, or 25.9+ per docs (npm `engines` says `>=22.12.0`; trust the docs). `node:sqlite` is available unflagged from Node 22.13 — **DECISION:** the kernel store uses `node:sqlite`, no native addon. |

Additional **VERIFIED** SDK facts used by the kernel: `api.registerTool` tools execute as `execute(toolCallId, params, signal?, onUpdate?)` — there is no per-call context argument (identity must be correlated through `before_tool_call`, see §5.2); `api.registerHttpRoute({ path, auth: "gateway"|"plugin", match: "exact"|"prefix", handler })`; `api.registerCli(({ program }) => …, { commands, descriptors?, parentPath? })`; `api.registerGatewayMethod(name, handler, { profileAccess: "required"|"independent" })`; `api.registerTrustedToolPolicy` runs before all `before_tool_call` hooks, accepts `matcher`, and is meant for host-level gates only; `openclaw gateway run` runs the Gateway in the foreground; `openclaw agents add <id> --workspace <dir> [--bind channel[:account]] [--model <id>] --non-interactive`; `openclaw message send --channel <c> --target <t> --message "<text>" [--json] [--dry-run]`; `openclaw security audit [--deep] [--fix] [--json]`; `openclaw uninstall [--service|--state|--workspace|--all] --yes --non-interactive`; `openclaw hooks install` is a deprecated alias of `openclaw plugins install`.

**Settled from the published `openclaw@2026.9.2` package** (types + bundled docs; see `docs/upstream-reference.md` §9): the managed plugin root is `~/.openclaw/extensions`; `$include` sibling keys override included values, and root/array includes fail closed for OpenClaw-owned writes (so the OS reconciles rather than includes — §6.2); hook `matcher` lists are explicit tool ids, wildcards invalid; `before_prompt_build` narrows via `toolsAllow`; `before_agent_run` events carry `senderIsOwner`; `registerCli` hands a commander `Command`; `security.installPolicy` is the primary install boundary (§7.5); backups cover the whole state directory including `os/`.

**S-1 question inventory (current answers and evidence in `plans/spike-S1.md`):** (c) allowed characters and max length for plugin tool names; (d) whether the `openclaw.plugin.json` manifest tolerates unknown top-level keys (the manifest page is titled "strict config validation" — plan for the sibling-file fallback); (e) whether `toolsAllow` removes tool schemas from the model request (confirm via `llm_input`); (f) whether `toolCallId` is always present on `before_tool_call` for plugin tools (every identity field is optional in the types — the kernel fails closed when absent); (g) which `GatewayClient` identity fields are populated for a paired operator; (h) a plugin opening its own SQLite under `OPENCLAW_STATE_DIR`; (i) whether tools can be registered after `register()`; (j) how a plugin enumerates loaded plugin manifests; (m) the stdin/stdout contract of a `security.installPolicy` command.

---

## 3. Architecture

### 3.1 Layer diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  L6  SHELL        Control UI · channels (WhatsApp/Telegram/Slack/…) · TUI    │
│                   clawos CLI · `openclaw os …` · os.* gateway RPC methods     │
├──────────────────────────────────────────────────────────────────────────────┤
│  L5  BLUEPRINTS   versioned agent templates → provisioned agents/sessions    │
├──────────────────────────────────────────────────────────────────────────────┤
│  L4  DRIVERS      gatekeeper-github · gatekeeper-google · gatekeeper-fs ·    │
│                   gatekeeper-mcp (wraps any MCP server) · gatekeeper-http …   │
│                   (each = one OpenClaw plugin built on gatekeeper-kit)        │
├──────────────────────────────────────────────────────────────────────────────┤
│  L3  KERNEL       clawos-kernel plugin: capability store (grants), gatekeeper │
│                   registry, policy pipeline (hooks), approval queue,          │
│                   simulation coordinator, audit log, os.* RPC, CLI            │
├──────────────────────────────────────────────────────────────────────────────┤
│  L2  UPSTREAM     openclaw@<pinned>  (Gateway, agents, tools, sandbox, UI)    │
│                   — read-only to us — extended only via plugins/config/hooks  │
├──────────────────────────────────────────────────────────────────────────────┤
│  L1  CELL         one Gateway per trust boundary: profile, state dir, port,  │
│                   systemd unit, config fragments, backups                     │
├──────────────────────────────────────────────────────────────────────────────┤
│  L0  HOST         Linux (systemd) or macOS · Node 22.22.3+ · Docker/Podman   │
│                   for sandboxes · clawos installer & supervisor scripts       │
└──────────────────────────────────────────────────────────────────────────────┘
```

Data flow for one agent turn, showing where the OS intervenes (all hook names are **VERIFIED** OpenClaw plugin hooks):

**2026-09-09 correction:** the pinned upstream builds the prompt before
`before_agent_run` (bundled `docs/plugins/hooks.md`, prompt lifecycle and
before-agent-run sections). The original reversed ordering was a plan error.
First-turn channel URL introduction remains **UNACCEPTED**. The authorized
correction moves admission to `reply_dispatch`, using the public command-owner
resolver on the host-finalized channel context, before prompt construction.
No sender-label-only fallback or upstream modification is permitted. See
[the concrete integration blocker](../plans/channel-ordering-blocker.md).

```
inbound message ─► [reply_dispatch: kernel] ── channel owner + configured operator;
                                             introduce current-message URLs
                ─► [before_prompt_build: kernel] ── narrow tools to existing grants;
                                                  inject grant table as context
                ─► [before_agent_run: kernel] ── cell policy, observer fallback,
                                                  turn-level veto (no URL grants)
                ─► model call
                ─► tool call ─► [before_tool_call: kernel, matcher gk_*]
                                  ├─ no grant for handle → block
                                  ├─ observation → gatekeeper authorizes, logs
                                  └─ action → gatekeeper submitAction():
                                       queued + simulated (or requireApproval
                                       if awaitDecision) → tool returns
                ─► [after_tool_call: kernel] ── audit
                ─► reply ─► [message_sending: kernel] ── egress/DLP policy
                ─► [agent_end: kernel] ── audit, drain auto-approvable actions
later, human:   clawos approvals list / apply / reject  (or /approve in chat)
                ─► kernel → gatekeeper.applyAction(id) | rejectAction(id)
```

### 3.2 Components

**`openclaw` (upstream, L2).** Installed globally from npm at a pinned version recorded in `clawos.lock.json`. The OS never writes inside its install root. Auto-update is disabled (`update.auto.enabled: false` and `OPENCLAW_NO_AUTO_UPDATE=1` in the service environment) because the OS owns the update lifecycle.

**`clawos-kernel` (L3).** A single OpenClaw plugin. It owns: the capability store (grants, introductions, pending requests), the gatekeeper registry (OS-owned catalog metadata plus lifecycle-owned live driver slots), the policy pipeline (hooks listed above), the approval queue and simulation coordinator (the counterpart of Cloudflare OS's `ApprovalQueue` + `AutoApprovalDrainer`), the audit log, the `os.*` gateway RPC methods, and the `openclaw os …` CLI subcommands. It is the only OS component that makes security decisions.

**`clawos-shared` (L3, library).** TypeScript contracts: `Gatekeeper`, `GatekeeperVendor`, `GatekeeperAccount`, `Session`, `ApprovalQueue`, `ObservationDescription`, `ActionDescription`, `ActionKind`, `SupportedResource`, `Grant`. The kernel and every gatekeeper depend on it; it depends on nothing but TypeBox.

**`gatekeeper-kit` (L4, library).** The security-critical boilerplate that "a new gatekeeper author is most likely to get subtly wrong" (cloudflare-os `plans/gatekeeper-kit.md`): OAuth nonce lifecycle and token refresh coalescing, the cache-overlay simulation store, action id sequencing, observer admission helpers, and a `defineGatekeeper()` builder that turns a gatekeeper definition into an OpenClaw plugin entry with correctly namespaced tools and HTTP routes.

**`gatekeeper-*` (L4).** One OpenClaw plugin per external service. v1 ships four: `gatekeeper-github` (reference implementation, mirrors cloudflare-os's), `gatekeeper-fs` (scoped directories on the host — the OpenClaw equivalent of a file capability), `gatekeeper-mcp` (wraps any MCP server behind the gatekeeper model, mirroring cloudflare-os `gatekeeper-mcp`), and `gatekeeper-http` (a generic REST/OpenAPI gatekeeper for services without a dedicated driver). Google, Slack, Notion, Linear, Home Assistant follow in v1.1.

**`clawos-blueprints` (L5).** A directory of versioned blueprint packages (`blueprint.json` + workspace files + skills + policy fragment). `clawos blueprint apply <name> --agent <id>` provisions an agent via `openclaw agents add` and `openclaw config patch`.

**`clawos-cli` (L6).** An npm package with a `clawos` binary. It is a thin host-side orchestrator: it shells out to `openclaw` for anything OpenClaw already does, talks to the kernel over the Gateway WebSocket (`os.*` methods) for capability operations, and owns host-only concerns (install, cells, update, rollback, backups). The same commands are also mounted as `openclaw os <cmd>` via `api.registerCli` so users who live in the `openclaw` CLI never need a second binary.

**`clawos-conformance` (tooling).** The test suite that decides whether a given upstream version is compatible with the OS. It runs the kernel and reference gatekeeper against a real Gateway, exercising every hook and RPC the OS depends on. It is what makes INVARIANT 2 enforceable.

### 3.3 Filesystem layout (per cell)

All OS state lives under `<stateDir>/os/`, where `<stateDir>` is `~/.openclaw` for the default cell or `~/.openclaw-<profile>` for a named cell (upstream's `OPENCLAW_PROFILE` convention, **VERIFIED**). This keeps OS state inside upstream's backup scope (`openclaw backup create` — confirm in S-1 that it includes unknown subdirectories; if not, `clawos backup` archives `os/` separately).

```
~/.openclaw/                          # upstream state dir (cell "default")
├── openclaw.json                     # upstream config; OS reconciles into it (600)
├── workspace/                        # default agent workspace (upstream)
├── agents/<agentId>/agent/           # per-agent stores (upstream)
├── state/openclaw.sqlite             # upstream DB — never opened by the OS
├── hooks/                            # internal hooks (upstream dir; OS may drop
│                                     #   HOOK.md bundles here — see §5.6)
└── os/                               # ─── OS-owned, upstream never touches ───
    ├── clawos.lock.json              # pinned upstream version, plugin versions,
    │                                 #   last-known-good, install fingerprint
    ├── config.d/                     # desired-state config fragments (JSON5)
    │   ├── 00-baseline.json5         #   hardened gateway/tools baseline
    │   ├── 10-plugins.json5          #   plugins.entries for kernel+gatekeepers
    │   ├── 20-sandbox.json5          #   agents.defaults.sandbox profile
    │   ├── 30-agents.json5           #   blueprint-provisioned agents
    │   └── 90-local.json5            #   operator overrides (last wins)
    ├── config.generated.json         # last merged fragment set (for diff)
    ├── clawos.sqlite                 # kernel store: grants, actions, audit index
    ├── audit/YYYY-MM-DD.jsonl        # append-only audit log
    ├── gatekeepers/<vendor>/         # per-gatekeeper private state
    │   ├── accounts/                 #   encrypted tokens (see §7.4)
    │   └── cache/                    #   simulation cache / overlay
    ├── blueprints/                   # applied blueprint snapshots
    ├── backups/                      # OS-authored tars only; see the correction under §3.3
    └── logs/                         # OS logs (never contain secrets)
```

**CORRECTION 2026-09-07 (Phase 1).** `os/backups/` cannot be the output directory for `openclaw backup create`.
Upstream rejects output paths inside the source state or workspace tree to avoid self-inclusion, and `os/` is
inside the state directory. Archives therefore live at `~/.clawos/backups/<cell>/`, alongside the host-level cell
registry. `os/backups/` remains only for tars the OS writes itself.

A second constraint shapes `clawos backup restore`: upstream restore is **never in place**. It requires a fresh
empty target, has no `--force`, and leaves activation to the operator. `clawos backup restore` therefore performs
upstream's documented activation sequence — verify, extract to a staging directory outside the state tree, stop
the unit, move the current state aside (never delete it), move the extracted state asset into place using the
manifest's `assets[]` entry of kind `state`, run `doctor`, restart, and confirm `/readyz`. The displaced state is
kept at `<stateDir>.pre-restore-<ts>`, so a failed restore is always recoverable.

Environment for a named cell (written into its systemd unit by `clawos cell create`):

```
OPENCLAW_PROFILE=<name>           # → ~/.openclaw-<name>
OPENCLAW_GATEWAY_PORT=<port>      # unique per cell
OPENCLAW_NO_AUTO_UPDATE=1
CLAWOS_CELL=<name>
```

### 3.4 Naming and namespaces (DECISION)

| Thing | Convention | Why |
|---|---|---|
| Kernel plugin id | `clawos-kernel` | — |
| Gatekeeper plugin id | `gatekeeper-<vendor>` | Mirrors cloudflare-os package naming; the kernel discovers gatekeepers by this prefix **and** the manifest marker below. |
| Gatekeeper manifest marker | `openclaw.plugin.json` → `"clawos": { "gatekeeper": { "vendor": "<vendor>", "apiVersion": 1 } }` | Extra top-level keys in the manifest are the portable analogue of the `GATEKEEPER_` binding prefix. (**VERIFIED** for the S-1 probe on 2026.9.2: unknown `clawos` metadata permits actual load/RPC; `plugins validate` is an authoring-metadata validator, not an ordinary-plugin validator.) |
| Gatekeeper tool names | `gk_<vendor>_<resource>_<verb>` e.g. `gk_github_repo_list_issues`; entire name ≤64 ASCII characters, lowercase letters/digits/underscores only | Kernel matcher lists explicit `gk_*` tool IDs; unambiguous audit. Provider-documentation intersection, not an upstream registration limit; reject overlong/invalid names instead of truncating. |
| Kernel tools (agent-facing) | `os_request_access`, `os_list_grants` | The only two tools the kernel exposes to models. |
| Gateway RPC methods | `os.grants.*`, `os.approvals.*`, `os.gatekeepers.*`, `os.audit.*`, `os.status` | Avoids reserved `config.*`, `exec.approvals.*`, `wizard.*`, `update.*`. |
| CLI | `clawos <group> <cmd>` and `openclaw os <group> <cmd>` | Same code path. |
| HTTP routes | `/os/gatekeeper/<vendor>/oauth/…`, `/os/approvals` | Registered via `api.registerHttpRoute`. |
| Grant handle (agent-visible) | `grant:<8-char base32>` | Opaque; never encodes the resource. |
| Action id | integer, per-gatekeeper monotonic | Same as cloudflare-os `submitAction(action: number)`. |
| Config fragment ownership | `os/config.d/NN-<name>.json5` | Numeric prefix = merge order. |

---

## 4. The Gatekeeper model for OpenClaw

### 4.1 Responsibilities (ported 1:1)

1. **Auth management** — obtain and hold credentials on behalf of the human operator (OAuth via `registerHttpRoute`, or a SecretRef to an env/file/exec secret for API keys). Tokens live in the gatekeeper's `accounts/` store, encrypted at rest (§7.4). Credentials are *never* passed to the model, never appear in tool results, and never appear in logs.
2. **API design** — capability-oriented tools: each tool takes a `grant` handle that denotes a *specific* resource (a repo, a document, a directory), not a coarse "vendor" tool that takes raw ids. "A Jira gatekeeper might support 'whole service', 'project', and 'issue' granularities, but it would be silly to support granting access to a single field of an issue separately."
3. **Fine-grained resource granting** — the gatekeeper publishes `SupportedResource[]`, each with a `URLPattern` string, a title, and a granularity. Pasting a matching URL is the introduction.
4. **Logging and approvals** — every read goes through `authorizeObservation()` before data is returned; every write goes through `submitAction()` and is not performed until `applyAction()`.
5. **Caching** — per-resource cache in the gatekeeper's `cache/` store, which also lets the gatekeeper present a cleaner shape than the vendor's raw API.
6. **Simulation** — pending actions are reflected in subsequent reads as if applied.
7. **Observer verification** — when a session has an audience beyond its owner (group chats, shared sessions), the gatekeeper must confirm each observer may see what has been read (§4.7).

### 4.2 Registration and discovery

A gatekeeper is an ordinary OpenClaw plugin whose manifest carries the `clawos.gatekeeper` marker. S-1 selects the OS-owned catalog fallback: the kernel reads configured, canonical package roots from `os/gatekeepers.json`, validates each manifest's plugin id/vendor/API version, and registers cached tool shapes synchronously (§5.1). A manifest on disk is metadata, **not** proof of a loaded driver.

Live attachment uses the public `openclaw/plugin-sdk/runtime-store` object-form store keyed by plugin id. A gatekeeper's `registerService().start()` publishes its driver together with cell/root/API-version identity; `stop()` revokes retained handles and clears only its own current slot. The kernel resolves that live slot at use time and fails closed before startup, after stop, for disabled/missing entries, or for cell/root/version mismatch. Do not rely on service ordering or retain a stale driver across replacement. Discovery modes declare inert capabilities but never publish a driver. Kernel integration and its negative conformance remain Phase 3 work; S-1 tests the transport with a no-tool/no-session fixture.

**Correction to the scaffold:** no documented startup manifest enumerator has been verified, and a network RPC cannot carry a live JavaScript vendor object or establish in-process provenance merely by omitting client fields. The guessed `api.runtime` accessor and RPC-only attachment fallback are removed; no upstream registry is mutated. The named SDK slot is transport between trusted native plugins, **not an authentication boundary** against malicious in-process code. Install policy and `resolveGrant()` remain required. Source: pinned SDK `runtime-store.d.ts`, `docs/plugins/sdk-runtime.md` (Storing runtime references / Gateway service events); acceptance evidence is recorded in S-1.

Installing a gatekeeper is therefore purely:

```bash
openclaw plugins install npm:@clawos/gatekeeper-github@1.2.0 --pin --accept-capabilities
openclaw config patch --stdin <<'EOF'
{ plugins: { entries: { "gatekeeper-github": { enabled: true, config: { clientId: "${GITHUB_OAUTH_CLIENT_ID}" } } } } }
EOF
openclaw gateway restart      # plugin metadata snapshot is immutable per session (VERIFIED)
```

`clawos gatekeeper add github` wraps exactly those three steps plus the secret prompt.

The kernel's enforcement chokepoint (the analogue of `getGatekeeperClassFor()` in cloudflare-os `user.ts`): **`Kernel.resolveGrant(agentId, sessionKey, handle)`** is the single function that turns a handle into a live gatekeeper session. Every path that lets an agent reach a gatekeeper goes through it. **INVARIANT:** no code path may mint or use a gatekeeper session without `resolveGrant`; reviewers flag any new one.

### 4.3 Contracts (`packages/clawos-shared/src/gatekeeper.ts`)

These are the TypeScript contracts, adapted from `cloudflare-os/packages/workshop-shared/src/gatekeeper.ts` for a single-process, tool-calling runtime. Doc-comment every exported member (cloudflare-os `REVIEW.md` rule).

```typescript
import type { TSchema } from "typebox";

/** A resource type this gatekeeper can grant, keyed by URL pattern. */
export interface SupportedResource {
  /** URLPattern string, e.g. "https://github.com/:owner/:repo". */
  urlPattern: string;
  /** Stable id for this resource type within the vendor, e.g. "repo". */
  type: string;
  title: string;
  description: string;
  /** If true, this type can be granted independently (scopes requested only for enabled types). */
  grantable: boolean;
  /** Observer strategy for bindings of this type (see §4.7). */
  observerStrategy: "private-only" | "acl-check" | "dataset-tracking" | "low-stakes";
  /** Tools (by name) available for a grant of this type. */
  tools: string[];
}

/** Human-readable description of a read. Everything needed to decide, display, and audit. */
export interface ObservationDescription {
  title: string;
  /** Markdown. Must include every detail relevant to approval. */
  description: string;
  /** Blunt stopgap: block if the session is shared, and put the session into lockdown (observations only). */
  prohibitAllSharing?: boolean;
  /** Observers who must not see this data; the kernel blocks the observation if any is still present. */
  excludeObservers?: string[];
}

/** Stable policy key; auto-approval rules match on `tag`. Treat as an enum. */
export interface ActionKind { tag: string; label: string; }

export interface ActionDescription {
  title: string;
  description: string;
  actionKind?: ActionKind;
  /** Gatekeeper author's verdict that this specific action is safe to auto-apply if the user opted in for its kind. */
  autoApprovable?: boolean;
  /** True if the gatekeeper implements revertAction() for this action. */
  implementsRevert: boolean;
  /** If true, do NOT simulate: block the tool call until the human decides (maps to OpenClaw requireApproval). */
  awaitDecision?: boolean;
  /** Free-form structured payload for the approval UI (never includes secrets). */
  preview?: unknown;
}

/** Handed to a gatekeeper session by the kernel. The gatekeeper never constructs one. */
export interface ApprovalQueue {
  /** Must be awaited before returning any data to the agent. Throws to deny. */
  authorizeObservation(d: ObservationDescription): Promise<void>;
  /** Fully asynchronous: returns as soon as the action is recorded. The human may decide days later. */
  submitAction(actionId: number, d: ActionDescription): Promise<void>;
}

/** One live binding of (grant → gatekeeper resource) inside one agent session. */
export interface GatekeeperSession {
  /** Execute a tool of this resource type. `params` were validated against the tool schema by OpenClaw. */
  call(tool: string, params: Record<string, unknown>, ctx: SessionCallContext): Promise<ToolResult>;
  close(): Promise<void>;
}

export interface SessionCallContext {
  agentId: string; sessionKey: string; runId?: string; toolCallId?: string;
  queue: ApprovalQueue;
  /** Present when the session has observers beyond its owner. */
  observers?: string[];
}

/** Per-resource instance. Created by the kernel through resolveGrant(). */
export interface Gatekeeper {
  describe(): Promise<{ resource: SupportedResource; title: string; suggestedName: string }>;
  getAutoApprovableActions(): Promise<ActionKind[]>;
  startSession(queue: ApprovalQueue): Promise<GatekeeperSession>;
  /** Perform a previously submitted action for real. Idempotent. */
  applyAction(actionId: number): Promise<void>;
  /** Discard a pending action and its simulated effects. */
  rejectAction(actionId: number): Promise<void | { restart?: boolean }>;
  /** Undo an applied action if implementsRevert. */
  revertAction?(actionId: number): Promise<void | { message?: string; canRetry?: boolean }>;
  /** Throw if this observer may not see everything this instance has read. */
  addObserver(id: string, verifier: ObserverVerifier): Promise<void>;
  removeObserver(id: string): Promise<void>;
}

/** Per-operator account (one OAuth identity). */
export interface GatekeeperAccount {
  describe(): Promise<{ email?: string; displayName?: string; expiresAt?: number }>;
  getSupportedResources(): Promise<SupportedResource[]>;
  /** Returns a Gatekeeper for the resource a URL denotes, with credentials bound. Called BEFORE any grant exists. */
  getGatekeeperFor(url: string): Promise<{ gatekeeper: Gatekeeper; resource: SupportedResource; resourceKey: string }>;
  /** Mint an opaque verifier that proves *this account's* access, for observer checks. */
  getVerifier(): Promise<ObserverVerifier>;
  revoke(): Promise<void>;
  reconnect(): Promise<{ url: string }>;
}

/** Top-level vendor entry. One per gatekeeper plugin. */
export interface GatekeeperVendor {
  vendor: string; apiVersion: 1;
  describe(): Promise<{ title: string; description: string; icon?: string; autoProvisionsAccount?: boolean }>;
  /** Start OAuth (or equivalent). Returned URL must embed a cryptographic nonce. */
  connectAccount(operatorId: string, opts?: { resourceTypes?: string[] }): Promise<{ url: string }>;
  /** For vendors that need no user auth (fs, mcp with static config). */
  createAccount?(operatorId: string): Promise<GatekeeperAccount>;
  getAccount(operatorId: string): Promise<GatekeeperAccount | null>;
  getSupportedResources(): Promise<SupportedResource[]>;
  /** Tool definitions (TypeBox schemas) for every tool this vendor exposes; the kernel registers them. */
  getTools(): Promise<GatekeeperToolDef[]>;
}

export interface GatekeeperToolDef {
  name: string;                 // gk_<vendor>_<resource>_<verb>
  resourceType: string;         // which SupportedResource.type it belongs to
  kind: "observation" | "action";
  description: string;          // NEVER mentions approvals/caching/OAuth
  parameters: TSchema;          // must include `grant: Type.String()`
  outputSchema?: TSchema;
}

/** Opaque to everyone but the gatekeeper that minted it. */
export interface ObserverVerifier { readonly vendor: string; readonly opaque: string; }
export interface ToolResult { content: Array<{ type: "text"; text: string }>; details?: unknown; }
```

An important adaptation: in Cloudflare OS the agent gets a TypeScript API and writes code against it (Code Mode). OpenClaw agents primarily call tools, so gatekeepers expose **tools whose first parameter is a grant handle** (DECISION). The kernel, not the gatekeeper, registers these tools with OpenClaw (`api.registerTool`) so that every call is funneled through `before_tool_call` → `resolveGrant` → `GatekeeperSession.call`. A gatekeeper cannot accidentally expose an unguarded tool because it never calls `registerTool` itself — `defineGatekeeper()` in the kit forbids it. Code-mode support (a generated `.d.ts` per grant, mirroring `getTypeScriptTypes()`) is deferred to v1.1 and only enabled when OpenClaw's `code_execution` tool is on.

### 4.4 Grants and introductions (the capability model)

A **grant** is a kernel record:

```
grant {
  handle: "grant:7k3m9q2p",  agentId, cellId,
  vendor: "github", resourceType: "repo", resourceKey: "owner/repo",
  operatorId,                       // whose account backs it
  scope: "agent" | "session:<key>", // where the handle is valid
  audience: "owner-only" | "shared",// whether it may be used in sessions with observers
  status: "pending" | "active" | "revoked" | "lockdown",
  createdAt, createdBy: "operator" | "agent-request", expiresAt?
}
```

Introductions happen in three ways, all creating a `pending` grant that only an operator can activate:

1. **Operator pastes a URL** in a channel the agent is bound to. The candidate kernel extracts current-message URLs at `reply_dispatch`, using the public `command-auth` owner resolver on finalized ingress plus its configured channel/sender operator match. Gateway-scoped, internal, provenance-bearing, missing-identity, and ambiguous-agent turns cannot introduce resources. The late `before_agent_run` gate no longer introduces URLs. **Acceptance pending:** prove first-request tools and notice through real public-SDK dispatch, followed by dedicated Telegram transport testing; unit mocks and RPC introductions do not establish channel acceptance. The earlier implementation incorrectly assumed that `before_agent_run` preceded prompt construction.
2. **Operator runs** `clawos grant add --agent ops https://github.com/owner/repo` (→ `os.grants.introduce`).
3. **The agent requests access** with the kernel tool `os_request_access({ url, reason })`. The kernel records a `pending` grant, notifies operators (via `openclaw message` on the cell's notification channel, and in `clawos approvals list`), and returns "Access requested; you will be told when it is granted." The agent is never blocked waiting.

Revocation (`clawos grant revoke <handle>`) closes live sessions, and the next `before_prompt_build` removes the tools.

The **grant table** the agent sees (injected by `before_prompt_build`, bounded to 100 rows / 8 KB — the cloudflare-os `AGENT_CATALOG` bounding rule) contains only handle, vendor, resource *type*, and a short title the operator chose; never the raw resource identifier unless the operator marked it visible. Suggested names reflect the type (`GITHUB_REPO`), "since the coding agent will be able to see the name and the user may or may not intend to reveal the resource title."

### 4.5 Approval queue: deferred approval and simulation

This is the heart of the port. The kernel implements `ApprovalQueue` and passes one to every gatekeeper session.

**Observations.** `authorizeObservation(d)` runs the policy pipeline synchronously (it must be fast — it is inside a tool call): it checks the grant is `active`, not in `lockdown`; if the session has observers and `d.prohibitAllSharing` or `d.excludeObservers` intersects them, it throws (and, for `prohibitAllSharing`, moves the grant to `lockdown` — "the gadget goes into lockdown mode where it can no longer perform any actions, only make observations"). Then it appends an `observation` audit record and returns. The gatekeeper may call it *after* fetching but must await it *before* returning anything (cloudflare-os rule).

**Actions.** `submitAction(id, d)` records `{gatekeeperInstance, actionId, description, status: "pending"}` in `clawos.sqlite`, appends an audit record, and returns immediately. The gatekeeper then applies the action to its **simulation overlay** and returns a success result to the agent as if the action had happened. Two implementation strategies are offered by `gatekeeper-kit` and the author chooses per resource type: *mutate-the-cache* (apply to cached data on submit; invalidate/rebuild on reject; re-apply queued actions whenever the cache refreshes) or *overlay-at-read* (store pending actions separately and merge at read time — "cleaner separation"). The kit's default is overlay-at-read.

**When simulation is not implemented** for an action, the gatekeeper sets `awaitDecision: true`. The kernel then translates this into OpenClaw's native synchronous approval by returning `requireApproval` from `before_tool_call` (**VERIFIED** shape: `{ title, description, severity, timeoutMs, allowedDecisions: ["allow-once","allow-always","deny"], onResolution }`). This is the escape hatch, not the norm, because "an agent that keeps going would observe a world where its action 'didn't happen' — and tends to get confused."

Note the ordering subtlety: `before_tool_call` runs *before* the tool executes, but whether an action needs `awaitDecision` is only known inside the gatekeeper. The kernel resolves this by doing a **dry pass**: in `before_tool_call` it calls `session.call(tool, params, { dryRun: true })`, which returns the `ActionDescription` without side effects; if `awaitDecision`, the kernel returns `requireApproval` and, on `allow-*`, lets the real call proceed with the decision pre-recorded. Every action tool in the kit is therefore written as `describe(params) → ActionDescription` plus `apply(params)`, and the kit enforces the split.

**Decisions.** `os.approvals.list` returns pending actions per gatekeeper instance with their descriptions and previews. `os.approvals.apply(ids)` calls `gatekeeper.applyAction(id)` in id order; on success the record becomes `applied` and the overlay entry is retired. `os.approvals.reject(ids)` calls `rejectAction` and removes the simulated effect; if the gatekeeper reports `{restart: true}`, the kernel resets the affected session (via the session RPC upstream exposes — **UNVERIFIED** method name, S-1; fallback: inject a next-turn note through `api.session.workflow.enqueueNextTurnInjection()` telling the agent the action was rejected).

**Auto-approval.** An action is auto-applied only when *both* the operator has a rule for its `actionKind.tag` (`os/config.d/…` → `clawos.autoApprove: ["github.issue.comment"]`) *and* the gatekeeper marked that specific action `autoApprovable: true`. The `AutoApprovalDrainer` runs on `agent_end` and on a 30 s timer: per gatekeeper instance, it applies eligible pending actions in id order, single-flight, stopping at the first non-eligible action (so ordering is preserved).

**Surfaces for the human.** `clawos approvals` (CLI/TUI table), a chat command `/approvals` claimed by authenticated `reply_dispatch` (so it never reaches the model; the pinned `before_agent_reply` context has no trusted owner/audience facts, so it only denies command fallthrough), and the OpenClaw Control UI via a `registerControlUiDescriptor()` panel in v1.1.

### 4.6 Authoring a gatekeeper (the `write-gatekeeper` skill, ported)

The repository ships `.agents/skills/write-gatekeeper/SKILL.md` with this procedure, which any agent adding a driver must follow:

**Phase 1 — responsibilities 1–3.**
1. Understand the external service: auth model, resource types and *meaningful* granularities, which operations are observations vs. actions, which actions are reversible.
2. Design the tool surface in `src/tools.ts`: one small group of tools per resource type; every tool takes `grant`; structured inputs and outputs, not raw API payloads; simplify for the common case. Decide which URL patterns `getGatekeeperFor()` matches.
3. **STOP. Present the tool surface for operator review. Do not proceed without approval** — "the API is the most important and delicate part of a gatekeeper; getting it wrong means rebuilding."
4. Implement from `packages/gatekeeper-kit/SKELETON.md` (vendor, account store, OAuth routes with two-stage nonce, per-resource gatekeeper, session).
5. Register: `openclaw.plugin.json` with the `clawos.gatekeeper` marker; `package.json` with `openclaw.compat`; add to `config/gatekeepers.json` catalog.
6. **STOP. Ask the operator whether to proceed to Phase 2.**

**Phase 2 — responsibilities 4–7.**
7. Approvals: wrap *every* outside-world interaction in `authorizeObservation` / `submitAction`. "Otherwise the gatekeeper security model is broken."
8. Caching, then simulation (choose strategy per resource type), then observer strategy (§4.7).
9. Conformance: run `pnpm conformance --gatekeeper <vendor>`; it fails if any tool lacks a queue call, any description mentions approvals/OAuth/caching, or any action lacks `implementsRevert` declaration.

Package structure:

```
packages/gatekeeper-<vendor>/
├── openclaw.plugin.json     # id gatekeeper-<vendor>, contracts.tools, clawos.gatekeeper marker
├── package.json             # openclaw.extensions, openclaw.compat, peerDependencies.openclaw
├── src/
│   ├── index.ts             # export default defineGatekeeper({...})  (kit)
│   ├── vendor.ts            # GatekeeperVendor: describe, connectAccount, resources
│   ├── account.ts           # token store, refresh, getGatekeeperFor
│   ├── <resource>.ts        # one Gatekeeper impl per resource type
│   ├── tools.ts             # GatekeeperToolDef[] (TypeBox)
│   ├── simulate.ts          # overlay rules per action kind
│   └── api.ts               # thin wrapper over the vendor HTTP API
├── deploy-inputs.json       # wizard inputs: which secrets, console URL, redirect URI template
├── README.md
└── test/                    # kit-provided harness
```

### 4.7 Observer verification (v1.1, designed now)

In Cloudflare OS an "observer" is a collaborator who can see a gadget's output. In OpenClaw the analogous situation is a **session with an audience**: a group chat, a shared thread, or a session with `tools.sessions.visibility` wider than `self`. The invariant, ported verbatim: *if an agent session can read information that has restricted access, then any participant who cannot read that information must be prevented from interacting with the session, to prevent data leaks.*

Mechanism: when a session gains an observer (kernel detects `ctx.chatId` is a group, or a new sender appears), the kernel asks each gatekeeper instance bound to that session to `addObserver(id, verifier)`, where the verifier was minted by *the observer's own* connected account (`account.getVerifier()`). The gatekeeper throws if the observer cannot see everything read so far. On a throw, the kernel either rejects the observer's message (for channels where it can) or moves the grant to `lockdown`.

Strategies, chosen per resource type: **A private-only** (always throw — a mailbox), **B ACL check** (one atomic resource; check the observer's access to it — a repo, a doc), **C dataset tracking** (binding spans sub-resources with distinct ACLs and there is a per-observer oracle; log observed data sets, re-check all observers when a new set is first touched, set `excludeObservers` on failure), **D low-stakes** (no-op). Rule: "use C only when both (1) the binding spans sub-resources with distinct ACLs and (2) there's a per-observer oracle. If one ACL covers everything → B. If there's no oracle → A or D." v1 ships with every grant `audience: "owner-only"` (i.e. strategy A enforced by the kernel for all vendors: gatekeeper tools are simply not offered in sessions with observers), and v1.1 turns on B/C/D per vendor.

### 4.8 Audit log

Every observation, action submission, decision, grant change, and gatekeeper auth event is appended to `os/audit/YYYY-MM-DD.jsonl` (one JSON object per line, `{ts, cell, agentId, sessionKey, kind, vendor, resourceType, handle, actionId?, title, decision?, by?}`) and indexed in `clawos.sqlite` for `clawos audit` queries. Titles and descriptions are included; request/response bodies, tokens, headers, prompts, and raw error strings from vendors are not (a vendor error can echo a caller-supplied value — log only numeric codes, per cloudflare-os `gatekeeper-cloudflare`). `after_tool_call` supplies duration and success/failure; `llm_input`/`llm_output` are *not* logged by default (opt-in `clawos.audit.llm: true` writes token counts only).

---

## 5. Kernel design (`packages/clawos-kernel`)

### 5.1 Plugin skeleton

This is the corrected design sketch, not a claim that the kernel scaffold below
`packages/clawos-kernel/src/` implements these contracts. Phase 0 changes exercise
the throwaway probe; kernel runtime integration and negative authorization
conformance belong to Phase 3. The source scaffold still requires the registration
mode, prompt-phase, and shared-state corrections verified by S-1.

```jsonc
// packages/clawos-kernel/openclaw.plugin.json
{
  "id": "clawos-kernel",
  "name": "OpenClaw OS Kernel",
  "description": "Capability model, gatekeeper registry, approval queue, and audit for OpenClaw OS.",
  "contracts": {
    "tools": ["os_request_access", "os_list_grants"],
    "trustedToolPolicies": ["clawos-capability-policy"],
    "gatewayMethodDispatch": ["os.status", "os.grants.list", "os.grants.introduce", "os.grants.revoke",
      "os.approvals.list", "os.approvals.apply", "os.approvals.reject", "os.approvals.revert",
      "os.gatekeepers.list", "os.gatekeepers.connect", "os.audit.query"]
  },
  "activation": { "onStartup": true },
  "configSchema": { "$ref": "./config.schema.json" },
  "clawos": { "kernel": true, "apiVersion": 1 }
}
```

```jsonc
// packages/clawos-kernel/package.json (relevant part)
{
  "name": "@clawos/kernel",
  "version": "1.0.0",
  "type": "module",
  "peerDependencies": { "openclaw": ">=2026.9.2 <2026.11.0" },
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "compat": { "pluginApi": ">=2026.9.2 <2026.11.0", "minGatewayVersion": "2026.9.2" },
    "build": { "openclawVersion": "2026.9.2", "pluginSdkVersion": "2026.9.2" }
  }
}
```

The `compat` range is deliberately narrow (two minor months). Widening it is a conscious act performed by the update pipeline after the conformance suite passes (§6.4).

```typescript
// packages/clawos-kernel/src/index.ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import { Kernel } from "./kernel.js";

export default definePluginEntry({
  id: "clawos-kernel",
  name: "OpenClaw OS Kernel",
  description: "Capability model, gatekeeper registry, approval queue, and audit for OpenClaw OS.",
  configSchema: () => import("./config-schema.js").then(m => m.schema),
  register(api) {
    if (!["full", "discovery", "tool-discovery"].includes(api.registrationMode)) return;
    // Design requirement: constructor is inert; no DB/client/service startup here.
    // Hook/tool facades resolve the same process-local runtime via the object-form
    // createPluginRuntimeStore({ pluginId: "clawos-kernel", errorMessage: ... }).
    const kernel = new Kernel(api);

    // --- capability policy (runs before plugin policy)
    api.registerTrustedToolPolicy(kernel.capabilityPolicy());   // hides gk_* tools without active grants

    // --- policy pipeline
    api.on("before_agent_run",   (e, ctx) => kernel.onBeforeAgentRun(e, ctx),   { priority: 1000 });
    api.on("before_prompt_build",(e, ctx) => kernel.onBeforePromptBuild(e, ctx),{ priority: 1000 });
    api.on("before_tool_call",   (e, ctx) => kernel.onBeforeToolCall(e, ctx),   { priority: 1000, timeoutMs: 10_000 });   // matcher = explicit tool ids only (no wildcards, VERIFIED) → filter by name inside
    api.on("after_tool_call",    (e, ctx) => kernel.onAfterToolCall(e, ctx));
    api.on("before_agent_reply", (e, ctx) => kernel.onBeforeAgentReply(e, ctx)); // denies untrusted command fallthrough; authenticated reply_dispatch claims commands
    api.on("message_sending",    (e, ctx) => kernel.onMessageSending(e, ctx));   // egress policy (DLP rules)
    api.on("before_install",     (e)      => kernel.onBeforeInstall(e));         // supply-chain allowlist
    api.on("agent_end",          (e, ctx) => kernel.onAgentEnd(e, ctx));         // audit + drain auto-approvals
    api.on("session_end",        (e, ctx) => kernel.onSessionEnd(e, ctx));       // close gatekeeper sessions

    // --- agent-facing tools (the only two the kernel exposes)
    // VERIFIED execute signature: execute(toolCallId, params, signal?, onUpdate?) — there is NO per-call
    // context argument. Agent/session identity for a call comes from the before_tool_call stash keyed by
    // toolCallId (see §5.2). If a call arrives with no stash entry, the tool fails closed.
    api.registerTool({ name: "os_request_access", description: "Ask the operator for access to a resource by URL.",
      parameters: Type.Object({ url: Type.String(), reason: Type.String() }),
      execute: (toolCallId, p) => kernel.requestAccess(toolCallId, p) });
    api.registerTool({ name: "os_list_grants", description: "List the resources you currently have access to.",
      parameters: Type.Object({}), execute: (toolCallId) => kernel.listGrantsForCall(toolCallId) });

    // --- gatekeeper tools are registered BY THE KERNEL on behalf of each gatekeeper (see §4.3)
    kernel.registerGatekeeperTools(api);

    if (api.registrationMode !== "full") return;
    // --- lifecycle (full only)
    api.on("gateway_start", () => kernel.start());        // publish shared runtime, open store, start drainer
    api.on("gateway_stop",  () => kernel.stop());         // flush, close, clear shared runtime

    // --- operator surfaces
    for (const [name, handler] of kernel.gatewayMethods())
      api.registerGatewayMethod(name, handler, { profileAccess: "required" });   // VERIFIED opt
    api.registerHttpRoute({ path: "/os/gatekeeper/", match: "prefix", auth: "plugin",   // VERIFIED fields
      handler: (req, res) => kernel.oauthRouter(req, res) });                          // returns true when handled
    api.registerCli(({ program }) => kernel.mountCli(program), { commands: ["os"] });  // VERIFIED shape
    api.registerService({ id: "clawos-drainer", start: (ctx) => kernel.startDrainer(ctx), stop: () => kernel.stopDrainer() });
  },
});
```

Notes on the verified SDK shapes used above: `registerHttpRoute` takes `path`, `auth: "gateway" | "plugin"`, `match: "exact" | "prefix"`, optional `handleUpgrade`/`replaceExisting`, and a `handler(req, res)` that returns `true` when it handled the request; OAuth callbacks arrive unauthenticated from the browser, so the route uses `auth: "plugin"` and the kernel validates the nonce itself. `registerCli`'s registrar receives `{ program }` (the command object to configure) and `opts` may carry `commands`, `descriptors`, and `parentPath`. `registerGatewayMethod` opts include `profileAccess: "required" | "independent"`. `registerService` receives a `ctx` with a process-local `gatewayEvents` facade when a broadcaster is present.

**VERIFIED for the S-1 test path on 2026-09-07:** a `gateway_start` call to `registerTool()` returns successfully, but the late tool is absent from all 40 model requests across 20 fresh scripted sessions. Evidence: `vm-artifacts/20260907-184712-phase-0/{spike-S1.jsonl,model-tools.jsonl}` and `plans/spike-S1.md` item i. Use the already-planned catalog-cache design: the kernel reads `os/gatekeepers.json` (written by `clawos gatekeeper add`) at register time and registers the cached `GatekeeperToolDef[]`; the live vendor object is published by its lifecycle service and resolved through its checked runtime slot at use time (§4.2). This is the same trick cloudflare-os uses with `getTypeScriptTypes()` — tool *shapes* are static metadata, only *execution* needs the live driver.

### 5.2 Hook handlers — exact behavior

**S-1 correction (2026-09-07):** the earlier zero-hook result came from the
scaffold's full-only registration guard, not universal absence of upstream hooks.
Agent turns select a discovery registry; inert hooks/tools must be declared there
as well as at startup. Narrowing belongs in ordinary `before_prompt_build`;
`requiresToolAuthority: true` is post-policy enrichment and cannot change tools.
Non-bundled conversation hooks additionally require
`plugins.entries.<id>.hooks.allowConversationAccess: true`.
Fresh-base run `20260907-192654-phase-0` exited 0 with 20/20 correlated
hook/tool calls and 40 narrowed model requests. The earlier interrupted run
remains unknown overall. See `plans/spike-S1.md` for exact commands and verdicts.
This is probe evidence, not acceptance of an implemented kernel or the entire phase.

The call stash must be shared across registration instances through the public
object-form `createPluginRuntimeStore`, scoped to the OS runtime/state and cleared
on shutdown. A closure-local map is insufficient. Discovery must not open a DB,
start services, or replace the full-mode runtime. Tool bodies still fail closed
when the runtime or call identity is absent.

`onReplyDispatch(e, ctx)` — **Pre-prompt channel admission; no takeover.** Resolve
upstream ownership with public `openclaw/plugin-sdk/command-auth` against the
host-finalized message context and host configuration, then require the exact
configured channel/operator match. Reject Gateway-originated, internal,
inter-session, ambiguous-provider, or missing-identity turns. Resolve routed
agent scope through public `agent-scope-runtime` rather than guessing from a
sender. Parse only canonical `commandText`, not enriched prompt/history. Record
non-owner observers before narrowing; return no handled result so ordinary
upstream dispatch continues. Restricted runtime dispatch may omit this hook;
that path receives no automatic grant. This implementation is a candidate until
live SDK ingress, forged RPC, and real Telegram acceptance prove its contracts.

`onBeforeAgentRun(e, ctx)` — **Gate.** Block maintenance and retain the trusted
non-owner observer fallback. Never mint URL grants here: the initial prompt and
tool policy have already been built. Operator RPC/CLI introduction remains the
separate paired-device-authorized path.

`onBeforePromptBuild(e, ctx)` — **Modify.** Narrow the turn's submitted tools to: all non-`gk_*` tools as-is, plus exactly the `gk_*` tools belonging to resource types for which this agent+session has an `active` grant with a compatible `audience`. Append the grant table and any introduction notes as a bounded system context block.

`capabilityPolicy()` — **Trusted tool policy.** **VERIFIED:** trusted policies run before every `before_tool_call` hook, accept the same `matcher` list, and are intended for host-level gates (workspace policy, budgets, reserved-workflow safety) — not per-conversation logic. The kernel therefore registers one host-level rule with an explicit matcher list of the registered `gk_*` tool IDs (no wildcard matching): *deny unless `params.grant` names an `active`, non-`lockdown` grant in the store.* This is a global check that cannot be bypassed by hook ordering or a misbehaving plugin; the agent/session-scoped check (is this grant valid for *this* agent and session, is the audience compatible) lives in `before_tool_call` below. Belt and braces: the trusted policy guarantees no ungranted gatekeeper call ever executes; the hook guarantees the right agent is using it.

`onBeforeToolCall(e, ctx)` — **Gate/Modify.** For `gk_*`: parse `params.grant`; `resolveGrant(ctx.agentId, ctx.sessionKey, handle)` → else `{block: true, blockReason: "No such grant"}`. Check `audience` vs. observers. Dry-run the tool to obtain its `ObservationDescription` or `ActionDescription`; if an action has `awaitDecision`, return `requireApproval` with `onResolution` that records the decision; otherwise stash the resolved session on the call (keyed by `e.toolCallId`) and return `{}`. For `os_*`: stash `{agentId, sessionKey}` by `toolCallId` and pass. `toolCallId` is documented as optional on the event (**VERIFIED**); S-1 observed it on 20/20 calls on the tested path, not a universal guarantee — if it can be absent, the kernel blocks the call (fail closed) and logs a diagnostic, because without it the tool body cannot know who is calling.

Gatekeeper tool `execute(toolCallId, params)` (registered by the kernel): fetch the stashed session by `toolCallId` (fail closed if missing); call `session.call(tool, params, ctx)`; the gatekeeper does the queue calls internally; return the result. Any thrown error is converted to a tool error whose text is the gatekeeper's *sanitized* message (the kit strips URLs, tokens, and vendor error bodies). Stash entries expire after `tools.exec.timeoutSeconds` or on `after_tool_call`, whichever comes first.

`onAfterToolCall` — audit record with duration and outcome. `onAgentEnd` — audit + `drainer.kick(agentId)`. `onSessionEnd` — close all sessions for `sessionKey`.

`onBeforeAgentReply` — **Claim.** If the inbound text is `/approvals`, `/approve <ids|all>`, `/reject <ids>`, `/grants`, or `/grant <url>`, and the sender is an operator, handle it and return a synthetic reply; the model never sees these commands. Non-operators get silence.

`onMessageSending` — **Modify/Gate.** Apply cell egress rules from config (`clawos.egress.denyPatterns`, e.g. secrets-looking strings, grant handles, resource keys marked private). Redact or cancel with reason.

`onBeforeInstall(e)` — **Gate, fail-closed (secondary).** Upstream's primary install boundary is the operator-owned `security.installPolicy` command (**VERIFIED**, §7.5); the OS projects a protected standalone build of `clawos install-policy`, which evaluates `plugins.entries.clawos-kernel.config.install.allowSources` / `allowHashes` and returns a versioned allow/block verdict. `before_install` re-checks the same policy for Gateway-backed install flows and blocks with a reason on mismatch.

### 5.3 State store (`node:sqlite`)

**VERIFIED S-1 h:** on Node 24.20.0 / OpenClaw 2026.9.2, Node's public
`createRequire()` can load `node:sqlite` inside the plugin lifecycle and create,
write, query and close `<stateDir>/os/probe.sqlite` while the Gateway runs. A
static import prevented this probe from loading (`Cannot find module 'sqlite'`).
Keep the public Node loader adaptation OS-owned; do not modify upstream. Evidence:
`plans/spike-S1.md`, runs `20260907-183938` and `20260907-184712`.

Tables: `grants`, `introductions`, `actions` (`id`, `gatekeeperInstance`, `actionId`, `descriptionJson`, `status`, `decidedBy`, `decidedAt`, `appliedAt`, `error`), `instances` (gatekeeper instance registry: vendor, resourceKey, operatorId, observer strategy, lockdown flag), `observers`, `audit_index`, `meta` (schema version). Migrations are forward-only and run at `gateway_start`; the schema version is written into `clawos.lock.json` so rollback tooling can refuse to downgrade past a schema bump (the same "schema-neutral rollback" rule upstream uses for its own updates).

### 5.4 Gateway RPC methods (`os.*`)

All methods require an authenticated operator connection. **VERIFIED S-1 g:**
the public SDK paired client exposes `client.connect.role === "operator"`,
`connect.scopes`, and `connect.device.id`; reconnecting with its issued device token
sets `client.isDeviceTokenAuth === true`. Neither `pairedClientId` nor
`authenticatedUserId` is populated on either connection in the tested path.
Shared Gateway authentication alone can have operator role/scopes without a device,
so it does **not** guarantee device pairing. Do not use optional absent fields or
client-reported labels as authority. The operator authorization adapter must enforce
role/scopes and the chosen paired-device requirement, failing closed when the
required identity is absent; positive identity probes are not negative authorization
conformance. Evidence: `plans/spike-S1.md`, paired-client structural observations.
Methods use `profileAccess: "required"` (**VERIFIED** option), but this selects a
profile and is not an operator authorization check. Payloads are TypeBox-validated.
`os.status` returns cell id, upstream/kernel versions, gatekeeper health, pending
approval count, and last update result for `clawos status`.

### 5.5 CLI (`openclaw os …` and `clawos …`)

The kernel's `registerCli` mounts the *gateway-side* commands (`grants`, `approvals`, `gatekeepers`, `audit`, `status`). The separate `clawos` binary adds the *host-side* commands (`install`, `cell`, `update`, `rollback`, `backup`, `config apply`, `doctor`, `blueprint`) and forwards the gateway-side ones over WebSocket so both entry points behave identically.

### 5.6 Internal hooks (optional, trusted)

Two small internal hooks ship as `HOOK.md` bundles for things the plugin API does not expose: `clawos-bootstrap` on `agent:bootstrap` (adds `os/blueprints/<name>/README.md` to `context.bootstrapFiles` — the one documented mutable field) and `clawos-lifecycle` on `gateway:pre-restart` (flushes the audit log). They are shipped inside the kernel plugin as *plugin-declared hooks* (a **VERIFIED** discovery tier: bundled → plugin-declared → managed `<stateDir>/hooks/` → `hooks.internal.load.extraDirs`), so no separate install step exists; `openclaw hooks install` is a deprecated alias for `openclaw plugins install` (**VERIFIED**). They are enabled via `hooks.internal.entries.<key>.enabled` in `10-plugins.json5`. Internal hooks run unsandboxed in the Gateway process (**VERIFIED**), so they stay tiny and are reviewed at the kernel bar.

---

## 6. Configuration, pinning, and update strategy

### 6.1 The lockfile — `os/clawos.lock.json`

```json
{
  "schemaVersion": 1,
  "cell": "default",
  "upstream": { "package": "openclaw", "version": "2026.9.2", "channel": "stable",
                "installedAt": "2026-09-06T18:00:00Z", "nodeVersion": "v22.22.3" },
  "lastKnownGood": { "version": "2026.9.2", "verifiedAt": "2026-09-06T18:05:00Z" },
  "plugins": { "clawos-kernel": "1.0.0", "gatekeeper-github": "1.0.0", "gatekeeper-fs": "1.0.0" },
  "kernelSchema": 1,
  "configFingerprint": "sha256:…"
}
```

This is the analogue of the starter's git submodule gitlink: the pin *is* the version. Nothing else in the system decides which upstream version is running.

### 6.2 Config ownership and reconciliation

`openclaw.json` is upstream's file, but the OS needs to own specific subtrees. **DECISION:** the OS uses *reconciliation*, not file rewriting. `clawos config apply`:

1. Deep-merges `os/config.d/*.json5` in filename order and computes a names-only diff.
2. Captures the authored file's SHA-256 revision **before** reading the redacted ownership snapshot. Refuses an unstable read or an owned-path mismatch against the last successful checkpoint (`--force` permits only pre-existing drift).
3. Runs `openclaw config patch --file os/config.generated.json --dry-run` for CLI schema/SecretRef validation.
4. Commits through the installed **public** `openclaw/plugin-sdk/config-mutation` `mutateConfigFile({base: "source", baseHash, ...})` in a separate, cell-scoped helper process. The patch is a mode-600 file, never argv. Objects merge and arrays/scalars replace; operator entries survive. The SDK revalidates under its canonical cross-process lock and guards atomic publication. No retry or unguarded fallback, including under `--force`.
5. Requires the persisted revision to match both before and after re-reading owned paths, and again before recording the checkpoint. A post-commit external edit is left in place; the OS refuses to certify it. Runs lint and restarts for changed restart-requiring paths, including forced drift recovery. Does not perform an unsafe automatic rollback over newer edits.
6. Records ownership digests and fingerprint only after those checks. Named cells resolve their registered port; both state and config paths are explicit in every child process.

**CORRECTION 2026-09-07 (review of Phase 1).** `config patch` has no expectation flags; `config set` expectations are single-operation only and would expose credential-bearing expected values in argv. The initial digest-precheck + unguarded patch implementation was **not atomic**: an edit after the precheck could be overwritten, and computing post-write digests did not verify a postcondition. The earlier 23/23 run tested pre-existing drift only and did not establish race protection. That design is superseded by the SDK transaction above.

**VERIFIED public contract:** pinned 2026.9.2 `docs/plugins/sdk-subpaths.md` identifies `config-mutation` as the transactional writer; its exported types expose `mutateConfigFile`, `baseHash`, and `persistedHash`. The shipped implementation uses a cross-process lock, compares the base hash, and retains the root snapshot publication guard. The CLI helper imports only that documented SDK subpath from the installed binary's package; it does not vendor or modify upstream. All source values and SDK diagnostics remain private to the helper. The parent receives only the persisted hash.

Ownership digests remain useful for drift **between** applies. They use redacted snapshots, so a secret-value-only change predating the run remains invisible to those digests; credential indirections are SecretRefs, not plaintext. In contrast, the full authored-file transaction revision catches **any** file edit during the run, including secret-only and operator-owned edits. Such an edit aborts conservatively rather than retrying over it. Direct-file editors do not participate in upstream's lock; the last-instant publication guarantee is the supported upstream guard, not a promise of filesystem CAS against arbitrary raw writers.

Why not `$include`: the 2026.9.2 docs state that root includes, include arrays, and includes with sibling overrides **fail closed for OpenClaw-owned writes** (`config patch`, doctor migrations), and that `$include` configs are not auto-migrated at startup (**VERIFIED**). A root-level include array would therefore break the very `config patch` path the OS and upstream tooling rely on. Reconciliation is the design, not a fallback.

**INVARIANT:** the OS owns exactly these subtrees and no others: `gateway.auth`, `gateway.bind`, `gateway.reload`, `tools.*` (whole arrays), `plugins.entries.clawos-kernel`, `plugins.entries.gatekeeper-*`, `plugins.deny`, `agents.defaults.sandbox`, `agents.entries.<blueprint-provisioned>`, `update.*`, `hooks.internal.entries.clawos-*`, and the plugin-config namespace `plugins.entries.clawos-kernel.config.*` (where all `clawos.*` settings live). Operator-owned keys (channels, models, auth profiles) are never touched. `90-local.json5` is the operator's override fragment and always wins.

### 6.3 What survives an upstream update

| Thing | Where it lives | Survives `openclaw update`? |
|---|---|---|
| OS state, audit, grants, tokens | `<stateDir>/os/` | Yes — upstream never touches it |
| Plugins | upstream's managed plugin root | Yes — install records are tracked; plugins are re-validated for compat on load. **UNVERIFIED** whether a *major* upstream change re-prompts capability consent — the update pipeline handles it by re-running `plugins install --accept-capabilities` from the lockfile |
| `openclaw.json` contents | upstream file | Yes — but doctor may migrate legacy keys (e.g. `tools.exec.security` → `tools.exec.mode`, **VERIFIED**); reconciliation re-applies fragments afterwards |
| Internal hooks | `<stateDir>/hooks/` | Yes |
| Blueprint-provisioned agents | `agents/<id>/` + config | Yes |

### 6.4 The update pipeline (`clawos update`)

Ported from `cloudflare-os-starter/docs/customization.md` §Upgrade, adapted for a daemon:

```
clawos update [--to <version> | --channel stable|extended-stable|beta] [--dry-run] [--yes]
```

1. **Resolve target.** Query npm dist-tags (`npm view openclaw dist-tags --json`); resolve the target version. Refuse `dev` (git main) unless `--allow-dev`.
2. **Preflight compat.** Compare the target against every installed OS plugin's `openclaw.compat.pluginApi` range (read from the lockfile + package metadata). If any plugin is out of range, stop and print which plugin needs a release — unless `--force-compat`, which continues but marks the run *experimental*.
3. **Record rollback point.** `lastKnownGood ← current`. `openclaw backup create --output ~/.clawos/backups/<cell>/ --verify` (**not** `os/backups/` — upstream rejects an output path inside the source state tree; see the §3.3 correction); also tar `os/` (excluding `backups/`).
4. **Stage.** `npm install -g openclaw@<target> --allow-scripts=openclaw` into a **staging prefix** (`os/staging/npm-prefix`, via `npm --prefix`) so the running Gateway is untouched. (Upstream's own `openclaw update` also validates the new version while the current Gateway keeps serving — **VERIFIED** — but we need the conformance step in between, which upstream cannot run for us.)
5. **Conformance.** Start a throwaway Gateway from the staged binary with `OPENCLAW_STATE_DIR=os/staging/state`, a copied config, port `+1000`, and `--profile clawos-staging`; run `clawos-conformance` against it (§8.3). Any failure → abort, staging discarded, nothing changed.
6. **Maintenance window.** Set cell `maintenance=true` (new turns are gently refused by `before_agent_run`), wait up to 60 s for in-flight runs (`os.status` shows active runs), `openclaw gateway stop`.
7. **Activate.** `openclaw update --tag <target>` (persisting nothing — `--tag` is one-off, **VERIFIED**) *or* promote the staged prefix by re-running the global install; then `clawos config apply` (re-applies fragments after any doctor migration), `openclaw doctor --fix --non-interactive`, `openclaw gateway restart`.
8. **Verify.** Poll `/startupz` then `/readyz` (60 s budget); `openclaw plugins list --json` shows kernel + gatekeepers enabled; `os.status` healthy; `openclaw security audit` has no new *critical* findings versus the pre-update snapshot; smoke test: one gatekeeper observation through a test grant.
9. **Commit or roll back.** On success write the new pin and `lastKnownGood`; widen nothing automatically. On failure: `clawos rollback` — reinstall `lastKnownGood.version`, restore `os/` from the tar, restore config from `openclaw backup`, restart, verify, and print the failing step. Rollback is refused if the kernel schema advanced during the failed run (it never does before step 9 succeeds — migrations run only after the pin is committed, which is what makes rollback schema-neutral).

`clawos update --check` (scheduled via `openclaw cron` in the default cell) runs steps 1–2 only and posts "update 2026.9.3 available, all plugins compatible" to the operator channel.

### 6.5 Compatibility discipline (CI)

**2026-09-11 CI repair.** The original nightly scaffold was running before its Phase 7
integration existed: Node 22 cannot install current upstream, extended-stable is
2026.6.35 (outside our declared range), and the old install/conformance CLI flags
are obsolete. The nightly job now resolves each tag once, adds the lock-file pin
as a control, uses Node 24, and checks declared compatibility before installation.
Supported releases must pass ordinary-plugin metadata inspection and a fresh hosted
Ubuntu VM smoke: actual kernel/filesystem startup, three health endpoints,
authenticated `os.status`, healthy fs driver, zero grants and empty approval queues.
An out-of-range extended-stable tag is **unsupported / not tested**, never a
conformance pass; resolution errors, pin/latest/beta escaping the declared range,
and any supported-release check failure still fail CI. Structural verdicts and job summaries preserve this distinction.
This is deliberately **compatibility smoke, not full conformance**. Full scenario,
agent-turn, hook, approval and update/rollback matrix integration remains Phase 7;
existing Phase 3 VM acceptance evidence is unchanged. No upstream pin/range is widened.


Because "all OpenClaw plugin APIs are experimental" (**VERIFIED**), the monorepo's CI runs the conformance suite in a matrix against `openclaw@latest`, `@beta`, and `@extended-stable` nightly. A failure against `beta` opens an issue tagged `upstream-drift` so a compatible plugin release exists *before* that version reaches `latest`. Each OS plugin release bumps `openclaw.compat.pluginApi` only after passing on that version. The repo's `clawos.lock.json` (root, for development) pins the version the suite is green on; `clawos install` uses that pin by default.

---

## 7. Security model

### 7.1 Trust boundaries: Cells

Upstream is explicit: one Gateway is one trust boundary, and mixed-trust operation requires "split gateways, separate credentials, ideally separate OS users or hosts" (**VERIFIED**). OpenClaw OS makes this a first-class object. A **cell** is a named OpenClaw profile with its own state dir, port, systemd unit, config fragments, operators, gatekeeper accounts, and lockfile. Cells share nothing but the upstream binary. `clawos cell create <name> [--port N] [--user <unix-user>]` provisions one; `--user` runs it under a dedicated Unix account (recommended for business-grade isolation, matches upstream's advice). Two firms = two cells (or two hosts); a gatekeeper account connected in one cell is invisible to the other.

### 7.2 Hardened baseline (`00-baseline.json5`)

Derived from the upstream security page's hardened baseline (**VERIFIED**) plus OS requirements:

```json5
{
  gateway: {
    mode: "local", bind: "loopback",
    auth: { mode: "token", token: "${CLAWOS_GATEWAY_TOKEN}" },   // ${VAR} substitution (VERIFIED)
    reload: { mode: "hybrid" },
  },
  session: { dmScope: "per-channel-peer" },
  tools: {
    profile: "messaging",
    deny: ["group:runtime", "group:fs", "group:automation", "browser"],   // OS gatekeepers replace these
    exec: { mode: "deny" },
    sessions: { visibility: "self" },
    elevated: { enabled: false },
  },
  update: { channel: "stable", auto: { enabled: false } },
  plugins: { deny: [] },    // populated by clawos install with everything not in the allowlist
  hooks: { internal: { enabled: true } },
}
```

Blueprints re-enable capabilities deliberately: a "coder" blueprint sets `agents.entries.coder.tools.allow: ["group:fs", "exec"]` *together with* `sandbox.mode: "all"` — never one without the other (enforced by `clawos blueprint lint`).

### 7.3 Sandboxing

`20-sandbox.json5` sets `agents.defaults.sandbox: { mode: "non-main", scope: "agent", backend: "docker", workspaceAccess: "ro" }` with `network: "none"` (upstream default). Gatekeepers run in the Gateway process (native plugins are not sandboxed — **VERIFIED**), which is correct: they are the trusted drivers, and the sandbox is for the untrusted `exec`/file tools. `gatekeeper-fs` is how a sandboxed agent gets *scoped* host filesystem access without `group:fs`.

### 7.4 Secrets

OAuth client secrets and API keys enter via OpenClaw SecretRefs (`{source: "env"|"file"|"exec"}`, **VERIFIED**) referenced from `plugins.entries.gatekeeper-*.config`, never as literals in fragments. Per-operator tokens obtained by OAuth are stored in `os/gatekeepers/<vendor>/accounts/<operatorId>.json`, encrypted with a cell key at `os/cell.key` (mode `600`, generated at install; AES-256-GCM via `node:crypto`). The kernel never reads token files — only the owning gatekeeper does, through the kit. OAuth redirect URIs are `${gateway.publicOrigin}/os/gatekeeper/<vendor>/oauth/callback`; state parameters embed a nonce bound to the operator and expire in 10 minutes (two-stage nonce from cloudflare-os `SKELETON.md`). Because the baseline binds to loopback, OAuth callbacks need either `openclaw gateway` exposed via Tailscale (`gateway.bind: "tailnet"`, upstream-supported) or the operator completing the flow on the host's browser; `clawos gatekeeper connect` explains which applies.

### 7.5 Supply chain

**VERIFIED S-1 m (2026-09-07):** configure `security.installPolicy.exec` with
`source: "exec"`, an absolute regular-file `command`, static `args`, and explicit
`passEnv` / `trustedDirs`; it is not a shell command string. Stdin is a JSON
object with `protocolVersion: 1`; stdout must include `protocolVersion: 1` and
`decision: "allow" | "warn" | "block"` (nonempty reason for warn/block).
Live fixture results: block denied installation, `{}` denied installation,
allow permitted installation; allow was evaluated twice. Only input key names,
version, target type and fixture mode were retained. See `plans/spike-S1.md`.

`security.installPolicy` (**VERIFIED** primary boundary: a trusted local command after staging, covering plugins and skills and failing closed when unavailable) is generated in `15-runtime.json` with `enabled:true` and a protected standalone policy script invoked through an absolute Node executable. It evaluates `plugins.entries.clawos-kernel.config.install`; `before_install` re-checks the same rules. `plugins.allow` positively selects enabled first-party plugins; explicit `plugins.deny` entries remain authoritative. The source installer deploys bundled first-party artifacts to cell-local `plugins.load.paths`; it does not fetch nonexistent npm releases. Third-party CLI installation still uses upstream's policy/provenance checks (`--force` never bypasses the policy). `openclaw security audit --deep` runs after source installation, and missing/invalid verdicts or critical findings fail installation.

---

## 8. Repository layout and tooling

```
openclaw-os/
├── AGENTS.md                      # agent operating rules: kernel bar, invariants, review order
├── REVIEW.md                      # review priority: kernel bar → capability invariants → secret leakage → rest
├── README.md
├── clawos.lock.json               # dev pin (upstream version the suite is green on)
├── pnpm-workspace.yaml            # catalog: pinned shared deps (typebox, openclaw peer range)
├── package.json  tsconfig.json  vitest.config.ts  .github/workflows/{ci,conformance-matrix}.yml
├── .agents/skills/
│   ├── write-gatekeeper/SKILL.md  # §4.6 procedure + SKELETON.md pointer
│   ├── clawos-operator/SKILL.md   # install/update/rollback/troubleshooting runbook
│   └── write-blueprint/SKILL.md
├── docs/                          # architecture.md, gatekeepers.md, approvals.md, cells.md, updating.md, security.md
├── plans/                         # this document + future plan-as-artifact docs (cloudflare-os convention)
├── config/
│   ├── config.d/                  # fragment templates copied into <stateDir>/os/config.d at install
│   └── gatekeepers.json           # catalog of known gatekeepers (npm spec, required secrets)
├── installer/
│   ├── install.sh                 # curl | bash entry (Linux/macOS/WSL2)
│   ├── preflight.sh
│   └── systemd/                   # unit templates (overrides only; base unit is upstream's)
├── packages/
│   ├── clawos-shared/             # contracts (§4.3)
│   ├── clawos-kernel/             # kernel plugin (§5)
│   ├── gatekeeper-kit/            # defineGatekeeper(), OAuth nonce machine, overlay store, SKELETON.md
│   ├── gatekeeper-github/         # reference driver
│   ├── gatekeeper-fs/
│   ├── gatekeeper-mcp/
│   ├── gatekeeper-http/
│   ├── clawos-cli/                # `clawos` binary
│   ├── clawos-blueprints/         # assistant, coder, ops, researcher
│   └── clawos-conformance/        # suite run against a live Gateway
└── scripts/                       # dev-gateway.ts (spins a throwaway cell), release.ts
```

**Tooling decisions:** pnpm workspaces with a `catalog:` (the starter's catalog-drift lesson: keep the `openclaw` peer range and `typebox` version byte-identical across packages — CI checks this); TypeScript strict; `tsup` for plugin bundles (single ESM file per plugin, no runtime deps beyond `typebox`, because OpenClaw loads plugins in-process and each extra dependency is startup cost and attack surface); vitest for unit tests; the conformance suite uses a real Gateway (no mocks of upstream — mocks are exactly what would hide drift). `pnpm validate:plugins` checks ordinary-plugin metadata in an isolated snapshot via `plugins inspect --all --json`; runtime conformance remains separate. The pinned `plugins validate` authoring command rejects ordinary `definePluginEntry` entries without generated authoring metadata (S-1).

### 8.1 `AGENTS.md` (contents, abbreviated)

The kernel (`clawos-kernel`, `clawos-shared`) is held to a higher bar: reviewers read every line; prefer reusing an upstream mechanism over adding a parallel one; every exported member is doc-commented; never `as unknown as` across an RPC boundary. Capability invariants: every gatekeeper reach goes through `resolveGrant`; a gatekeeper never registers tools itself; no ambience without operator config. Secrets: never log secrets, prompts, headers, tokens, or bodies. Upstream: never import from `openclaw/*` other than the documented `openclaw/plugin-sdk/*` subpaths; never read upstream's SQLite; never write under the upstream install root.

### 8.2 `REVIEW.md`

Review priority, highest first: the kernel bar; capability-security invariants (especially any new path that resolves a grant or registers a `gk_*` tool); secret leakage through logs, tool results, or error strings; upstream-coupling creep (new SDK subpaths, new config keys — each must be added to §2.2's table with a VERIFIED source); then everything else.

### 8.3 Conformance suite (`packages/clawos-conformance`)

Each test starts (or attaches to) a Gateway and exercises one dependency:

| Test | Asserts |
|---|---|
| `plugin-loads` | `openclaw plugins list --json` shows kernel + reference gatekeeper enabled, no manifest diagnostics |
| `hooks-fire` | Each hook the kernel registers fires once for a scripted turn (`before_agent_run`, `before_prompt_build`, `before_tool_call`, `after_tool_call`, `agent_end`) — via a test model provider that emits a fixed tool call |
| `tool-narrowing` | Model request contains `gk_*` tools only when a grant exists (inspected through `llm_input`) |
| `gate-blocks` | Tool call with an unknown grant handle is blocked; audit record written |
| `require-approval-roundtrip` | `awaitDecision` action produces `exec.approval.requested`-style prompt and resolves |
| `deferred-approval` | Action is queued, simulated read reflects it, `os.approvals.apply` performs it |
| `rpc-methods` | Every `os.*` method answers over WebSocket with schema-valid payloads |
| `cli-mounted` | `openclaw os status --json` works |
| `config-reconcile` | `clawos config apply` is idempotent (second run = no diff) and doctor lint is clean |
| `health` | `/healthz`, `/startupz`, `/readyz` respond |
| `install-gate` | Primary install policy blocks a real non-allowlisted CLI install; explicit operator allow succeeds and unavailable policy fails closed. Secondary Gateway hook evidence is separate. |
| `fs-gatekeeper` | Scoped directory grant: read inside allowed, read outside blocked |

The suite prints a compatibility verdict for the upstream version it ran against, which the update pipeline consumes.
The runner uses an explicit live-test workspace and exact suite inventory. Every selected suite must appear with
at least one assertion, all assertions passed, no skips/TODOs and successful process termination; zero exit status
alone is not acceptance. Missing/malformed reports, empty selections, unknown names and failed connectivity deny.
Ordinary `pnpm test` runs offline runner regressions, not the live suites. SDK transport uses the already-verified
public `gateway-runtime` client with explicit endpoint/state selectors; credentials and structured RPC parameters
remain in memory. Structural verdicts exclude raw assertion errors and payloads. Runner fixture passes establish
the verifier only, never the kernel or an unimplemented conformance criterion.

---

## 9. Implementation phases

Each phase lists deliverables, steps, and acceptance criteria. Do not start a phase until the previous one's acceptance passes. Estimated effort is for one capable agent working with an operator available for the STOP points.

### Phase 0 — Bootstrap, spikes, and conventions (1–2 days)

**Deliverables:** repo skeleton (§8), `AGENTS.md`, `REVIEW.md`, `clawos.lock.json`, CI workflow that installs `openclaw@<pin>` and runs `openclaw --version`, spike report `plans/spike-S1.md`.

**Steps.**
1. Start from the repo skeleton in the agent kit (`repo-skeleton/openclaw-os/`): it already contains the monorepo layout of §8, `clawos.lock.json` pinned to `2026.9.2`, the pnpm catalog, contracts, the kernel/kit/gatekeeper stubs (which type-check against the real `openclaw@2026.9.2` SDK — `pnpm install` pulls it as a peer), VM scripts, per-phase test scripts, CI workflows, and skills. `git init`, commit it as `chore: import skeleton`, then run `pnpm install && pnpm build && pnpm test` (11 unit tests pass, 12 conformance tests are `todo`).
2. `scripts/dev-gateway.ts`: spins a throwaway cell (`OPENCLAW_PROFILE=clawos-dev`, port 19100, `gateway.auth.mode: "token"`, token from env) with `openclaw gateway run` (**VERIFIED** foreground form), and tears it down.
3. **Spike S-1** — the repo skeleton ships `scripts/spike-probe` (a throwaway plugin) and `plans/spike-S1.md` (the open questions, letters c–m). Run the probe in the VM, answer every question with the command and output, and update this document accordingly. Items already settled from the published package are listed at the top of `plans/spike-S1.md` and must not be re-spiked. Record answers with the exact commands in `plans/spike-S1.md` and update §2.2/§5.1 in this document (`docs/implementation-plan.md` in the agent kit) — change each resolved marker from UNVERIFIED to VERIFIED with the evidence.
4. Write the three `.agents/skills/*/SKILL.md` files (initial versions).

**Acceptance.** CI green; `pnpm dev:gateway` starts and stops a cell; `plans/spike-S1.md` answers every question; no UNVERIFIED markers remain in §5.

### Phase 1 — Host layer and installer (2–3 days)

**Deliverables:** `installer/install.sh`, `installer/preflight.sh`, `packages/clawos-cli` with `install`, `cell`, `status`, `doctor`, `config apply`, `backup`; `config/config.d/*` templates.

**Steps.**
1. `preflight.sh`: detect OS (Linux w/ systemd, macOS, WSL2), Node ≥ 22.22.3 / 24.15 / 25.9 (install via upstream's installer if missing — `curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard` provisions Node when needed, **VERIFIED**), Docker or Podman (optional; warn), free port, `umask`.
2. `clawos install` (§10 has the operator-facing procedure): install upstream at the pin with `npm install -g openclaw@<pin> --allow-scripts=openclaw`; create `<stateDir>/os/` tree with `700`; generate `cell.key` and gateway token; copy fragment templates; write `openclaw.json` if absent (minimal, `600`); run `clawos config apply`; `openclaw gateway install` and enable the user unit; add a systemd drop-in `~/.config/systemd/user/openclaw-gateway.service.d/clawos.conf` with `Environment=OPENCLAW_NO_AUTO_UPDATE=1` and `Environment=CLAWOS_CELL=default` (a drop-in never modifies upstream's unit file — INVARIANT 1 at the host level). On a SOPS-managed host, `--environment-file /run/secrets/<cell-env>` layers that host-owned file into the unit by reference and persists only its path in the cell registry; secret contents are never copied into cell state. Start; wait for `/readyz`; `openclaw doctor --lint --json`; `openclaw security audit`; write the lockfile.
3. `clawos cell create <name> --port N [--user U]`: same as above under `OPENCLAW_PROFILE=<name>`; unit `openclaw-gateway-<name>.service`; register in `~/.clawos/cells.json` (host-level registry — the only OS file outside a state dir).
4. `clawos config apply` per §6.2; `clawos backup create|restore`.
5. `clawos doctor`: runs upstream doctor lint, checks perms (`600`/`700`), lockfile vs. installed version, unit status, health endpoints, disk space, and prints fix hints.

**macOS implementation note (2026-09-07):** launchd-aware install/status/doctor/cell paths are prepared; upstream owns its LaunchAgent, while OS environment is loaded from the cell `.env`. Backup stop/start uses upstream CLI on both platforms. Reserved macOS profile labels are rejected. These paths have unit/static coverage only until a real macOS acceptance run is recorded.

**Acceptance.** On a clean Ubuntu 24.04 VM and a clean macOS machine: source install (the `curl … | bash` form is not available yet — see the §10.2 correction) → Gateway running, `clawos status` healthy, `openclaw doctor --lint` with no error-severity findings (corrected from "exit 0"; see `docs/phase-checklist.md` for the two deliberately accepted warnings), `openclaw security audit` no critical findings, `clawos config apply` idempotent, a second cell can be created and both run concurrently, `clawos backup create` + `restore` round-trips.

### Phase 2 — Contracts and kit (2–3 days)

**Deliverables:** `packages/clawos-shared` (§4.3, fully doc-commented, TypeBox schemas for every wire type), `packages/gatekeeper-kit` (`defineGatekeeper()`, `OAuthNonceMachine`, `TokenStore` (encrypted), `OverlayStore` (overlay-at-read simulation), `CacheMutationStore` (mutate-the-cache alternative), `ActionSequencer`, `sanitizeError()`, test harness), `SKELETON.md`.

**Acceptance.** Unit tests: nonce replay is rejected; expired nonce rejected; token file round-trips encrypted; overlay reflects pending actions and forgets rejected ones; `defineGatekeeper` refuses a tool whose description contains "approv", "oauth", "cache", "queue" (case-insensitive) or whose `parameters` lack `grant`; refuses an action tool without `describe()`.

**Phase 2 contract clarification (2026-09-07).** Wire schemas cover the JSON data shapes from §4.3–4.8, including
credential-free account/vendor/resource summaries and the operator request payloads. Live vendors, accounts, sessions,
queues and `SessionCallContext` are process-local interfaces, not serialized objects. Unknown wire fields are rejected;
operator identity must come from trusted RPC context. Stored `descriptionJson` is parsed and validated separately with
`ActionDescriptionSchema`. Grant handles use lowercase Crockford base32 (`0-9a-hjkmnp-tv-z`), preserving the example
`grant:7k3m9q2p`; the initial all-alphanumeric regex did not implement the stated base32 contract. No live grants exist yet.

**Phase 2 kit integration (2026-09-07).** The scaffold could not enforce the stated builder acceptance rule because its
action descriptors existed only on resource instances. `GatekeeperDefinition.actions` now declares pure action
`describe` functions; instance-level `ActionImpl` validation remains mandatory, and authors reuse the descriptor.
`ObservationImpl` is split into pure `describe` and `read`, allowing dry passes without fetching and authorization before
reads. Simulators receive the reserved actionId and must store exactly one matching overlay entry. For unsimulated actions,
`SessionCallContext.actionApproval` is a process-local, kernel-retained exact `(toolCallId, tool, params)` approval binding;
missing or changed bindings fail closed. It is not a new RPC authority field. The kernel adapter remains Phase 3 work.

The implemented builder uses only the public entry/runtime-store/service surfaces already verified in S-1. Manifest config
validation remains upstream-owned. Discovery is inert; lifecycle publication revokes retained nested handles on stop or
replacement. This is unit-tested library transport, not live kernel conformance. Runtime slots are not a boundary against
malicious native plugins. File-backed journal/sequence/overlay ownership is one live resource instance in one cell process.
Submission and remote-write uncertainty fails closed for operator reconciliation; it never silently retries a possibly
applied vendor action. CacheMutationStore retains an authoritative base for rejection and refresh replay.

Token filenames are SHA-256 hashes of exact operator IDs rather than raw IDs (which may contain slashes or channel prefixes).
AES-GCM authenticates canonical store path and operator identity, so ciphertext cannot be transplanted between accounts or
vendor/cell stores sharing a key. Cross-path restores need explicit re-encryption or reconnection. The original OAuth
scaffold was one-stage despite its comment; both nonce stages now rotate/consume once within the original expiry.
`SKELETON.md` documents these APIs, recovery limits, private-only v1 behavior and the later driver review gates.

### Phase 3 — Kernel (5–8 days)

**2026-09-08 CLI integration correction:** plugin root command routing additionally
requires manifest `cliCommands`, matching `registerCli` descriptors, and inert CLI
registration in `cli-metadata`/`discovery`/`full` modes (pinned
`docs/plugins/manifest.md` §cliCommands). Mounted `openclaw os` commands must use
the live Gateway, not an unstarted local kernel store. Machine-readable output
must use stdout directly, not console logging that upstream redirects to stderr
in JSON mode. Explicit mounted-command selectors must agree on the registered
canonical cell. `clawos` now supplies paired
operator RPC commands for grants, bounded audit tail, status, gatekeeper listing,
and approval decisions. Audit time filtering and approval driver outcomes remain
separate acceptance work. The live checkpoint installs the actual packed CLI into
the disposable guest and selects a registered named test cell; merely putting the
source bin directory on PATH selected the snapshot's old CLI. Installer plugin
projection and install-policy integration are still outstanding.

**2026-09-08 live integration correction:** the pinned loader requires every tool
registered by the kernel to appear in the kernel manifest's `contracts.tools`;
reading catalog metadata alone does not authorize registration. The manifest now
includes the three approved filesystem names. Additional catalog vendors require
corresponding contract projection before reload. Manifest config schemas must be
self-contained; a relative `$ref` to `config.schema.json` is rejected. No upstream
modification is needed. A resolved driver session retains the exact queue object
used at `startSession()` through both dry and real calls; a fresh equivalent queue
is not the same authority. Call execution consumes its one-shot stash separately
from the after-hook audit record. Revocation invalidates authority before awaiting
session cleanup.

`kernel-live` now provides focused real-agent evidence for hooks, tool narrowing,
paired operator RPC introduction, non-owner URL refusal, bounded filesystem reads,
path escapes, revocation and unknown-handle denial with conversation hooks disabled.
This does **not** replace the remaining CLI/install-policy/channel acceptance or
claim the Phase 3 deliverables complete. Real file writes remain disabled.

**2026-09-07 enforcement checkpoint:** both filesystem authoring stops are approved
(STOP 1 after `7642efb`; STOP 2 by “Approved continue” after `fc8b33f`). The original
contract remains in `plans/fs-contract.md`. Focused `fs-enforcement` VM evidence
`20260908-035125-phase-3` passes 73/73 tests for Linux descriptor-confined bounded
list/read, per-call authorization, persisted resource identity, cache/overlay recovery,
revocation, and private-only observer refusal. Unsupported platforms deny data access.
This is library/driver evidence, not live kernel or full Phase 3 acceptance.

**Implementation limit:** all real granted-file creation and replacement remain
unavailable. Node's pathname operations cannot atomically combine confinement with
expected-version comparison; precheck followed by rename/publication is insufficient.
The approved contract explicitly requires unsafe operations to deny. Simulated writes
remain pending, can be read and rejected, and cannot be applied or auto-approved. No
write-conformance criterion is waived, and no production root is granted. Kernel
integration and the ordered live acceptance steps below remain outstanding.

**Deliverables:** `packages/clawos-kernel` per §5, with store, registry, policy pipeline, approval queue, drainer, audit, `os.*` RPC, `openclaw os` CLI, OAuth router; `gatekeeper-fs` as the first driver (no OAuth, strategy D, trivially testable); conformance suite tests `plugin-loads`, `hooks-fire`, `tool-narrowing`, `gate-blocks`, `rpc-methods`, `cli-mounted`, `health`, `fs-gatekeeper`, `install-gate`.

**Steps** (in this order, each with tests): store + migrations → registry (from catalog + `gateway_start`) → `resolveGrant` → tool registration on behalf of gatekeepers → `before_prompt_build` narrowing + trusted policy → `before_tool_call` gate with dry-run → `os_request_access` / `os_list_grants` → URL introduction in authenticated `reply_dispatch` → audit → RPC → CLI → authenticated `reply_dispatch` chat commands (`before_agent_reply` denial fallback) → `message_sending` egress → `before_install` gate → `gatekeeper-fs`.

**Acceptance.** Conformance tests above pass against the pinned upstream. Manual: in a Telegram DM to a dev cell, the operator pastes a path URL `file:///home/matt/projects/foo` → agent lists files via `gk_fs_dir_list`; a second, non-operator sender cannot introduce; `clawos grant revoke` makes the tool disappear next turn; every step appears in `clawos audit tail`.

**2026-09-09 fidelity closure:** the original Telegram manual scenario remains
the specification, but Matt explicitly deferred its execution; it is not passed
or replaced by synthetic ingress. The final automated Phase 3 candidate
`20260909-231728-phase-3` passes 78 conformance, 71 channel/OAuth/chat/egress and
98 kernel-live checks, including actual plugin secondary denial and filesystem
simulation/rejection. OAuth/connect, drainer, approval decisions and command
entry points are implemented, not placeholders. See `plans/phase-3-acceptance.md`
for source-to-evidence reconciliation, explicit corrections and retained limits.
Phase 3 may close under the Telegram deferral after candidate CI/merge/tag; real
GitHub and Phase 5 UX acceptance remain in their original later phases. Slack was
an added deployment canary, not an original Phase 3 gate.

**Owner-only audience enforcement:** upstream owner authorization answers who is
speaking, not who can read the reply. External channel turns must also have a
finalized `ChatType: "direct"` before URL introduction. Shared or unknown audiences
are persistently locked before prompt construction, even if the owner speaks first;
existing grants and preflighted calls are denied by the existing observer checks.
This implements §4.7's original private-only beta boundary, not v1.1 sharing.

### Phase 4 — Reference gatekeeper: GitHub (4–6 days)

**Deliverables:** `packages/gatekeeper-github` following §4.6 (with the two STOP reviews), resources `repo`, `issue`, `pull` (URL patterns exactly as cloudflare-os: `https://github.com/:owner/:repo`, `…/issues/:number`, `…/pull/:number`), tools (observations: `gk_github_repo_get`, `gk_github_repo_list_issues`, `gk_github_repo_list_pulls`, `gk_github_repo_read_file`, `gk_github_issue_get`, `gk_github_pull_get`, `gk_github_pull_diff`; actions: `gk_github_issue_create`, `gk_github_issue_comment`, `gk_github_pull_comment`, `gk_github_pull_review`), OAuth device/web flow, observer strategy B (`hasRepoAccess` distinguishing 403/404 → false from transient errors → throw), simulation for all four actions (overlay-at-read), `revertAction` for comments (delete) and issue create (close), `deploy-inputs.json`.

**Acceptance.** Conformance `deferred-approval` and `require-approval-roundtrip` pass using GitHub; manual: agent asked to "comment on issue 12 and then summarize the thread" comments (simulated), summarizes *including its own pending comment*, operator later runs `clawos approvals apply all` → comment appears on GitHub; `reject` removes it from the simulated thread; no token or API body ever appears in `os/audit` or logs (grep test in CI).

### Phase 5 — Approvals UX and auto-approval (2–3 days)

**Deliverables:** `clawos approvals` TUI table (list/apply/reject/revert with previews), chat commands `/approvals`, `/approve`, `/reject`, operator notifications (pending action digest after `agent_end`, batched, sent through `openclaw message send --channel <c> --target <t> --message "<digest>"` — **VERIFIED** flags — to the cell's operator channel, or in-process via the kernel's own channel access if S-1 finds a plugin-side send API), auto-approval rules in `plugins.entries.clawos-kernel.config.autoApprove[]` keyed by `actionKind.tag`, the drainer.

**Acceptance.** An action with tag `github.issue.comment` auto-applies within 30 s when the rule exists and the gatekeeper marked it `autoApprovable`; not when either is missing; drainer stops at the first non-eligible action and resumes after it is decided; digest arrives once per run, not once per action.

### Phase 6 — Blueprints and shell (3–4 days)

**Deliverables:** `packages/clawos-blueprints` with `assistant` (messaging-only, no fs/exec), `coder` (sandboxed fs+exec, `gatekeeper-fs` + `gatekeeper-github` expected), `ops` (cron + notifications), `researcher` (web tools + `gatekeeper-http`); `blueprint.json` schema (`name`, `version`, `workspaceFiles`, `skills`, `toolPolicy`, `sandbox`, `expectedGatekeepers`, `bindingsHint`); `clawos blueprint list|apply|diff|lint`; `write-blueprint` skill.

`clawos blueprint apply coder --agent dev` does: `openclaw agents add dev --workspace ~/.openclaw/agents/dev/workspace [--bind <channel:account>] --non-interactive` (**VERIFIED** flags; non-interactive mode requires `--workspace`) → copies workspace files into the agent's workspace → writes `os/config.d/30-agents.json5` entry for `agents.entries.dev` (tools, sandbox, skills) → `clawos config apply` → records the applied snapshot in `os/blueprints/dev/`. `diff` shows drift between the snapshot and the live workspace/config.

**Acceptance.** Applying each blueprint to a fresh cell yields a working agent; `blueprint lint` rejects a blueprint that grants `exec` without `sandbox.mode: "all"`; re-applying is idempotent.

### Phase 7 — Update, rollback, and compatibility pipeline (3–4 days)

**Deliverables:** `clawos update`, `clawos rollback`, `clawos update --check` cron, staging-prefix mechanism, conformance verdict format, `.github/workflows/conformance-matrix.yml` (nightly against `latest`, `beta`, `extended-stable`), `docs/updating.md`, `clawos-operator` skill's `references/upgrade-and-rollback.md`.

**Acceptance.** Simulated upgrade from `2026.9.2` to the current `latest` on a dev cell completes with the pipeline's nine steps logged; injecting a deliberately incompatible kernel build (compat range excluding the target) stops at step 2; injecting a failing conformance test stops at step 5 with nothing changed; killing the process during step 7 and running `clawos rollback` restores a healthy `2026.9.2` cell with all grants intact; the nightly matrix runs and reports per-version verdicts.

### Phase 8 — More drivers and observers (v1.1, 2–3 weeks)

`gatekeeper-mcp` (wrap any MCP server: each MCP tool becomes an observation or action per a per-server manifest; resources are "server" and optional per-tool grants; this alone gives the OS access to the whole MCP ecosystem with approvals and audit), `gatekeeper-http` (OpenAPI-driven generic driver, GET = observation, others = actions with `awaitDecision` by default), `gatekeeper-google` (Gmail A, Docs B, Drive B, Calendar B), `gatekeeper-slack`, `gatekeeper-notion`, `gatekeeper-homeassistant`; observer strategies B/C/D live (§4.7) with group-chat detection; Control UI approvals panel via `registerControlUiDescriptor()`; code-mode `.d.ts` generation per grant.

### Phase 9 — Hardening and release (1 week)

Threat-model review against `REVIEW.md`; fuzz `before_tool_call` param rewriting; secret-leak grep gates in CI; `openclaw security audit` clean on every blueprint; docs complete; `clawos --version`, changelog, signed npm releases under `@clawos/*`; publish the gatekeeper catalog to ClawHub (`clawhub package publish`, **VERIFIED** command) so `openclaw plugins install clawhub:@clawos/gatekeeper-github` works.

---

## 10. Installation

### 10.1 Prerequisites

Linux with systemd (Ubuntu 22.04+/Debian 12+/Arch/Fedora 39+), macOS 13+, or Windows via WSL2. A non-root user with a login shell (user-level systemd units require `loginctl enable-linger <user>` for always-on hosts). Node 22.22.3+, 24.15+, or 25.9+ (the installer provisions it if absent). Docker or Podman if you want sandboxed agents (strongly recommended for any blueprint with `exec`/fs). Outbound HTTPS to npm and model providers. ~2 GB disk.

### 10.2 Fresh install (recommended path)

**CORRECTION 2026-09-07 (Phase 1).** The `curl … | bash` one-liner below is **not available yet** and the
installer no longer pretends otherwise. It needs either a public repository or an authenticated fetch, and
`clawkeeper/openclaw-os` is private; no `@clawos/*` package is published to npm, so there is no registry
fallback either. `installer/install.sh` detects the piped-without-a-checkout case and reports exactly what is
missing instead of failing obscurely on a 404. The source install below is the supported path today, and it is
what Phase 1 acceptance exercises. The one-liner becomes real when the packages are published.

```bash
# 1. Install OpenClaw OS from a clone (the supported path today)
git clone https://github.com/clawkeeper/openclaw-os.git && cd openclaw-os && ./installer/install.sh

#    NOT YET AVAILABLE (private repo, nothing published) — see the correction above:
#    curl -fsSL https://raw.githubusercontent.com/clawkeeper/openclaw-os/main/installer/install.sh | bash

# The installer runs, in order:
#   preflight.sh                                   → OS/Node/Docker/port checks
#   npm install -g openclaw@2026.9.2 --allow-scripts=openclaw
#   pnpm install --frozen-lockfile && build && npm pack → npm install -g <clawos-cli tarball>
#   clawos install --cell default --yes            → see 10.3 for what it does

# 2. Onboard models/channels with upstream's wizard (unchanged upstream flow)
openclaw onboard                 # choose provider, sign in; the daemon is already installed by clawos
openclaw channels login --channel telegram        # or whatsapp/slack/discord/…

# 3. Register yourself as the cell operator (pairing + OS operator list)
openclaw pairing list telegram && openclaw pairing approve telegram <CODE>
clawos operator add --channel telegram --sender <your-sender-id>

# 4. Provision an agent from a blueprint and bind it
clawos blueprint apply assistant --agent home
openclaw agents list --bindings

# 5. Add a gatekeeper and connect your account
clawos gatekeeper add github     # installs @clawos/gatekeeper-github, prompts for OAuth app id/secret
clawos gatekeeper connect github # prints the OAuth URL; complete it in a browser

# 6. Introduce a resource and use it
clawos grant add --agent home https://github.com/you/repo
#   …or just paste that URL to the agent in chat.
clawos status
```

### 10.3 What `clawos install` does (non-interactive, idempotent)

```
[1/12] preflight            OS, Node, Docker/Podman, port 18789 free, umask 077
[2/12] upstream             npm install -g openclaw@<pin> --allow-scripts=openclaw ; openclaw --version == pin
[3/12] state dir            mkdir -p ~/.openclaw/os/{config.d,audit,gatekeepers,blueprints,backups,logs} (700)
[4/12] keys                 os/cell.key (600) ; CLAWOS_GATEWAY_TOKEN → ~/.openclaw/.env (600)
[5/12] config               write minimal openclaw.json if absent (600) ; copy config/config.d/* → os/config.d/
[6/12] plugins              Install the CLI's bundled first-party kernel/fs artifacts under
                            <stateDir>/os/plugins/<content-hash>/; generate gatekeepers.json
                            and 15-runtime.json with exact roots, explicit plugin allow/load
                            entries and the primary install-policy executable. No npm packages
                            are published; source installation authorizes these artifacts.
                            Defaults grant no directories and allow no third-party installs.
[7/12] hooks                (none to install — internal hooks are plugin-declared by the kernel; enabled by config)
[8/12] reconcile            clawos config apply  (patch → doctor --lint → fingerprint)
[9/12] service              openclaw gateway install ; systemd drop-in with OPENCLAW_NO_AUTO_UPDATE=1, CLAWOS_CELL=default
                            systemctl --user enable --now openclaw-gateway.service ; loginctl enable-linger (prompted)
[10/12] verify              /startupz → /readyz (60 s) ; openclaw plugins list --json ; openclaw os status --json
[11/12] audit               openclaw security audit --deep --json → os/logs/security-audit.<ts>.json ; doctor --lint
[12/12] lockfile            os/clawos.lock.json written ; ~/.clawos/cells.json updated
```

Re-running is safe: every step checks its postcondition first.

### 10.4 Adopting an existing OpenClaw host

If OpenClaw is already installed (e.g. an existing ALINA-style host): `clawos adopt` runs steps 3–12 without touching the installed upstream version, records *that* version as the pin (refusing if it is outside the kernel's compat range and telling you to `openclaw update --tag <supported>` first), backs up `openclaw.json` before reconciling, and prints the diff of the baseline fragment against your current `tools`/`gateway` settings so you can decide which of your existing settings to move into `90-local.json5`. Existing agents keep working; they simply have no grants until you introduce resources. Existing `exec`/fs permissions are preserved only if you accept them into `90-local.json5` — by default the baseline denies them, which is the point.

### 10.5 Multi-cell (two firms on one host)

```bash
clawos cell create firmA --port 18801 --user clawos-firma
clawos cell create firmB --port 18802 --user clawos-firmb
clawos --cell firmA blueprint apply assistant --agent reception
clawos --cell firmA gatekeeper add github && clawos --cell firmA gatekeeper connect github
clawos cell list          # name, user, port, version, health, pending approvals
```

Each cell has its own state dir, token, key, plugins config, gatekeeper accounts, audit log, and unit; `clawos update --cell firmA` updates one cell at a time (the upstream binary is shared, so the *first* cell to update stages and verifies the new version; subsequent cells run steps 5–9 against the already-staged prefix). If you need different upstream versions per cell, install with `--per-cell-prefix`, which puts each cell's `openclaw` under `<stateDir>/os/npm-prefix` and points the unit's `PATH` at it.

### 10.6 Docker

For container hosts, `deploy/docker/` provides a `Dockerfile` that layers on `ghcr.io/openclaw/openclaw:<pin>` (**VERIFIED** image) — adding only the `@clawos/*` packages and the `clawos` binary, never modifying upstream layers — and a `compose.yml` that mounts `/home/node/.openclaw` (state, including `os/`) and runs `clawos install --in-container` at first start. Sandboxing inside Docker requires the Docker socket or `OPENCLAW_SANDBOX=1` per upstream's `scripts/docker/setup.sh` conventions; the compose file documents both.

### 10.7 Uninstall

`clawos uninstall [--cell <name>] [--keep-state]` stops the unit, disables OS plugins and hooks, reverts OS-owned config subtrees (from `config.generated.json`), removes the drop-in, and (without `--keep-state`) removes `<stateDir>/os/`. Upstream's service and data are removed with `openclaw uninstall --all --yes --non-interactive` (**VERIFIED** flags; the CLI package itself is removed separately via npm) only if you ask.

---

## 11. Operations runbook (summary; full text in `.agents/skills/clawos-operator`)

**Daily.** `clawos status` (or `/approvals` in chat) → approve/reject pending actions. `clawos audit tail --since 24h`.

**Introducing resources.** Paste a URL in chat as an operator, or `clawos grant add`. Agents may ask via `os_request_access`; pending requests show in `clawos approvals list --requests`.

**Updating.** `clawos update --check` (automated weekly) → `clawos update --to <version>` when convenient. Always after: `clawos status`, `openclaw security audit`. If anything is wrong: `clawos rollback`.

**Backups.** `clawos backup create` nightly via `openclaw cron` in the default cell (wraps `openclaw backup create --verify` + `os/` tar). Restore with `clawos backup restore <archive>` into a stopped cell.

**Troubleshooting.** `clawos doctor` first. Plugin not loading → `openclaw plugins inspect clawos-kernel --runtime --json`, then `openclaw gateway restart` (metadata snapshot is per-session). Config rejected → `config reload skipped (invalid config)` in logs → `openclaw doctor --fix`, then `clawos config apply`. Gate hook timing out → 15 s fail-closed budget; check gatekeeper network latency; `clawos gatekeeper health <vendor>`.

---

## 12. Open questions and risks

1. **Plugin API drift.** Declared experimental. Mitigation: narrow compat ranges, nightly matrix, conformance suite, and a thin SDK-facing layer in the kernel (`src/upstream/*.ts`) that is the *only* place SDK calls happen, so an API rename is a one-file change.
2. **Tool registration timing** (S-1). If tools cannot be registered after `register()`, the catalog-cache design in §5.1 applies; the cost is that adding a gatekeeper always needs a restart (already required by the metadata snapshot rule).
3. **Trusted tool policy semantics** (S-1). If not per-turn, tool narrowing relies on `before_prompt_build` alone plus the `before_tool_call` gate — still secure (the gate is the enforcement; narrowing is UX), but the model may see tool names it cannot use.
4. **Group-chat observers.** v1 sidesteps by refusing gatekeeper tools in shared sessions; v1.1 must map "observer identity" onto channel sender ids, which vary per channel.
5. **OAuth callback reachability** on loopback-bound gateways. Documented paths: Tailscale bind, or local browser on the host. A device-code flow is preferred wherever the vendor offers one (GitHub does).
6. **Upstream doctor migrations** may rewrite keys the OS owns (e.g. `tools.exec.security` → `tools.exec.mode`). Reconciliation after doctor handles it; fragment templates must track upstream's current key names — the conformance `config-reconcile` test catches this.

---

## Appendix A — Config fragments

`10-plugins.json5`:
```json5
{
  plugins: {
    entries: {
      "clawos-kernel": { enabled: true, config: {
        operators: [],                       // [{channel:"telegram", senderId:"…"}], filled by `clawos operator add`
        autoApprove: [],                     // ["github.issue.comment"]
        install: { allowSources: ["npm:@clawos/*", "clawhub:@clawos/*"] },
        egress: { denyPatterns: ["(?i)api[_-]?key\\s*[:=]", "grant:[a-z0-9]{8}"] },
        audit: { llm: false },
      } },
      "gatekeeper-fs": { enabled: true, config: { roots: [] } },   // ["/home/matt/projects"] — grants are subpaths
    },
  },
}
```

`20-sandbox.json5`:
```json5
{ agents: { defaults: { sandbox: { mode: "non-main", scope: "agent", backend: "docker", workspaceAccess: "ro" } } } }
```

`30-agents.json5` (written by `clawos blueprint apply`):
```json5
{ agents: { entries: { dev: { workspace: "~/.openclaw/agents/dev/workspace",
  tools: { allow: ["group:fs", "exec"] }, sandbox: { mode: "all" }, skills: ["github"] } } } }
```

## Appendix B — Gatekeeper skeleton (kit-based)

```typescript
// packages/gatekeeper-github/src/index.ts
import { defineGatekeeper } from "@clawos/gatekeeper-kit";
import { Type } from "typebox";
import { GitHubVendor } from "./vendor.js";

export default defineGatekeeper({
  vendor: "github", apiVersion: 1,
  id: "gatekeeper-github", name: "GitHub Gatekeeper",
  description: "Mediates agent access to GitHub repositories, issues, and pull requests.",
  createVendor: (ctx) => new GitHubVendor(ctx),          // ctx: pluginConfig, tokenStore, cache, logger, http
  resources: [
    { type: "repo",  urlPattern: "https://github.com/:owner/:repo",                title: "GitHub Repository",
      description: "Read files, issues, and pull requests; create issues and comments.", grantable: true,
      observerStrategy: "acl-check", tools: ["gk_github_repo_get", "gk_github_repo_list_issues", "gk_github_issue_create", /*…*/] },
    { type: "issue", urlPattern: "https://github.com/:owner/:repo/issues/:number", title: "GitHub Issue", description: "…",
      grantable: true, observerStrategy: "acl-check", tools: ["gk_github_issue_get", "gk_github_issue_comment"] },
    { type: "pull",  urlPattern: "https://github.com/:owner/:repo/pull/:number",   title: "GitHub Pull Request", description: "…",
      grantable: true, observerStrategy: "acl-check", tools: ["gk_github_pull_get", "gk_github_pull_diff", "gk_github_pull_comment"] },
  ],
  tools: [
    { name: "gk_github_repo_list_issues", resourceType: "repo", kind: "observation",
      description: "List open issues in the repository.",
      parameters: Type.Object({ grant: Type.String(), state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed")])) }) },
    { name: "gk_github_issue_comment", resourceType: "issue", kind: "action",
      description: "Add a comment to the issue.",
      parameters: Type.Object({ grant: Type.String(), body: Type.String() }) },
  ],
});
```

```typescript
// packages/gatekeeper-github/src/issue.ts (excerpt: an action with simulation)
export class IssueGatekeeper extends KitGatekeeper<IssueState> {
  // describe() runs in the kernel's dry pass; apply() runs for real on applyAction()
  actions = {
    gk_github_issue_comment: {
      describe: (p) => ({ title: `Comment on issue #${this.number}`, description: `> ${p.body}`,
        actionKind: { tag: "github.issue.comment", label: "Comment on issue" },
        autoApprovable: !containsMention(p.body), implementsRevert: true }),
      simulate: (p, overlay) => overlay.appendComment({ id: overlay.nextTempId(), body: p.body, author: "you", pending: true }),
      apply:    (p) => this.api.createComment(this.owner, this.repo, this.number, p.body),
      revert:   (rec) => this.api.deleteComment(this.owner, this.repo, rec.remoteId),
    },
  };
  observations = {
    gk_github_issue_get: async (_p, queue) => {
      const issue = await this.cache.get(() => this.api.getIssue(this.owner, this.repo, this.number));
      await queue.authorizeObservation({ title: `Read issue #${this.number}`, description: issue.title });
      return this.overlay.applyTo(issue);            // pending comments appear as if posted
    },
  };
  async addObserver(_id: string, verifier: ObserverVerifier) {
    if (!(await GitHubVerifier.from(verifier).hasRepoAccess(this.owner, this.repo)))
      throw new Error("This participant does not have read access to the repository.");
  }
}
```

## Appendix C — Glossary

**Cell** — one OpenClaw Gateway instance = one trust boundary, managed as a unit. **Gatekeeper** — a driver plugin mediating all access to one external service. **Grant** — a capability record giving one agent access to one resource through one gatekeeper. **Introduction** — the act of creating a grant (URL paste, CLI, or agent request approved by an operator). **Handle** — the opaque `grant:…` string the agent uses. **Observation** — a read; authorized synchronously and logged. **Action** — a write; queued, simulated, applied later. **Overlay** — the gatekeeper's record of pending actions merged into reads. **Operator** — a human allowed to introduce resources and decide actions in a cell. **Observer** — a non-operator participant in a session. **Blueprint** — a versioned agent template. **Pin** — the upstream version recorded in `clawos.lock.json`. **Reconciliation** — applying `os/config.d/*` to `openclaw.json` via `openclaw config patch`.

## Appendix D — Sources (verified 2026-09-06)

Cloudflare OS: `README.md`, `AGENTS.md`, `REVIEW.md`, `.agents/skills/write-gatekeeper/SKILL.md` and `SKELETON.md`, `packages/workshop-shared/src/gatekeeper.ts`, `packages/workshop-backend/src/{auth/auth-vendors.ts,auto-approval.ts,overseer.ts,env.d.ts}`, `packages/gatekeeper-github/src/github.ts`, `docs/observers.md`, `docs/oauth-signin.md`, `plans/gatekeeper-kit.md`, `plans/multi-gadget.md` — https://github.com/cloudflare/cloudflare-os. Starter: `README.md`, `docs/customization.md`, `deployment.jsonc`, `scripts/deploy.ts`, `pnpm-workspace.yaml`, `packages/custom-gatekeeper/` — https://github.com/cloudflare/cloudflare-os-starter.

OpenClaw docs (https://docs.openclaw.ai): `concepts/architecture`, `concepts/multi-agent`, `concepts/agent-workspace`, `gateway/configuration`, `gateway/configuration-reference`, `gateway/config-tools`, `gateway/security`, `gateway/sandboxing`, `gateway/doctor`, `tools`, `tools/plugin`, `tools/skills`, `tools/exec-approvals`, `plugins/building-plugins`, `plugins/sdk-overview`, `plugins/sdk-entrypoints`, `plugins/hooks`, `plugins/manage-plugins`, `plugins/architecture`, `automation/hooks`, `cli`, `cli/config`, `cli/plugins`, `cli/cron`, `install`, `install/updating`, `install/development-channels`, `install/docker`, `platforms/linux`, `help/environment`; npm registry metadata for `openclaw` (dist-tags `latest=2026.9.2`, `beta=2026.9.1`, `extended-stable=2026.6.34`).

### Phase 3 install-policy correction (2026-09-08)

The source-distributed CLI now bundles first-party plugins and projects cell-local
runtime/catalog paths. `15-runtime.json` is generated; operator overrides stay in
`90-local.json5`. No registry publication or upstream-directory write is needed.
The primary config is `security.installPolicy.enabled` plus `exec.source="exec"`,
an absolute regular Node command and protected cell-local policy script, with static cell
selection; the earlier unqualified `command` examples are superseded. Both policy
paths share the documented `request.requestedSpecifier` / staged-material evaluator,
not guessed `source` and `hash` fields. Empty allowlists fail closed; optional
`sha256:` rules apply to measured regular staged files <=16 MiB only, never directory
labels. `plugins.allow` is an explicit positive allowlist; do not enumerate an
unbounded universe of absent plugin ids into `plugins.deny`. Existing explicit deny
entries continue to take precedence. Filesystem roots remain empty by default.
Primary live CLI install acceptance, shared evaluator regressions and the
secondary hook typecheck are separate; no hook-backed Gateway install claim
follows from CLI evidence.
