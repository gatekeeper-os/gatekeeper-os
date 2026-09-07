# Phase Checklist

Check a box only when the criterion passed in the VM (or, for host-only unit tests, on CI) and add the artifact path that proves it, e.g. `vm-artifacts/20260910-1432-phase-1/`. Criteria mirror `docs/implementation-plan.md` §9; if the plan's criteria change, change them here in the same commit.

## Phase 0 — Bootstrap and spikes

- [ ] Monorepo skeleton per plan §8 committed; `AGENTS.md` and `REVIEW.md` created from `docs/agent-operating-rules.md` — evidence: commit hash
- [ ] `clawos.lock.json` pins `openclaw@<version>`; CI installs that version and prints `openclaw --version` — evidence: CI run URL
- [ ] `scripts/dev-gateway.ts` starts and stops a throwaway cell with `openclaw gateway run` — evidence:
- [ ] `scripts/vm/up.sh` creates the VM and takes snapshot `base` — evidence:
- [ ] `plans/spike-S1.md` answers every UNVERIFIED item in plan §2.2 and §5.1 with the command used — evidence:
- [ ] Plan updated: no UNVERIFIED marker remains in §5 — evidence: commit hash
- [ ] Three skills (`write-gatekeeper`, `clawos-operator`, `write-blueprint`) drafted under `.agents/skills/` — evidence:
- [ ] Tag `phase-0`

## Phase 1 — Host layer and installer

- [ ] From snapshot `base`: `installer/install.sh` completes non-interactively; Gateway running; `clawos status` healthy — evidence:
- [ ] `openclaw doctor --lint --json` exit 0 — evidence:
- [ ] `openclaw security audit --deep --json` has no critical findings — evidence:
- [ ] Re-running `clawos install` is a no-op (every step reports postcondition already met) — evidence:
- [ ] `clawos config apply` twice → second run shows no diff — evidence:
- [ ] `clawos cell create firmA --port 18801` → both cells run concurrently with separate state dirs and units — evidence:
- [ ] `clawos backup create` + `restore` round-trips a cell — evidence:
- [ ] Systemd drop-in (not upstream's unit) carries `OPENCLAW_NO_AUTO_UPDATE=1` and `CLAWOS_CELL` — evidence:
- [ ] Config file mode 600, state dir 700, `os/cell.key` 600 — evidence:
- [ ] Install time from `base` under 10 minutes — evidence: timing in artifact log
- [ ] Snapshot `installed` taken — evidence:
- [ ] macOS smoke install (manual or Lima) recorded — evidence:
- [ ] Tag `phase-1`

## Phase 2 — Contracts and kit

- [ ] `clawos-shared` exports every contract from plan §4.3 with doc comments; TypeBox schemas for wire types — evidence:
- [ ] Kit unit tests: nonce replay rejected; expired nonce rejected; token store encrypts at rest; overlay reflects pending and forgets rejected actions — evidence:
- [ ] `defineGatekeeper()` rejects: tool description containing approv/oauth/cache/queue; tool without `grant` param; action tool without `describe()` — evidence:
- [ ] `SKELETON.md` written — evidence:
- [ ] Tag `phase-2`

## Phase 3 — Kernel and gatekeeper-fs

- [ ] Conformance tests pass in VM: `plugin-loads`, `hooks-fire`, `tool-narrowing`, `gate-blocks`, `rpc-methods`, `cli-mounted`, `health`, `fs-gatekeeper`, `install-gate` — evidence:
- [ ] Operator pastes a `file://` path URL → agent lists files through `gk_fs_dir_list` — evidence:
- [ ] Non-operator pastes the same URL → no grant created — evidence:
- [ ] `clawos grant revoke` → tool absent on the next turn — evidence:
- [ ] Every step above appears in `clawos audit tail` — evidence:
- [ ] Trusted tool policy denies a `gk_*` call with an unknown handle even when hooks are disabled — evidence:
- [ ] `before_install` blocks a plugin from a non-allowlisted source — evidence:
- [ ] Tag `phase-3`

## Phase 4 — gatekeeper-github

- [ ] STOP 1: tool surface reviewed and approved by operator (link to review) — evidence:
- [ ] STOP 2: operator approved starting Phase 2 of the gatekeeper — evidence:
- [ ] Conformance `deferred-approval` and `require-approval-roundtrip` pass with GitHub — evidence:
- [ ] Scenario: comment (simulated) then summarize thread including the pending comment; `clawos approvals apply all` → comment live on GitHub — evidence:
- [ ] `reject` removes the simulated comment from subsequent reads — evidence:
- [ ] `revert` deletes an applied comment — evidence:
- [ ] Observer strategy B: `hasRepoAccess` returns false on 403/404 and throws on other errors — evidence: unit test
- [ ] Secret-leak grep over audit, logs, artifacts finds nothing — evidence:
- [ ] Snapshot `connected` taken — evidence:
- [ ] Tag `phase-4`

## Phase 5 — Approvals UX and auto-approval

- [ ] `clawos approvals list/apply/reject/revert` with previews — evidence:
- [ ] Chat commands `/approvals`, `/approve`, `/reject`, `/grants`, `/grant <url>` claimed before the model; non-operators get silence — evidence:
- [ ] Auto-approval applies within 30 s only when both rule and `autoApprovable` are present — evidence:
- [ ] Drainer stops at first non-eligible action and resumes after it is decided — evidence:
- [ ] One digest per run to the operator channel — evidence:
- [ ] Tag `phase-5`

## Phase 6 — Blueprints

- [ ] `assistant`, `coder`, `ops`, `researcher` apply to a fresh cell and produce working agents — evidence:
- [ ] `blueprint lint` rejects `exec` without `sandbox.mode: "all"` — evidence:
- [ ] Re-apply is idempotent; `blueprint diff` shows drift after a manual edit — evidence:
- [ ] `coder` executes a command inside a Docker sandbox with `network: none` — evidence:
- [ ] Tag `phase-6`

## Phase 7 — Update and rollback

- [ ] `clawos update --to <latest>` from snapshot `connected` completes all nine pipeline steps; grants intact afterwards — evidence:
- [ ] Compat-range block stops at step 2 with a clear message — evidence:
- [ ] Injected conformance failure stops at step 5 with nothing changed (`openclaw --version` unchanged, lockfile unchanged) — evidence:
- [ ] Kill during step 7 → `clawos rollback` restores a healthy previous version with grants intact — evidence:
- [ ] `clawos update --check` posts an availability message — evidence:
- [ ] `.github/workflows/conformance-matrix.yml` runs against `latest`, `beta`, `extended-stable` and reports verdicts — evidence: workflow run URL
- [ ] `docs/updating.md` and the operator skill's upgrade/rollback reference written — evidence:
- [ ] Tag `phase-7`

## Definition of done (engagement)

- [ ] Fresh VM → working cell via `curl … | bash` in under 10 minutes
- [ ] GitHub action simulated, approved later, applied for real
- [ ] `clawos update` to current `latest` succeeds or rolls back cleanly
- [ ] Nightly conformance matrix exists and has at least one successful run
- [ ] `plans/PROGRESS.md` has a section for every phase
