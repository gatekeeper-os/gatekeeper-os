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
| c | Allowed characters / max length for plugin tool names | register `gk_a_b_c`, 64/65-char names and dotted name; observe load and actual model schemas | PARTIAL: all tested names reached the local model before narrowing was fixed. This is not a provider-portable character/length guarantee; no universal limit established. | §3.4 |
| d | Does the manifest tolerate unknown top-level keys (`clawos`)? | actual probe load + `os-spike.report`; retain negative authoring-validator output | VERIFIED for pinned release: `clawos` did not prevent load/RPC. `plugins validate` instead rejects ordinary entries lacking generated authoring metadata; use metadata inspection and separate runtime checks. | §4.2, §8 |
| e | Does `before_prompt_build` `toolsAllow` remove model schemas? | inspect `llm_input` and the local model's structural tool-name log | VERIFIED in recovered run: 20 hook observations and 40 requests contained only `probe_echo`, after discovery registration and ordinary prompt phase correction. Complete retest verdict below. | §5.2 |
| f | Is `toolCallId` present and correlated for plugin tools? | 20 scripted calls; record hook identity flags and stash consumption | VERIFIED on tested path: 20/20 hooks have call/agent/session identity; 20/20 executions consume matching entries from the SDK shared runtime store. Optional SDK fields still require fail-closed checks. | §5.1–2 |
| g | Which paired operator identity fields are populated? | two connections via public SDK `GatewayClient`, second using SDK-issued device token | VERIFIED: role/scopes and `connect.device.id`; device-token reconnect sets `isDeviceTokenAuth`. `pairedClientId` and `authenticatedUserId` absent on both; shared-auth operator role alone does not imply pairing. | §5.4 |
| h | Own SQLite while Gateway runs? | public Node resolver, open/write/query/close `os/probe.sqlite` at startup | VERIFIED on Node 24.20.0; static import failed loader, `createRequire('node:sqlite')` succeeded. | §5.3 |
| i | Can late registration expose tools? | `registerTool` at `gateway_start`; actual model schema observation | VERIFIED tested path: registration returns successfully but `probe_late` absent from model schemas. Existing catalog-cache fallback selected. | §5.1 |
| j | How to enumerate loaded manifests? | record API/runtime root keys; inspect pinned public SDK references; metadata snapshot CLI | PARTIAL: no live in-process enumerator verified. CLI metadata inspection is not a loaded-runtime registry. Existing OS-owned catalog fallback is selected for static tool shapes; live gatekeeper attachment still needs a verified contract. | §4.2 |
| m | Install-policy protocol? | absolute executable, block/malformed/allow fixture installs | VERIFIED prior complete runs: version-1 JSON input/output; block and malformed denied; allow installed. Interrupted run completed only block evidence; complete retest below. | §7.5 |

## 2026-09-07 preliminary run — not a completed spike

Command: `CLAWOS_VM_DRIVER=libvirt scripts/vm/test.sh phase-0`.
Snapshot: `base`; artifacts: `vm-artifacts/20260907-183938-phase-0/`.
Node `v24.20.0`; upstream `OpenClaw 2026.9.2`; foreground `/readyz` passed.
`openclaw gateway call os-spike.report --json` failed with `INVALID_REQUEST`,
`unknown method: os-spike.report`. Guest plugin diagnostic:
`spike-probe failed to load ... Error: Cannot find module 'sqlite'`.
The probe statically imported the public Node built-in `node:sqlite`; no upstream
file was edited. Next run will load that built-in through Node's public
`createRequire()` inside the lifecycle callback, isolating the failure to item h
instead of preventing every other probe from loading. This is a hypothesis,
not a VERIFIED result. All S-1 questions remain open.

## 2026-09-07 — final run and mandatory early stop

Every run used the exact host command:

```bash
CLAWOS_VM_DRIVER=libvirt scripts/vm/test.sh phase-0
```

The wrapper restored `base`, synced the tree to `/home/tester/src`, invoked
`bash test/phase-0.sh` as `tester` in Ubuntu 24.04, collected evidence and exited 1.
The command was run three times, with distinct known changes:

| Artifact directory under `vm-artifacts/` | Outcome |
|---|---|
| `20260907-183938-phase-0/` | Node/pinned upstream and readyz passed; static SQLite import prevented probe load; RPC unknown method. |
| `20260907-184301-phase-0/` | Public Node resolver fixed SQLite; 20 tool executions; conversation hooks denied registration without explicit opt-in; zero tool-hook correlation. |
| `20260907-184712-phase-0/` | Added documented conversation opt-in and explicit tool matchers; still zero callbacks and zero narrowing; policy protocol passed. STOP. |

Exact key commands inside the final VM run (see `test/phase-0.sh` for complete sequence):

```bash
bash /home/tester/upstream-install.sh --no-onboard --no-prompt --version 2026.9.2
node --version
openclaw --version
pnpm install --frozen-lockfile
pnpm --filter spike-probe build
node scripts/spike-config.mjs
openclaw config validate
node scripts/spike-model.mjs
openclaw gateway run
curl -fsS http://127.0.0.1:19100/readyz
openclaw gateway call os-spike.report --json
# n=1..20, fresh session id per CLI invocation:
openclaw agent --agent main --session-id "spike-turn-$n" --message 'Run the available probe once.' --json
# mode=block, malformed, allow; each followed by validate + fixture install:
node scripts/spike-policy-config.mjs "$mode"
openclaw config validate
openclaw plugins install ./test/fixtures/install-policy-probe --force --accept-capabilities
node scripts/spike-assert.mjs
```

All Gateway invocations received explicit `OPENCLAW_STATE_DIR` and
`OPENCLAW_CONFIG_PATH` pointing to `/home/tester/clawos-spike-state`, never host
production paths. Authentication values were generated within the VM config
writer and were not arguments, shell variables, logs or artifacts.

Final results (`summary.json`, `assertions.json`, `hook-config.json`):

```text
Node v24.20.0; OpenClaw 2026.9.2
PASS foreground-gateway-ready
20 tool executions; 20 toolCallIds; 0 correlated hook entries
0 before_tool_call events; 0 llm_input events
40 model requests; probe_late absent; dotted and 65-character names present
PASS install-policy-block
PASS install-policy-malformed
PASS install-policy-allow
PASS sqlite-owned-store
FAIL twenty-correlated-tool-calls
FAIL twenty-tool-hooks-with-identity
FAIL model-tools-narrowed
PASS operator-client-observed
exit 1
```

The live entry was `{"enabled":true,"hooks":{"allowConversationAccess":true}}`.
The third run had no blocked-hook registration diagnostics. This distinguishes
the final blocker from the missing-permission configuration error in run two.

**What is and is not established:** the plan's mandatory stash mechanism cannot
be validated on this scripted Gateway path. The root cause is not established;
no claim is made that every upstream runner or channel lacks these callbacks,
or that an implemented kernel was bypassed (there is no implemented kernel yet).
The callbacks would have to be verified before relying on them. Under the
kickoff and `docs/agent-operating-rules.md` §7, this ends the run; no hook bypass,
private upstream import, monkey-patch or upstream patch was attempted.

`plans/PROGRESS.md` records remaining acceptance and the next inspection command.

## 2026-09-07 — continuation: registration-mode root cause

Matt authorized continuation. Read-only source diagnosis and fresh-base run
`vm-artifacts/20260907-190118-phase-0/` confirmed:

- Same Gateway PID: startup/RPC saw `before_tool_call=1`, `llm_input=1`;
  tool bodies saw zero of both (and zero prompt hooks).
- The agent runtime uses an exact discovery-mode registry for hook lookup.
  The supplied `if (api.registrationMode !== "full") return` leaves it empty.
  Tool lookup can separately fall back to startup registrations, explaining
  working tool bodies with no hooks.
- The probe now declares inert tools/hooks in full/discovery/tool-discovery;
  it starts no services or filesystem writes during discovery registration.
  Full-only lifecycle work remains below the capability declarations.
- The supplied `requiresToolAuthority: true` also selected the wrong prompt
  phase. Pinned `docs/plugins/hooks.md` explicitly forbids changing `toolsAllow`
  in post-policy enrichment. Narrowing now uses ordinary `before_prompt_build`.

Read-only hook counts use the public (deprecated) SDK `plugin-runtime` barrel,
not an internal import, patched runner, or manual hook invocation.

Run `20260907-190538-phase-0` verified `pnpm dev:gateway --smoke` readiness and
shutdown, then stopped at the newly exercised authoring validator:
`plugins validate --root scripts/spike-probe --entry dist/index.js --json`
rejects ordinary `definePluginEntry` with “plugin entry does not expose tool or
feature authoring metadata”. This is not a `clawos` unknown-key rejection.
The next acceptance retains that exact negative result and checks actual runtime
load through the probe RPC. No failure was relabeled as successful validation.

Fresh-base corrected runtime retest pending; no phase advancement or tag.

## 2026-09-07 — interrupted continuation recovery

`20260907-191508-phase-0` was explicitly canceled before a run log.
`20260907-191546-phase-0` has no acceptance exit code and no `assertions.json`:
**overall outcome UNKNOWN**, not a pass. Following the Gateway restart, no test
process remained. The guest structural evidence was recovered using:

```bash
CLAWOS_VM_DRIVER=libvirt scripts/vm/collect.sh vm-artifacts/20260907-191546-phase-0 '2026-09-07T19:15:46Z' phase-0
```

Recovered files establish 20 hooks, 20 correlated tool bodies, 20 narrowed
`llm_input` observations, 40 narrowed actual model requests, and a successful
paired-device-token reconnect. Install-policy evidence stops after `block`.
No assertions were rerun in the dirty guest or used to invent a missing exit code.

Fresh-base run `20260907-192247-phase-0` exited **1** before the runtime spike.
The prepared metadata validator found a real scaffold defect: `gatekeeper-http`
and `gatekeeper-mcp` manifests lacked required `configSchema`, even when disabled.
Pinned `docs/plugins/manifest.md` lists that field as mandatory. Both Phase-8
placeholders now declare an empty closed object schema; no tools, resources,
URLs, credentials, or runtime implementation were added. The repository's
`write-gatekeeper` skill was checked; neither tool-surface STOP was reached.
The metadata result now uses the Node entry directly so its `.json` artifact is
JSON rather than pnpm's console preamble. Metadata success is never called
runtime conformance for these placeholder plugins.

## 2026-09-07 — completed fresh-base retest: live spike PASS

Exact acceptance command: `CLAWOS_VM_DRIVER=libvirt scripts/vm/test.sh phase-0`.
Artifacts: `vm-artifacts/20260907-192654-phase-0/`; snapshot `base`;
Ubuntu 24.04 / Node 24.20.0 / OpenClaw 2026.9.2. Wrapper and collection exited **0**.

```text
PASS workspace-plugin-metadata (5/5; snapshot only)
PASS dev-gateway-start-stop
PASS foreground-gateway-ready
PASS scripted-turn-1 through scripted-turn-20
PASS paired-client-identity-and-device-token-reconnect
PASS install-policy-block / malformed / allow
PASS sqlite-owned-store
PASS twenty-correlated-tool-calls
PASS twenty-tool-hooks-with-identity
PASS model-tools-narrowed (20 llm_input observations)
PASS actual-model-requests-narrowed (40 requests; only probe_echo)
PASS paired-device-token-auth
PASS operator-client-observed
exit 0
```

`assertions.json` contains seven true results; `plugin-metadata.json` contains
five successful metadata-only results. `paired-client.json` contains only
identity-presence flags, roles/scopes and auth-mode booleans, never tokens or IDs.
The authoring-validator rejection remains explicitly preserved in
`probe-validation.json`; it is not reported as successful authoring validation.
The collector's secret scan passed. After completion, guest ports 19100, 19101
and 19110 were verified unbound before requesting dedicated-VM shutdown.

**Remaining gates:** c (portable tool-name character/length bounds) and j (live
manifest discovery/vendor attachment) remain partial. Do not turn the tested
names into a universal provider guarantee, or mistake a disabled metadata
snapshot for a live registry. No Git remote or live CI run exists. The kernel
source remains a scaffold, not a verified security implementation. Phase 0 is
not complete or tagged; no later phase or gatekeeper review STOP was entered.
