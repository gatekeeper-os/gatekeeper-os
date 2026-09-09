# Phase 3 channel introduction — confirmed plan mismatch

Status: authenticated Control UI and public-SDK synthetic ingress verified; combined Phase 3 passed. Real Slack transport canary pending. No capability-policy relaxation.

## Evidence

Pinned upstream `openclaw@2026.9.2`, bundled `docs/plugins/hooks.md`:

- Prompt lifecycle, line 774: `agent_turn_prepare` → ordinary
  `before_prompt_build` → finalized tool policy → authorized enrichment.
- Before-agent-run, line 838: “runs after prompt construction and before model
  submission”.
- Published SDK types: `PluginHookBeforeAgentRunEvent.senderIsOwner` is the
  trusted owner bit. Earlier reply/turn-prepare event and common context shapes
  lack it. Common sender identity fields are optional, not proof of ownership.

Read-only inspection of the installed package agrees: prompt assembly calls
`resolvePromptBuildHookResult` before `runEmbeddedAttemptBeforeAgentRun`.
No upstream source was imported, modified or executed on production state.

## Consequence

The original plan's order was reversed. A new grant created by the late gate
cannot reach the first model request's already-narrowed tools. Existing live
RPC introduction tests prove their actual path, not channel introduction.
The note-key regression now correctly drains session-scoped notes, but does
not fix hook order; its unit fixture explicitly invokes hooks and is not live
ordering evidence.

## Required resolution

Preserve the configured operator match AND trusted owner check. Before moving
creation earlier, establish a supported authenticated identity contract covering
real channels, forged RPC identities, missing senders and group observers. A
VM fixture may use public `reply-runtime.dispatchInboundMessageWithDispatcher`
for genuine SDK channel dispatch, but must not call kernel hooks directly or
manufacture the claimed upstream authority. Real Slack acceptance separately
needs the host-managed ALINA app and operator/non-operator test identities.

Deferring access to a later turn would change the first-turn acceptance
requirement; do not silently choose that workaround. Changing the upstream pin
or importing internal authorization helpers is not a tested solution.

Repository operating rules §7 require a written stop when a plan decision is
wrong rather than drifting. No Phase 3 completion/tag or beta claim is made.


## Authorized correction — 2026-09-09

Matt explicitly authorized completing the beta and resolving required plan
changes. The earlier generic prompt hooks still lack an owner bit, but
`reply_dispatch` provides the host-finalized channel context and configuration.
The public `command-auth` resolver computes the same upstream owner result;
the kernel additionally requires its configured channel/operator match. The
candidate uses that earlier seam without claiming or replacing dispatch.

Implementation: `src/upstream/channel-authority.ts`, `Kernel.onReplyDispatch`,
and its registration. Gateway-scoped/internal/provenance-bearing turns are
excluded; missing or inconsistent identity fails closed. Public strict agent
scope resolution avoids treating an arbitrary noncanonical key as `main`.
Canonical current-message `commandText` replaces enriched prompt URL scanning.
The late gate no longer mints duplicate or too-late grants.

The public SDK channel dispatch, forged Gateway label/scopes negatives,
first-model-request tool/notice evidence, and group observer isolation are now
accepted. Real Slack transport remains the last external canary. Restricted
runtime sessions that skip takeover hooks intentionally gain no automatic
grants. Unit mocks alone do not settle these boundaries.

## Focused live evidence — 2026-09-09

`vm-artifacts/20260909-110033-phase-3/` reports29/29 checks with five actual
model turns and exit0 through `channel-ingress` mode. Owner first-request tools
and notice, nonowner/scopes-bearing negatives, paired Gateway forged-label
negative, and same-session subsequent nonowner narrowing pass. This is public
SDK integration with a synthetic loaded channel provider, not real Slack
transport. The later combined run `20260909-201704-phase-3` repeats this path
alongside all kernel/install suites and exits 0. See PROGRESS for scope.
