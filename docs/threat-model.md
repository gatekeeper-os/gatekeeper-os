# Threat model

What OpenClaw OS defends against, how, and what it deliberately does not claim. Every "how" below names the code that enforces it, so a reviewer can check the claim rather than take it on faith. Status of each mechanism is as of the Phase 3 acceptance (`plans/phase-3-acceptance.md`) and the Phase 4 candidate.

## Assets

- **Operator credentials** held by gatekeepers (OAuth tokens, static keys). Encrypted at rest in the driver's own store; never passed to the model, never in tool results, never in logs.
- **Resource data** the operator introduced (file contents, issues, comments).
- **Side effects** on external services (comments, issues, reviews) and, in principle, on the host filesystem.
- **The audit trail** as evidence of what happened.

## Adversaries

1. **The agent itself, steered by a hostile input** — prompt injection through a message, a file it read, or a tool result. The agent may try to reach resources it wasn't given, act without review, or exfiltrate what it read.
2. **A non-operator participant** in a channel the agent is bound to (a group chat member, a forwarded message) trying to introduce resources or read data they aren't entitled to.
3. **A misbehaving or buggy plugin** in the same Gateway, including another OS plugin.
4. **A supply-chain vector**: a plugin or skill installed from an untrusted source.

## Defenses (and where they live)

**Access to nothing by default.** Gatekeeper tools are only submitted to the model when the agent holds an active grant for that resource type in this session and audience — `Kernel.onBeforePromptBuild` narrows `toolsAllow` to `os_request_access`, `os_list_grants`, and the `gk_*` tools of granted types. Narrowing is UX; enforcement is below.

**Every gatekeeper call resolves a grant, twice.** A host-level trusted tool policy (`Kernel.capabilityPolicy`, registered with `registerTrustedToolPolicy`) denies any `gk_*` call whose `params.grant` is not an active handle authorized for this agent, session and audience — it runs before every `before_tool_call` hook and cannot be bypassed by hook ordering or another plugin. Then `Kernel.onBeforeToolCall` calls `resolveGrant`, the single chokepoint that turns a handle into a live gatekeeper session (INVARIANT: no other code path may). Calls with no `toolCallId`, `agentId` or `sessionKey` fail closed.

**Only operators introduce resources.** URL introductions in `before_agent_run` require `senderIsOwner`; non-owners are recorded as observers of the session instead. `os.grants.introduce` over RPC requires an authenticated paired operator with write scope. `os_request_access` from the agent only records a *pending* request that an operator must approve. A pasted URL from anyone else is inert.

**Owner-only audience in beta.** Every grant is `owner-only`. If a session has any observer (a non-owner has spoken, or the audience is unknown), gatekeeper tools are not offered, `resolveGrant` refuses, and `authorizeObservation`/`submitAction` throw. `prohibitAllSharing` on an observation moves the grant and instance into lockdown. Shared grants cannot be created or used in beta.

**Reads are authorized and logged.** The kit calls `queue.authorizeObservation()` before returning any read; the kernel's queue re-checks the grant, lockdown and audience, then writes an `observation` audit record. The `fs` driver additionally re-authorizes after the read completes so a revocation mid-read releases nothing.

**Writes are queued, simulated, and applied only on decision.** `KitGatekeeper.startSession` runs a side-effect-free `describe()` dry pass, then on the real call: `submitAction()` → journal `pending` → `simulate()` into the overlay. Subsequent reads merge the overlay (`OverlayStore.applyTo`), so the agent sees its pending comment or file. `applyAction` runs at most once, in id order, after `os.approvals.apply` / `clawos approvals apply` / `/approvals apply` by an authorized operator; `rejectAction` drops the overlay entry; `revertAction` uses only the recorded remote id. Ambiguous outcomes (submit or apply threw) are journaled `uncertain` and block further actions on that resource until reconciled — never blindly retried. Auto-approval applies only when the operator configured the action kind *and* the driver marked that specific action `autoApprovable` (`ActionCoordinator.drain`).

**Synchronous approval is opt-in and currently off.** A driver may mark an action `awaitDecision`; the kernel maps it to OpenClaw's native `requireApproval`. The GitHub driver exposes this only via the operator-configured `synchronousActions` list, default empty — see "Known upstream issue".

**Egress policy.** `message_sending` cancels any outbound message matching `egress.denyPatterns` (grant handles and key-like strings by default) and audits the block.

**Install gate.** `security.installPolicy` → `clawos install-policy` evaluates `install.allowSources` / `allowHashes`; `before_install` re-checks and blocks on mismatch. Verified live against a community plugin fixture; note the documented upstream bypass for trusted official plugins (`plans/plugin-install-hook-gap.md`).

**Tool results and errors are sanitized.** Every registered execute callback is wrapped by the kernel's `runTool`; a thrown error becomes a generic `details.status:"error"` result. Drivers use `sanitizeError()`/`sanitizedFailure()` so vendor bodies, URLs and tokens don't reach the model.

**Audit is not a transcript.** Records hold timestamps, cell, agent, session, kind, vendor, resource type, handle, action id, title, decision, duration and ok — never prompts, headers, tokens or bodies. CI greps source and VM artifacts for credential and body canaries.

## What it does not defend against

- **Prompt injection is not eliminated.** A hostile file or issue the agent is *allowed* to read can still steer it. The OS limits what a steered agent can reach (granted resources only) and what it can do without review (nothing external). It does not make the agent trustworthy.
- **Plugins are trusted code.** Native plugins, including this kernel and every gatekeeper, run unsandboxed inside the Gateway process. A malicious plugin can do anything the Gateway can. Use OpenClaw's `plugins.deny` allowlisting and the install policy; do not install drivers you haven't read.
- **No hostile multi-tenancy inside one Gateway.** Upstream is explicit about this and so are we. Mutually distrusting parties get separate cells (separate state dirs, tokens, units, ideally separate Unix users or hosts).
- **Filesystem writes are simulate-only.** `gk_fs_file_write` queues and simulates; `applyAction` for the fs driver currently denies because race-safe confinement (hardlinks, parent replacement) is not proven under the approved contract. Pending effects can be inspected and rejected, never applied to disk. This is a deliberate limit, not a bug.
- **Observer verification beyond "deny all" is not live.** Strategies B/C/D from the design are not enabled; every grant is owner-only.
- **Real-transport channel isolation is only partly validated.** Owner/observer handling is proven with synthetic public-SDK ingress and the Control UI; real Telegram validation is deferred, and Slack is untested.
- **The agent's own workspace, `exec`, and non-gatekeeper tools** are governed by OpenClaw's normal tool policy and sandbox settings, which the baseline config denies and blueprints re-enable deliberately. The OS does not mediate them.

## Known upstream issue

On unmodified OpenClaw 2026.9.2 (same path in 2026.9.4), when a native `requireApproval` is **denied** or has **no approval route**, the Gateway logs the tool's raw arguments before any plugin code runs (`BeforeToolCallFailureError` is not treated as a safe veto, unlike `BeforeToolCallBlockedError`). The deferred path is unaffected. Until upstream ships a fix, keep `synchronousActions` empty (the default). Report: `plans/upstream-native-approval-logging.md`.

## Reporting

See `SECURITY.md`. Anything that lets an agent exceed a grant, perform an unreviewed external effect, leak a credential or body into logs or results, or lets a non-operator introduce or decide, is in scope.
