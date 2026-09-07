# Agent Operating Rules

These rules bind any agent working on OpenClaw OS. They become the repository's `AGENTS.md` and `REVIEW.md` in Phase 0 (copy them there; keep this file as the source). They are adapted from Cloudflare OS's `AGENTS.md`/`REVIEW.md` and from the two invariants in the project brief.

## 1. Invariants

**INVARIANT 1 — No upstream modification.** The `openclaw` package is never patched, forked, vendored, or monkey-patched. Do not import from `openclaw/*` except the documented `openclaw/plugin-sdk/*` subpaths. Do not read or write upstream's SQLite database (`<stateDir>/state/openclaw.sqlite`). Do not write under the upstream install root or edit upstream's systemd unit file (use a drop-in). If something cannot be done through plugins, hooks, config, skills, CLI, or the Gateway API, it is out of scope — report it, do not hack it.

**INVARIANT 2 — Upstream must remain updatable.** The upstream version is chosen only by `clawos.lock.json`. Every OS plugin declares an `openclaw.compat.pluginApi` range. The update pipeline stages, runs conformance, activates, verifies, and rolls back on failure. All OS state lives under `<stateDir>/os/`. Kernel schema migrations run only after a pin is committed, never during a failed update, so rollback is always schema-neutral.

**Capability invariants.** Every agent reach into a gatekeeper goes through `Kernel.resolveGrant()`. A gatekeeper never calls `api.registerTool` itself — the kernel registers tools on its behalf. A resource becomes ambient only through operator configuration; a gatekeeper never asserts its own ambience. A non-operator can never create a grant. Gate hooks fail closed.

**Secrecy invariant.** Never log secrets, prompts, headers, tokens, or request/response bodies. Vendor error messages are sanitized before they reach a tool result or a log; only numeric codes are recorded. Tool descriptions never mention approvals, queues, caching, OAuth, or simulation.

## 2. The kernel bar

`packages/clawos-kernel` and `packages/clawos-shared` are the kernel. They define the architecture and are held to a higher bar than gatekeepers, CLI, or blueprints: reviewers read every line; fewer kernel lines is better; every exported member carries a doc comment; reuse an existing upstream mechanism before adding a parallel one; no `as unknown as` casts across an RPC or plugin boundary; SDK calls happen only in `src/upstream/*.ts` so an upstream API rename is a one-file change. A change that adds a new way to mint or use a gatekeeper session without `resolveGrant()` is rejected.

## 3. Review priority (REVIEW.md)

Highest first: (1) the kernel bar; (2) capability-security invariants, especially any new path that resolves a grant, registers a `gk_*` tool, or introduces a resource; (3) secret leakage through logs, tool results, audit records, or error strings; (4) upstream-coupling creep — any new SDK subpath, config key, CLI flag, or hook name must be added to `docs/upstream-reference.md` with a VERIFIED source; (5) everything else. `reportedUserId`-style values supplied by a client are diagnostic labels, never inputs to a decision.

## 4. Working conventions

Follow the plan's phases in order; do not skip ahead. Phase 0's spike S-1 resolves every UNVERIFIED marker before Phase 1 begins. Honor the two STOP points in gatekeeper authoring (plan §4.6). Test in the VM per `docs/vm-testing.md`; the host is for editing, building, unit tests, and driving the VM. Write tests with the code; a step with no test is not done. Keep the plan current: when a spike or a test contradicts it, edit `docs/implementation-plan.md` in the same commit, marking what changed and why — the plan is a living artifact, not a spec to be quietly diverged from.

## 5. Git

Conventional commits, one logical change each. Never commit secrets, `.env`, `os/cell.key`, VM images, or `vm-artifacts/`. Tag `phase-N` at the end of each phase. Branch `main` stays green; work on `phase/N-<topic>` branches and merge with a merge commit that names the acceptance run.

## 6. Reporting

`plans/PROGRESS.md` gets a dated section at every phase end and at every early stop: what was built (paths), exact VM test commands and results, acceptance criteria pass/fail, upstream version and snapshot used, deviations and why, open questions, next step. `plans/REVIEW-REQUESTED.md` is written at STOP points when no operator is present. `plans/spike-S1.md` records every empirical finding with the command that produced it.

## 7. When to stop

Stop and report rather than improvise when: an invariant would have to be broken; a STOP point is reached; the VM cannot be created; an acceptance criterion fails twice with no clear cause; upstream behavior contradicts a VERIFIED fact in `docs/upstream-reference.md` (record the discrepancy — upstream may have changed); or a decision marked DECISION in the plan appears to be wrong (make the case in writing, do not silently change it).
