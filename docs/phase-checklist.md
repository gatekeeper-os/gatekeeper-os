# Phase Checklist

Check a box only when the criterion passed in the VM (or, for host-only unit tests, on CI) and add the artifact path that proves it, e.g. `vm-artifacts/20260910-1432-phase-1/`. Criteria mirror `docs/implementation-plan.md` §9; if the plan's criteria change, change them here in the same commit.

## Phase 0 — Bootstrap and spikes

- [x] Monorepo skeleton per plan §8 committed; `AGENTS.md` and `REVIEW.md` created from `docs/agent-operating-rules.md` — evidence: `7534893` (provided derived short forms)
- [x] `clawos.lock.json` pins `openclaw@2026.9.2`; CI installs that version and prints `openclaw --version` — evidence: https://github.com/ControlStackAI/openclaw-os/actions/runs/34160492903 (success, `dbb663c`)
- [x] `scripts/dev-gateway.ts` starts and stops a throwaway cell with `openclaw gateway run` — evidence: `vm-artifacts/20260907-192654-phase-0/{run.log,dev-gateway.log}`, exit 0
- [x] `scripts/vm/up.sh` creates the VM and takes snapshot `base` — evidence: `18eb1d7`; `scripts/vm/.state/up-metadata-retry.log`; subsequent acceptance runs successfully restored `base`
- [x] `plans/spike-S1.md` answers every UNVERIFIED item in plan §2.2 and §5.1 with the command used — evidence: `vm-artifacts/20260907-201658-phase-0/` exit 0; provider-documentation naming bound + live SDK-slot fallback; see S-1 limits
- [x] Plan updated: no UNVERIFIED marker remains in §5 — evidence: `9ba75fe`; bounded probe evidence is distinguished from unimplemented kernel conformance; c/j resolved by the 201658 continuation
- [x] Three skills (`write-gatekeeper`, `clawos-operator`, `write-blueprint`) drafted under `.agents/skills/` — evidence: supplied scaffold `7534893`; verified tracked paths, not newly published or applied
- [x] Tag `phase-0` — Phase 0 completion merge; VM 20260907-201658 + green CI 34160573000

**Phase 0 continuation, 2026-09-07:** fresh-base live spike exited **0** in
`vm-artifacts/20260907-192654-phase-0/`: 20/20 call correlations, 40/40 narrowed
requests, paired device-token reconnect, SQLite, install policy, plugin metadata,
and dev Gateway lifecycle passed. Prior interrupted run stays UNKNOWN overall;
the subsequent missing-schema run exited 1 and was fixed in `9ba75fe`.
**At that earlier checkpoint:** S-1 c/j were partial and no live CI destination/run
existed. No phase tag or advancement. See `plans/PROGRESS.md`.

**Latest Phase 0 continuation, 2026-09-07:** `vm-artifacts/20260907-201658-phase-0/`
exited **0** from `base`. c/j are now answered: documented naming limits with a
live 64-character schema-boundary test, and catalog-selected SDK runtime slots
with enabled/disabled/stopped checks. All eleven structural assertions pass.
**Publication update:** private `ControlStackAI/openclaw-os` created; live CI passed at `dbb663c` (run linked above). Phase 0 merge/tag has not yet been performed; no Phase 1 work.

## Phase 1 — Host layer and installer

- [x] From snapshot `base`: `installer/install.sh` completes non-interactively; Gateway running; `clawos status` healthy — evidence: `vm-artifacts/20260907-213353-phase-1/` exit 0; `install-result.json` (exit 0), `status.json` (`healthy: true`). Source install, not `curl | bash` — see the §10.2 correction.
- [ ] `openclaw doctor --lint --json` reports **no error-severity findings** — evidence:
      *Criterion corrected 2026-09-07 (Phase 1).* The original text said "exit 0". Exit 0 means *zero findings of
      any severity*, and the hardened baseline deliberately produces two warnings: `core/doctor/node-hosting-preconditions`
      (loopback-only bind — intended; node onboarding is not used) and `core/doctor/skill-workshop-tool-policy`
      (`skill_workshop` absent from the `messaging` profile — intended; the baseline denies broad tool groups).
      Reversing either to score a green exit code would weaken the security posture Phase 1 exists to establish, so
      the criterion is "no error-severity findings" and the accepted warnings are named. The third original warning
      (plaintext `gateway.auth.token`) was a real defect and is fixed: the token is a SecretRef.
- [x] `openclaw security audit --deep --json` has no critical findings — evidence: `vm-artifacts/20260907-213353-phase-1/security-audit.json` → `summary.critical: 0` (2 warn, 1 info)
- [x] Re-running `clawos install` is a no-op (every step reports postcondition already met) — evidence: `vm-artifacts/20260907-213353-phase-1/install-again.json` → `changed: false`; step 6 (plugins) reports `deferred`, not `ok`, because the kernel is Phase 3
- [x] `clawos config apply` twice → second run shows no diff — evidence: `vm-artifacts/20260907-213353-phase-1/config-apply-2.json` → `changed: false`, `changes: []`. Also verified beyond the criterion: `config-apply-conflict.json` proves an external edit to an OS-owned path is refused (exit 1, `conflicts: ["gateway.bind"]`), `bind-after-refusal.json` proves the refusal wrote nothing, and `config-apply-forced.json` proves `--force` recovers.
- [x] `clawos cell create firma --port 18801` → both cells run concurrently with separate state dirs and units — evidence: `vm-artifacts/20260907-213353-phase-1/cell-list.json`, `units.txt`, `listening-ports.txt` (18789 + 18801), `state-dirs.txt`. Cell keys verified distinct, which is what makes a cell a trust boundary. (Name lowercased: cell names map to unit and directory names.)
- [x] `clawos backup create` + `restore` round-trips a cell — evidence: `vm-artifacts/20260907-213353-phase-1/backup-create.json`, `archive-listing.txt` (contains `os/clawos.lock.json`), `backup-restore.json`, `status-after-restore.json`. The round-trip is proven by a marker file written *after* the backup and absent after the restore, not by exit code alone. Uses upstream `backup create/verify/restore` only; no SQLite is opened.
- [x] Systemd drop-in (not upstream's unit) carries `OPENCLAW_NO_AUTO_UPDATE=1` and `CLAWOS_CELL` — evidence: `vm-artifacts/20260907-213353-phase-1/clawos.conf` and `upstream-unit.service` (neither OS-owned Environment line appears in upstream's unit)
- [x] Config file mode 600, state dir 700, `os/cell.key` 600 — evidence: `vm-artifacts/20260907-213353-phase-1/permissions.txt` (also `.env` 600). `clawos backup restore` re-asserts these modes, because extraction otherwise restored `~/.openclaw` as 775.
- [x] Install time from `base` under 10 minutes — evidence: `vm-artifacts/20260907-213353-phase-1/install-result.json` → **139 s** including Node provisioning, upstream install, workspace build and CLI pack; whole phase script 263 s
- [ ] Refresh snapshot `installed` for the reviewed installer — **old snapshot is stale after the atomic-write fix**. Historical evidence: `virsh -c qemu:///session snapshot-list clawos-test` lists `base` (2026-09-07 11:38) and `installed` (2026-09-07 14:41). Taken from a *clean* base install (reset → sync → `installer/install.sh` → `clawos status` healthy), not from the post-acceptance VM, so it means what `docs/vm-testing.md` §4 says it means.
- [ ] macOS smoke install (real Mac or macOS VM; Lima Linux is not macOS) recorded — evidence: **NOT DONE — no macOS host is available.** The development host is `nova` (NixOS); a Lima VM on Linux runs Linux, not macOS, so it cannot satisfy this criterion. Phase 1 is therefore **not tagged**. See `plans/PROGRESS.md`.
- [ ] Atomic write race regression on the final patch — first run 25/25 (`20260907-222050-phase-1`), final-patch retest pending.
- [ ] Tag `phase-1` — **withheld.** The macOS criterion above is unmet, and the plan's acceptance requires "a clean Ubuntu 24.04 VM **and** a clean macOS machine".

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
