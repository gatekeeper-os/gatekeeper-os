# Threat model

What GatekeeperOS defends against, how, and what it deliberately does not claim. Every "how" below names the code that enforces it, so a reviewer can check the claim rather than take it on faith. Reviewed against `main` at `4427e32` and the unmerged [Phase 4 candidate, PR #6](https://github.com/gatekeeper-os/gatekeeper-os/pull/6) at `bad84f2`. Phase 3 acceptance is recorded in `plans/phase-3-acceptance.md`; GitHub-specific behavior and `runTool` below belong to that candidate, not current `main`. Neither this document nor passing CI advances a phase.

## Assets

- **Operator credentials** held by gatekeepers (OAuth tokens, static keys). Account records using `gatekeeper-kit/src/token-store.ts` are AES-256-GCM encrypted and bound to the canonical store and operator identity. Keeping credentials out of model results and logs is a requirement, not protection against a compromised Gateway process or host holding the cell key.
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

**Gatekeeper calls have layered grant checks.** A host-level trusted tool policy (`Kernel.capabilityPolicy`, registered with `registerTrustedToolPolicy`) denies any `gk_*` call whose `params.grant` is not an active handle authorized for this agent, session and audience — it runs before `before_tool_call` hooks, so a later hook cannot override its denial in the supported tool pipeline. This is not isolation from malicious in-process plugins. Then `Kernel.onBeforeToolCall` calls `resolveGrant`, the single chokepoint that turns a handle into a live gatekeeper session (INVARIANT: no other code path may). `exec` additionally consumes a one-use stash bound to tool name and exact parameters and rechecks current grant/audience authority. Calls with no `toolCallId`, `agentId` or `sessionKey` fail closed.

**Tool ownership and catalog admission.** The kernel no longer registers gatekeeper tools on their behalf. Kit-owned wrappers register each gatekeeper's exact `contracts.tools` under that gatekeeper's plugin identity and delegate every execution to the kernel runtime. `defineGatekeeper()` and the kernel registry validate manifest/definition/catalog parity. Adding an enabled gatekeeper to a cell catalog admits that plugin's declared tools into the cell's messaging policy on config apply; it does not create a grant. Kernel prompt narrowing and execution-time grant checks still apply. Explicit runtime-cell allowlists, native denials and sandbox policy are unchanged.

**Only operators introduce resources.** URL introductions occur in `Kernel.onReplyDispatch`, using `resolveChannelTurnAuthority`: a private audience and trusted owner identity are required; external channels additionally require the configured operator allowlist. Control UI authority comes from Gateway-owned admin scope and device identity. `before_agent_run` is a maintenance/observer gate, not the introduction hook. `os.grants.introduce` over RPC requires an authenticated paired operator with write scope. `os_request_access` from the agent only records a *pending* request that an operator must approve. A pasted URL from anyone else is inert.

**Owner-only audience in beta.** Every grant is `owner-only`. If a session has any recorded observer (including the shared-audience marker for group/channel or non-direct external dispatch), gatekeeper tools are not offered, `resolveGrant` refuses, and `authorizeObservation`/`submitAction` throw. `prohibitAllSharing` moves the grant and instance into lockdown only when an observation is attempted with recorded observers; a private read does not itself lock the resource. Shared grants cannot be created or used in beta.

**Reads are authorized and logged.** The kit calls `queue.authorizeObservation()` before returning any read; the kernel's queue re-checks the grant, lockdown and audience, then writes an `observation` audit record before the driver reads. That entry records authorization, not proof the later read succeeded. The `fs` driver additionally re-authorizes after the read completes so a revocation mid-read releases nothing.

**Deferred writes are queued, simulated, and applied only on decision.** `KitGatekeeper.startSession` runs a side-effect-free `describe()` dry pass, then on the real call: `submitAction()` → journal `pending` → `simulate()` into the overlay. Subsequent driver reads merge pending effects (`OverlayStore.applyTo` is the kit helper; the filesystem driver merges its entries directly), so the agent sees its pending comment or file. `applyAction` runs at most once, in id order, after `os.approvals.apply` / `gkos approvals apply` / `/approvals apply` by an authorized operator; `rejectAction` drops the overlay entry; `revertAction` uses the journaled remote id and original parameters, not a caller-selected deletion target. Ambiguous outcomes (submit or apply threw) are journaled `uncertain` and block further actions on that resource until reconciled — never blindly retried. Auto-approval applies only when the operator configured the action kind *and* the driver marked that specific action `autoApprovable` (`ActionCoordinator.drain`).

**Synchronous approval is opt-in and off by default.** A driver may mark an action `awaitDecision`; the kernel maps it to OpenClaw's native `requireApproval`. The GitHub driver exposes this only via the operator-configured `synchronousActions` list, default empty. After native allow-once, the kit applies directly rather than simulating; exact tool/call/parameter binding and one-use approval consumption are checked. The candidate kernel persists unconfirmed intent before the effect and marks it applied only on successful completion (`ApprovalQueueImpl.settleSynchronous`). Denial never authorizes execution — see "Known upstream issue".

**Egress policy.** `message_sending` cancels any outbound message matching `egress.denyPatterns` (the generated kernel config in `gkos-cli/src/util/plugins.ts` supplies a grant-handle pattern, not key-like-string patterns) and audits the block. This covers messages traversing that hook, not arbitrary network egress, encoded exfiltration, or nonmatching sensitive data.

**Install gate.** `security.installPolicy` → `gkos install-policy` evaluates `install.allowSources` / `allowHashes`; `before_install` re-checks and blocks on mismatch. Verified live against a community plugin fixture; note the documented upstream bypass for trusted official plugins (`plans/plugin-install-hook-gap.md`).

**Kernel-routed errors are sanitized.** Kit-owned tool wrappers delegate to the kernel runtime, which uses `runTool`; a thrown error becomes a generic `details.status:"error"`, `isError:true` result, optionally carrying bounded numeric provider HTTP status. Drivers use `sanitizeError()`/`sanitizedFailure()` to discard raw exception bodies, URLs and tokens. Successful authorized reads intentionally return resource contents to the model; this is not blanket result-content filtering. Upstream failures before execute are outside this wrapper.

**Audit is not a transcript.** The closed `AuditRecordSchema` permits metadata fields (including operator `by`) and rejects extra body/header fields. `AuditLog.write` validates shape, not arbitrary text inside allowed fields such as `title`: reviewed drivers must keep those fields payload-free. The log is append-only by application convention, not tamper-evident against its Unix owner. Action journals, previews, overlays and caches are separate state and can contain resource bodies. CI scans for credential-like strings; dedicated VM canary scans test body secrecy, and the upstream cases below currently fail.

## What it does not defend against

- **Prompt injection is not eliminated.** A hostile file or issue the agent is *allowed* to read can still steer it. The OS limits what a steered agent can reach (granted resources only) and what it can do under operator policy (including eligible actions explicitly auto-approved by the operator, without per-action review). It does not make the agent trustworthy.
- **Plugins are trusted code.** Native plugins, including this kernel and every gatekeeper, run unsandboxed inside the Gateway process. A malicious plugin can do anything the Gateway can. Use OpenClaw's `plugins.allow` allowlist, `plugins.deny` denylist, and the install policy; do not install drivers you haven't read.
- **No hostile multi-tenancy inside one Gateway.** Upstream is explicit about this and so are we. Mutually distrusting parties get separate cells (separate state dirs, tokens, units, ideally separate Unix users or hosts).
- **Filesystem writes are simulate-only.** `gk_fs_file_write` queues and simulates; `applyAction` for the fs driver currently denies because race-safe confinement (hardlinks, parent replacement) is not proven under the approved contract. Pending effects can be inspected and rejected, never applied to disk. This is a deliberate limit, not a bug.
- **Observer verification beyond "deny all" is not live.** Strategies B/C/D from the design are not enabled; every grant is owner-only.
- **Real-transport channel isolation is only partly validated.** Owner/observer handling is proven with synthetic public-SDK ingress and the Control UI; real Telegram validation is deferred, and Slack is untested.
- **The agent's own workspace, `exec`, and non-gatekeeper tools** are governed by OpenClaw's normal tool policy and sandbox settings, which deny runtime/filesystem/automation groups and browser in the baseline (`config/config.d/00-baseline.json5`). Blueprint declarations propose selected tools and sandboxing; their effective enablement and containment remain Phase 6 acceptance work. The OS does not mediate them.

## Known upstream issue

On unmodified OpenClaw 2026.9.2 and independently reproduced published 2026.9.4, when a native `requireApproval` is **denied** or has **no approval route**, the Gateway logs the tool's raw arguments before the tool execute callback runs (after approval hooks have run) (`BeforeToolCallFailureError` is not treated as a safe veto, unlike `BeforeToolCallBlockedError`). The candidate mitigation covers kernel-owned execute failures; it does not cover those upstream approval failures. Until upstream ships a fix, keep `synchronousActions` empty (the default). Keeping the default is not a substitute for the native-approval release gate. The report was submitted privately; no supported fix or full Phase 4 acceptance is established. [Candidate reproduction record](https://github.com/gatekeeper-os/gatekeeper-os/blob/bad84f223d1f869a80862d463ced4f71ed03e440/plans/upstream-native-approval-logging.md) (not yet on `main`).

## Reporting

See `SECURITY.md`. Anything that lets an agent exceed a grant, perform an unreviewed external effect, leak a credential or body into logs or results, or lets a non-operator introduce or decide, is in scope.
