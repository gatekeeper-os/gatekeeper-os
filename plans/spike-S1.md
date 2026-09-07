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
| c | Allowed characters / max length for plugin tool names | register `gk_a_b_c`, a 64-char name, a dotted name; observe load diagnostics | PARTIAL: dotted, 64-char and 65-char names registered and reached model schemas; universal character/length boundary not established. | §3.4 |
| d | Does the manifest tolerate unknown top-level keys (`clawos`)? | `openclaw plugins validate` + load with the key present; check `plugins inspect --json` diagnostics | PARTIAL: plugin loaded with clawos metadata and RPC executed; separate plugins validate run pending. | §4.2 |
| e | Does `before_prompt_build` `toolsAllow` remove tool schemas from the model request? | inspect the `llm_input` payload | BLOCKED: zero llm_input callbacks; 40 actual local-model requests retained the unnarrowed tool catalog, despite conversation opt-in. | §5.2 |
| f | Is `toolCallId` always present on `before_tool_call` for plugin tools? | log the event for 20 calls (probe writes `f:before_tool_call`) | BLOCKED: 20 tool bodies had toolCallId but zero before_tool_call callbacks; 20/20 lacked stash correlation, including with explicit matcher. | §5.2 |
| g | Which identity fields are populated on `GatewayClient` for a paired operator (`pairedClientId`, `authenticatedUserId`, `connect.role`)? | probe method `os-spike.report` logs `client` keys | PARTIAL: shared-auth CLI client had operator role/scopes; pairedClientId/authenticatedUserId/device absent. Paired-device path untested. | §5.4 |
| h | Can a plugin open its own SQLite under `OPENCLAW_STATE_DIR` while the gateway holds its DB? | probe opens `os/probe.sqlite` at `gateway_start` | VERIFIED: createRequire(node:sqlite) opened/wrote/queried/closed os/probe.sqlite while Gateway ran. Static import failed loader. | §5.3 |
| i | Can tools be registered after `register()` (at `gateway_start`)? | probe attempts late `api.registerTool` | VERIFIED for tested path: late registerTool returned successfully, but probe_late absent from all 40 model requests. Catalog-cache fallback selected. | §5.1 |
| j | How does a plugin obtain the list of loaded plugin manifests (for gatekeeper discovery)? | explore `api.runtime` keys logged by the probe; else use the `os/gatekeepers.json` catalog | PARTIAL: API/runtime key names recorded; no direct registry accessor in root keys. No claim about unexplored nested surfaces. | §4.2 |
| m | Does `security.installPolicy` accept a command like `clawos install-policy` and what is its stdin/stdout contract? | read `docs/gateway/security` in the installed package; test with a dummy policy | VERIFIED: absolute executable; protocolVersion 1 JSON stdin/stdout; block and malformed denied; allow installed (evaluated twice). | §7.5 |

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
