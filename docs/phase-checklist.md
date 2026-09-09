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

Latest complete Ubuntu acceptance: `vm-artifacts/20260907-223901-phase-1/`, fresh `base`,
**exit 0, 25/25 assertions**. This supersedes the original 23/23 run's concurrency claim.

- [x] Source installer completes noninteractively in under ten minutes; Gateway and status healthy — `install-result.json`, `status.json`.
- [x] Doctor lint has no error-severity findings — `doctor-lint-errors.json`. The deliberate loopback/node-hosting and messaging-profile/skill-workshop warnings remain accepted; zero warnings is not required. SecretRef token removed the original plaintext-token warning.
- [x] Deep security audit has no critical findings — `security-audit.json`.
- [x] Install and config apply are idempotent — `install-again.json`, `config-apply-2.json`.
- [x] Pre-existing owned drift is refused; forced recovery works — conflict/refusal/forced artifacts.
- [x] An upstream edit injected **after dry-run** is preserved, even under `--force`; checkpoint unchanged; retry without a competing writer succeeds — `config-race.json`, `bind-after-race.json`, `config-race-recovery.json`, run log assertions. The SDK base-hash transaction, not the digest precheck, guards the write interval.
- [x] Two cells run concurrently with distinct ports, state dirs, units and keys — `cell-list.json`, `units.txt`, `listening-ports.txt`, run log.
- [x] Backup round-trip removes a post-backup marker and restores a healthy cell — `backup-restore.json`, `status-after-restore.json`. Restore consent authorizes upstream's required noninteractive stop flag; a failed stop never moves live state.
- [x] Linux drop-in carries OS environment without editing the upstream unit; required modes hold — `clawos.conf`, `upstream-unit.service`, `permissions.txt`.
- [x] Refreshed clean `installed` snapshot — separate fresh-base `20260907-224639-phase-1` **install-only** run exited 0; snapshot recreated 2026-09-07 15:49 PDT. `base` metadata hash unchanged; dedicated VM stopped. Install-only is preparation, not a substitute for the full acceptance above.
- [x] Current branch CI passed — https://github.com/ControlStackAI/openclaw-os/actions/runs/34167820496 (`88bbe26`), also PR CI 34167822735. 92 unit tests pass; 12 kernel conformance TODOs are not passes.
- [x] macOS full acceptance — https://github.com/ControlStackAI/openclaw-os/actions/runs/34167820614 (`88bbe26`), artifact `20260907-224656-phase-1`: **exit 0, 25/25**, Darwin, full mode; install 65 seconds. Two healthy concurrent cells, backup round-trip, no doctor errors or critical audit findings. Downloaded evidence verified locally under `vm-artifacts/github-macos-34167820614/`.
- [x] Phase 1 completion checkpoint `phase-1` — Ubuntu/macOS gates passed; [PR #1](https://github.com/ControlStackAI/openclaw-os/pull/1).

## Phase 2 — Contracts and kit

- [x] `clawos-shared` exports every contract from plan §4.3 with doc comments; TypeBox schemas for wire types — `2218843`, `src/schemas.test.ts`: 39 shared tests and typecheck pass. Process-local callbacks are explicitly excluded from wire transport.
- [x] Kit unit tests: nonce replay/expiry, encrypted account-bound storage, pending/rejected overlays — host-only `scripts/vm/test.sh phase-2`, `vm-artifacts/20260907-232940-phase-2/`, exit 0, **86 library tests** (39 shared + 47 kit), Node 22.23.2, upstream pin 2026.9.2. Includes tamper/refresh/revocation, durable journal/cache/sequence and uncertainty regressions.
- [x] `defineGatekeeper()` rejects forbidden descriptions, absent/optional/non-string grant and action without describe — same host-only acceptance; 18 builder tests including inert discovery and retained session revocation. No live Gateway conformance claimed.
- [x] `SKELETON.md` written and included in the kit package — APIs, journal ownership/recovery, trusted approval binding, OAuth stages and later driver review gates documented.
- [x] Phase 2 completion checkpoint `phase-2` — [PR #2](https://github.com/ControlStackAI/openclaw-os/pull/2); host-only acceptance `20260907-232940`, branch CI 34170233623 and PR CI 34170298843 passed.

## Phase 3 — Kernel and gatekeeper-fs

- [x] Filesystem STOP 1: operator approved the presented contract after `7642efb` ("continuew"); contract: `plans/fs-contract.md`.
- [x] Filesystem STOP 2: operator explicitly approved after `fc8b33f` ("Approved continue"); recorded in `plans/PROGRESS.md`.

- [x] Conformance tests pass in VM: `plugin-loads`, `hooks-fire`, `tool-narrowing`, `gate-blocks`, `rpc-methods`, `cli-mounted`, `health`, `fs-gatekeeper`, `install-gate` — evidence: combined fresh-run verdict `vm-artifacts/20260909-201704-phase-3/verdict.json`, 47/47 across the nine required suites; `install-hook` adds 17/17.
- [x] Authenticated Control UI pastes a `file://` path URL → agent receives `gk_fs_dir_list` on the first request — evidence: same combined run, 33/33 ingress checks.
- [x] Non-operator pastes the same URL → no grant created — evidence: same combined run, synthetic public-SDK provider with upstream owner resolution.
- [x] `clawos grant revoke` → tool absent on the next turn — evidence: same combined run, `cli-grant-revoke`, `grant-revoked`, and `revoked-tool-absent` all pass.
- [x] Every kernel grant/use/revoke step above appears in `clawos audit tail` — evidence: same combined run, `successful-call-audited`, `observation-audited`, `unknown-policy-audited`, `cli-audit-tail`, and `revocation-audited` pass.
- [x] Trusted tool policy denies a `gk_*` call with an unknown handle even when kernel conversation hooks are disabled — evidence: `20260908-163653-phase-3`, `disabled-hooks-policy-denied` and matching policy audit.
- [x] Fresh-base installer regression with bundled plugins: **25/25**, `vm-artifacts/20260909-002725-phase-1/`; two-cell isolation, backup/restore and post-restore health pass.
- [x] Source-packaged kernel/fs project into cell-local state with no implicit grants; reinstall is a no-op — `vm-artifacts/20260909-001359-phase-3/`, install-again and scenario evidence, healthy paired kernel/fs status.
- [x] Primary install policy blocks actual unlisted CLI installs, permits an explicitly reviewed source, and fails closed when unavailable — `vm-artifacts/20260909-003432-phase-3/`, `install-verdict.json` **8/8**, `scenarios.json` **12/12** structural checks; CLI114/policy4 guest tests pass. The outage case uses a fresh allowed fixture and verifies the policy error.
- [x] Secondary `before_install` blocks a plugin from a non-allowlisted source in a Gateway-backed flow — evidence: `vm-artifacts/20260909-195747-phase-3/`, 17/17; repeated inside combined run `20260909-201704`.
- Focused live checkpoint `20260908-163653-phase-3`: hooks-fire 4/4, tool-narrowing 5/5,
  gate-blocks 7/7, fs-gatekeeper 7/7; 48/48 structural checks across eight actual agent turns.
  Paired device-token RPC introduction/revocation and non-owner RPC URL denial passed.
  The later `20260908-172236-phase-3` checkpoint verified CLI grant/list/revoke/audit
  and mounted status (**31/31** live assertions). Combined Phase 3 is now green;
  real Slack transport remains a separate deployment canary before tagging.
- [ ] Real Slack transport from Nova's SOPS-backed ALINA app admits Matt and rejects an unallowlisted identity — evidence:
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
