# AGENTS.md — operating rules for agents working in this repository

Source of truth: `docs/agent-operating-rules.md` (keep the two in sync; this is the short form).

## Invariants
1. **No upstream modification.** Never patch, fork, vendor, or monkey-patch `openclaw`. Import only `openclaw/plugin-sdk/*`.
   Never read upstream's SQLite. Never write under the upstream install root or edit its systemd unit (drop-ins only).
2. **Upstream stays updatable.** The pin lives only in `gkos.lock.json`. Every plugin declares `openclaw.compat.pluginApi`
   (kept byte-identical to the workspace catalog — `pnpm check:catalog`). Kernel schema migrations run only after a pin is committed.
3. **Capabilities.** Every gatekeeper reach goes through `Kernel.resolveGrant()`. Gatekeepers never call `api.registerTool`.
   A resource becomes ambient only through operator config. Non-operators cannot create grants. Gate hooks fail closed.
4. **Secrecy.** Never log secrets, prompts, headers, tokens, or request/response bodies. Sanitize vendor errors. Tool
   descriptions never mention approvals, queues, caching, OAuth, or simulation.

## The kernel bar
`packages/gkos-kernel` and `packages/gkos-shared` are the kernel: every line reviewed, fewer lines is better, every export
doc-commented, reuse an upstream mechanism before adding a parallel one, no `as unknown as` across a plugin/RPC boundary,
SDK calls only in `packages/gkos-kernel/src/upstream/`.

## How we work
Phases in order (`docs/implementation-plan.md` §9); Phase 0 spike S-1 resolves every UNVERIFIED marker first. Honor the two
STOP points when authoring a gatekeeper (`.agents/skills/write-gatekeeper`). Acceptance runs only via `scripts/vm/test.sh`
(`docs/vm-testing.md`). A step with no test is not done. When reality contradicts the plan, edit the plan in the same commit.

## Git and reporting
Conventional commits; `phase-N` tags; never commit secrets, `.env`, `os/cell.key`, VM images, `vm-artifacts/`.
`plans/PROGRESS.md` at every phase end and early stop; `plans/REVIEW-REQUESTED.md` at STOP points when unattended.

## Stop when
an invariant would break; a STOP point is reached; the VM cannot be created; a criterion fails twice with no clear cause;
upstream contradicts `docs/upstream-reference.md`; a DECISION in the plan looks wrong (argue in writing, don't drift).
