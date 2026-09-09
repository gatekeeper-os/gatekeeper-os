# Phase 3 channel introduction — confirmed plan mismatch

Status: unresolved integration design; no capability-policy relaxation.

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
manufacture the claimed upstream authority. Real Telegram acceptance separately
needs a disposable bot/chat and operator/non-operator test identities.

Deferring access to a later turn would change the first-turn acceptance
requirement; do not silently choose that workaround. Changing the upstream pin
or importing internal authorization helpers is not a tested solution.

Repository operating rules §7 require a written stop when a plan decision is
wrong rather than drifting. No Phase 3 completion/tag or beta claim is made.
