# @gatekeeper-os/gatekeeper-github

Reference driver (Phase 4). Resources `repo`, `issue`, `pull` with the same URL patterns as cloudflare-os. Observer strategy B
(`hasRepoAccess`: 403/404 → false, other errors → throw). Simulation: overlay-at-read for all four actions. Revert: delete
comment / close issue. Auth: GitHub Device Flow preferred (works on loopback-bound gateways); web OAuth via the kernel's
`/os/gatekeeper/github/oauth/*` route; PAT via `gkos gatekeeper connect github --pat-env` for CI only.

Authoring follows `.agents/skills/write-gatekeeper/SKILL.md` — STOP 1 (tool surface review) before implementing `src/*.ts`.

## Distribution

This is a source/workspace package, not one of the five published beta packages. Its implementation or tests do not establish full driver acceptance. See the [release status](../../README.md#release-status).

## Synchronous approvals and operator logs

`synchronousActions` is an operator-configured allowlist, empty by default. Enabling an action selects `awaitDecision` → native `requireApproval` and can retain its raw tool arguments in the operator's Gateway logs on denial or missing approval route, even though a denied action never executes.

**GHSA-22jj-m53c-524m disposition (2026-09-12):** the OpenClaw maintainers closed the advisory as not requiring a change: “crosses no OpenClaw trust boundary — a denied tool still never executes, and the logs are operator-owned on the operator's host, where the same tool arguments are already retained in operator-readable session transcripts”. GatekeeperOS keeps the synchronous path (`awaitDecision` → native `requireApproval`) off by default as its own log-hygiene choice, not pending an upstream fix. Enabling it can put tool arguments in the operator's Gateway logs on denial or when no approval route exists; denial still prevents execution. This disposition does not turn previous failed body-secrecy checks into passes or establish full GitHub/MCP acceptance.
