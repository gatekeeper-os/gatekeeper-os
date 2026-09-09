# Progress log

Append a section at the end of every phase and at every early stop (see `AGENTS.md` §6).

<!-- template
## YYYY-MM-DD — Phase N: <title>
**Built:** paths…
**Upstream:** openclaw@x.y.z · **VM snapshot:** base|installed|connected · **Artifacts:** vm-artifacts/<ts>-phase-N/
**Tests run:** exact commands and results
**Acceptance:** criterion — PASS/FAIL (evidence)
**Deviations from plan:** what and why (and the plan commit that records it)
**Open questions:** …
**Next:** …
-->

## 2026-09-07 — Phase 0 bootstrap checkpoint (in progress)

**Built:** imported the 186-file scaffold (`7534893`); locked development dependencies
(`dfd5f39`); `scripts/vm/libvirt.sh`; fail-closed `scripts/vm/up.sh`;
`test/vm-bootstrap.test.py`; sanitized secret scanning in `scripts/check-secrets.sh`.
Work branch: `phase/0-bootstrap` in the isolated sibling worktree.

**Upstream:** development SDK resolved to `openclaw@2026.9.2` (read package metadata,
not a host Gateway invocation). **VM:** Ubuntu 24.04 cloud image, dedicated
`clawos-test`, `qemu:///session`, snapshot `base` created successfully.

**Tests:** host `pnpm install && pnpm build && pnpm test` exited 0: 11 unit tests
passed, 12 conformance TODOs (not passes). `python3 test/vm-bootstrap.test.py`
passed both failure-gate regressions. `pnpm check:catalog` and
`bash scripts/check-secrets.sh` passed. VM lifecycle command:
`CLAWOS_VM_DRIVER=libvirt scripts/vm/up.sh` exited 0; reset and sync through
`CLAWOS_VM_DRIVER=libvirt scripts/vm/test.sh phase-0` succeeded; acceptance is
currently running and is not yet passed.

**Deviations/fixes:** provided libvirt driver was a TODO. Corrected virt-install
option parsing and assigned an unused PCI slot after diagnostic startup failures.
The cloud image rejected an implicit NoCloud seed; explicit instance metadata
fixed it. Dedicated SSH config avoids host Nix-store include ownership checks in
the agent user namespace. Failed disposable disks are preserved in ignored
`.state/`, never committed. No host OpenClaw invocation or production state access.

**Acceptance:** skeleton committed PASS; baseline host checks PASS; base snapshot
PASS; S-1/throwaway lifecycle/live CI/plan verification/phase tag PENDING. Existing
three skill drafts are supplied by the scaffold, not newly published skills.

**Open questions:** GitHub destination for the required live CI run (asked in chat).
**Next:** finish VM S-1, evaluate every result, update plan/reference/checklist with
actual evidence; do not advance to Phase 1 or tag Phase 0 prematurely.

## 2026-09-07 — Phase 0 EARLY STOP: required hook callbacks absent

**Phases completed:** none. **Current tag:** none. **Branch:** `phase/0-bootstrap`.
`main` remains the supplied skeleton at `7534893`; no failed phase was merged or tagged.

**Built / changed:**
- `scripts/vm/libvirt.sh` and lifecycle wrappers: dedicated VM, owned-disk guards,
  publisher checksum verification, immutable snapshot/reset/sync, fail-closed collection.
- `test/vm-bootstrap.test.py`: two regression tests for masked provisioning failures.
- `scripts/spike-probe/src/index.ts` and manifest: structural runtime probes,
  public Node SQLite resolver, correct RPC callback, call correlation, explicit matchers.
- `scripts/spike-model.mjs`, `scripts/spike-config.mjs`: deterministic local model
  and isolated configuration; no personal/provider credentials.
- `scripts/spike-policy{,-config}.mjs`, `test/fixtures/install-policy-probe/`:
  allow/block/malformed install-policy fixtures.
- `scripts/spike-assert.mjs`, `test/phase-0.sh`: failing live assertions, not TODO passes.
- `scripts/dev-gateway.ts`: VM-only isolation/readiness/termination implementation
  prepared but **not runtime-verified** before the stop; its acceptance stays unchecked.
- `docs/implementation-plan.md`, `docs/upstream-reference.md`,
  `docs/phase-checklist.md`, `plans/spike-S1.md`: actual results and unresolved gates.

**Environment:** Ubuntu 24.04, two vCPU, 4 GiB RAM, 24 GiB overlay; named snapshot
`base` (no Node/OpenClaw). VM Node `v24.20.0`, upstream `OpenClaw 2026.9.2`.
No production Gateway/config was invoked or modified; no upstream source modified.

**Exact VM acceptance command:**
`CLAWOS_VM_DRIVER=libvirt scripts/vm/test.sh phase-0` (three reset-based runs).
Artifacts, including exit codes, under `vm-artifacts/20260907-183938-phase-0/`,
`vm-artifacts/20260907-184301-phase-0/`, `vm-artifacts/20260907-184712-phase-0/`.
Each exited 1. Detailed commands and outputs are in `plans/spike-S1.md`.
Latest: 20 CLI turns completed and 20 tool bodies ran; zero `before_tool_call`,
zero `llm_input`, zero identity correlation; all 40 model requests remained
unnarrowed. Documented conversation opt-in and explicit matchers were present.
SQLite and all three install-policy decisions passed. Test Gateway/model
processes terminated; ports 19100 and 19101 were verified unbound in the guest.

**Acceptance:**

| Phase 0 criterion | Result / evidence |
|---|---|
| Skeleton + derived AGENTS/REVIEW committed | PASS — `7534893` |
| Baseline development build/unit tests | PASS — 11 tests, 12 conformance TODOs (not passes) |
| Pin installed by live CI | BLOCKED — SDK/VM pin confirmed, but no remote or CI run URL |
| `pnpm dev:gateway` starts/stops a cell | NOT RUN — implementation prepared, unchecked |
| VM creation and immutable base | PASS — lifecycle log and three successful resets |
| S-1 every question answered | FAIL — c,d,g,j partial; e/f blocking; h/i/m verified |
| No UNVERIFIED marker in §5 | FAIL — unresolved operator identity and hook behavior |
| Three skills drafted | PRESENT in imported scaffold; not changed/published or newly validated |
| Phase 0 tag | NOT CREATED |
| Phases 1–7 | NOT STARTED |

**Deviations and why:** used the explicitly allowed libvirt driver because
Multipass is unavailable; implemented its missing scaffold. Static SQLite import
failed; public Node `createRequire()` succeeded. Selected the plan's already
specified catalog-cache fallback after late tools did not reach model schemas.
Added missing documented conversation-hook opt-in; this did not resolve the final
callback failure. No gatekeeper surface or kernel redesign was attempted.

**Stop reason:** kickoff / operating rules §7 require stopping when upstream
behavior contradicts a relied-on verified contract. The proposed security
chokepoint depends on `before_tool_call`; proceeding cannot be justified by
successful tool bodies alone. This is a test-path compatibility blocker with
unresolved root cause, not proof about all upstream execution paths.

**Open operator questions:** GitHub destination for live CI is still unanswered.
The hook discrepancy requires read-only upstream diagnosis / a verified supported
path before resuming S-1; any design change must be reviewed, not silently made.
No gatekeeper STOP review has been reached.

**Next step:** inspect this report and `plans/spike-S1.md`; resolve the callback
blocker before another acceptance run or Phase 1. **Single inspection command
from this worktree:** `cat plans/PROGRESS.md`. `clawos status` is not yet a valid
system-state check because the OS has not been implemented/installed.

**Cleanup:** dedicated `clawos-test` is shut off; existing `alinaos-arch-validation` remains running. VM artifacts and ignored disks are preserved locally.

## 2026-09-07 — continuation: live spike passed; Phase 0 still incomplete

**Phases completed:** none. **Current tag:** none. **Branch:** `phase/0-bootstrap`.
**Fix commit:** `9ba75fe`. `main` and production OpenClaw remain untouched.

**Recovered:** interrupted `20260907-191546-phase-0` had 20 correlated calls and
successful SDK token reconnect, but no final verdict; recorded **UNKNOWN** and
collected its allowlisted evidence without rerunning assertions in the dirty guest.

**Fixed:** inert discovery/tool-discovery capability and hook registration;
ordinary pre-policy `before_prompt_build` narrowing; object-form SDK runtime-store
stash shared across registration instances; paired SDK identity/token probes;
dev Gateway smoke lifecycle; disabled snapshot metadata checks for ordinary
plugins; required empty config schemas for HTTP/MCP placeholders; isolated CI
pin inspection. Updated plan/reference with the empirical corrections in the
same fix commit. No upstream modification or gatekeeper tool-surface change.

**Complete VM command:** `CLAWOS_VM_DRIVER=libvirt scripts/vm/test.sh phase-0`.
- `20260907-192247-phase-0`: **exit 1**, missing `configSchema` in two placeholder
  manifests; failed before runtime spike. Clear cause corrected, not ignored.
- `20260907-192654-phase-0`: **exit 0**, fresh `base`, Ubuntu 24.04,
  Node 24.20.0, OpenClaw 2026.9.2. Evidence collection and secret scan passed.

**Final acceptance observations:**
- PASS metadata-only checks for all five workspace plugins (not runtime conformance).
- PASS dev Gateway readiness and termination, foreground probe Gateway readiness.
- PASS 20/20 hook identities and matching tool executions; 20 narrowed hook
  observations and 40/40 actual model requests contain only `probe_echo`.
- PASS paired SDK device-token reconnect; role/scopes/device present, optional
  pairedClientId/authenticatedUserId absent. Shared auth alone is not pairing.
- PASS own SQLite; install-policy block, malformed denial, and allow.
- `assertions.json`: seven true results. The ordinary authoring-validator
  rejection remains an explicit negative artifact, not a claimed validator pass.

**Host-only checks:** `pnpm typecheck`, `pnpm test` (11 pass, 12 conformance TODOs),
`pnpm check:catalog`, `pnpm check:secrets`, `python3 test/vm-bootstrap.test.py`
(two pass), shell/Node syntax checks, edited JSON/YAML parsing, and
`git diff --check` passed. No host Gateway was installed or invoked by this work.

**Open Phase 0 gates:** live CI (no remote; GitHub destination still unanswered),
S-1 c (portable tool-name bounds), and S-1 j (live manifest discovery/vendor
attachment). Existing catalog-cache fallback settles static tool registration,
not live vendor attachment. Section 5's resolved facts are updated, but this does
not waive the other gates. Kernel remains scaffold code; negative authorization
conformance belongs to its implementation, not this positive probe.

**Cleanup:** all guest test ports (19100, 19101, 19110) verified unbound;
dedicated VM shutdown requested after collection. Base snapshot and ignored
evidence/disks preserved. Existing arch validation VM was not modified.

**Next:** settle c/j with bounded evidence or a reviewed explicit fallback,
then use the chosen GitHub destination for live CI. Do not tag Phase 0 or begin
Phase 1 before those gates pass. Inspection command: `cat plans/PROGRESS.md`.


## 2026-09-07 — continuation: c/j resolved; live CI destination remains

**Built:** naming-agent boundary probe; independently loaded no-tool fixture in
`scripts/spike-probe/fixture-vendor/`; catalog/slot consumer in
`scripts/spike-probe/src/discovery.ts`; disable/restart test and eleven structural
assertions. No gatekeeper business logic, kernel implementation or new skill.

**Exact VM command:** `CLAWOS_VM_DRIVER=libvirt scripts/vm/test.sh phase-0`.
**Upstream:** OpenClaw 2026.9.2, Node 24.20.0, Ubuntu 24.04. **Snapshot:** `base`.
**Artifacts:** `vm-artifacts/20260907-201658-phase-0/`. **Result: exit 0** including
artifact collection and secret scan.

**Acceptance:** naming schema at 64 characters PASS; live cross-plugin closure
attachment PASS; wrong-cell and disabled-driver denial PASS; service stop clears
slot and rejects retained closure PASS. Baseline remains PASS: 20 correlated
calls, 40 narrowed requests (+1 naming request), device-token reconnect, SQLite,
all five metadata checks, dev Gateway start/stop, three install-policy outcomes.
Eleven assertions are true. S-1 inventory is answered with explicit scope limits.

**Host checks:** probe build/typecheck, workspace typecheck/build, 11 unit tests,
catalog/secret checks, two VM-bootstrap regressions, shell/Node syntax, and
`git diff --check` passed. Twelve conformance TODOs remain unimplemented.

**Plan corrections in this change:** §3.4 gives a 64-character total naming bound
based on OpenAI/Anthropic references, not permissive mock acceptance. §4.2/§5.1
replace the guessed startup enumerator/registration RPC with the catalog plus
lifecycle-owned public SDK runtime-store fallback. Slots are not an identity
boundary against native plugins. Security/kernel integration remains Phase 3.

**Remaining gate:** no Git remote or live CI run. A read-only lookup could not
resolve an accessible `ControlStackAI/openclaw-os`; GitHub owner/repository was
requested, with no answer yet. Nothing was published. No phase tagged or merged;
Phases 1–7 remain untouched. This is a CI-destination block, not a failed spike.

**Cleanup:** guest listening sockets showed only SSH (22) and local DNS (53);
test ports 19100, 19101 and 19110 were unbound. Dedicated VM clean shutdown confirmed; immutable
base and ignored artifacts preserved. Production Gateway and other VM untouched.

**Next:** use the selected GitHub destination, push this reviewable branch and run
CI; require a green run before the Phase 0 merge/tag and Phase 1. See the
current `plans/spike-S1.md` and `docs/phase-checklist.md` for evidence.

## 2026-09-07 — authorized repository publication and live CI

**Repository:** https://github.com/ControlStackAI/openclaw-os, verified private,
default branch `main`. Matt authorized creation in ControlStackAI. HTTPS origin
configured; scaffold `main` and prepared `phase/0-bootstrap` pushed.

**Live CI:** https://github.com/ControlStackAI/openclaw-os/actions/runs/34160492903
completed **success** at `dbb663c`. Frozen dependency install, catalog and secret
checks, typecheck, build, 11 unit tests, pinned upstream installation and all five
plugin metadata checks passed. Output: `OpenClaw 2026.9.2 (3928bad)`. Twelve
conformance TODOs remain TODOs, not passes. Existing fresh-base VM acceptance
`vm-artifacts/20260907-201658-phase-0/` remains the runtime evidence (11 assertions).

**Publication fix:** GitHub rejected the scaffold conformance-matrix workflow
before execution (run 34160489943). Quoted its flow-map expression and changed a
colon-containing plain run scalar to a block scalar in `8f5770a`; both workflow
files parse successfully. This does not implement or dispatch Phase 7. Follow-up
CI: https://github.com/ControlStackAI/openclaw-os/actions/runs/34160573000.

**State:** destination and live-CI blockers resolved. No phase merge/tag or
Phase 1 implementation in this repository-creation step. Production and VM
state untouched. Next project step is the Phase 0 merge/tag checkpoint.

## 2026-09-07 — Phase 0 complete

**Acceptance:** all Phase 0 gates passed. Fresh-base VM run
`CLAWOS_VM_DRIVER=libvirt scripts/vm/test.sh phase-0`, artifacts
`vm-artifacts/20260907-201658-phase-0/`, exit 0, eleven assertions;
OpenClaw 2026.9.2 on Ubuntu 24.04. Live CI on `8f5770a` completed success:
https://github.com/ControlStackAI/openclaw-os/actions/runs/34160573000.
The evidence-only changes since that run do not change executable code.

**Checkpoint:** merge into main with the acceptance run in its message and tag
`phase-0`. No kernel conformance claimed: twelve TODOs belong to later phases.
**Next:** Phase 1 host layer/installer, isolated worktree, fresh-base VM acceptance;
macOS acceptance requires a suitable separate host and is not waived.

## 2026-09-07 — Phase 1 host layer and installer (Ubuntu acceptance green; macOS missing, not tagged)

**Built.** `installer/install.sh`, `installer/preflight.sh`, `installer/systemd/clawos.conf`,
`config/config.d/*`, and `packages/clawos-cli` with `install`, `cell create|list`, `status`,
`doctor`, `config apply`, `backup create|restore`. The CLI is dependency-free (`src/util/`
holds a JSON5-subset parser, patch-compatible merge/diff, mode-enforcing fs helpers, a
sanitising subprocess wrapper, and the single upstream-CLI wrapper `util/openclaw.ts`).

**VM acceptance.** `CLAWOS_VM_DRIVER=libvirt CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state scripts/vm/test.sh phase-1`
from snapshot `base` → **exit 0, 23/23 assertions**, artifacts `vm-artifacts/20260907-213353-phase-1/`.
Install from a Node-less base: **139 s** (criterion: <600 s); whole script 263 s.
Snapshots now `base` (untouched) and `installed` (taken from a separate clean install run).
Ubuntu 24.04, OpenClaw 2026.9.2. Host: 88 unit tests pass; `check:catalog`, `check:secrets`,
`typecheck`, `build` clean.

**Plan corrections made in this phase** (each with the upstream evidence, in the same commit):

1. **§6.2 step 4 was unimplementable.** In 2026.9.2 `config patch` has no `--expect-current-json`,
   no `--expect-current-absent` and no `--merge`. The conditional-write flags are `config set`-only,
   apply to a single operation, and are explicitly incompatible with batch mode and `--dry-run`;
   `--merge` is a `config set` flag a patch does not need, since a patch already merges recursively.
   Verified in `docs/cli/config.md` §"Conditional writes" and `dist/config-cli-BAjpm1Yf.js`.
   The obvious repair — per-path `config set --expect-current-json <value>` — was **rejected**: it
   would put the expected current value of every OS-owned path, `gateway.auth` included, into an
   argument vector. **Replacement:** ownership digests in `os/clawos.lock.json`, computed over
   upstream's *redacted* config snapshot. Concurrent edits are still detected and still fail closed;
   no value reaches argv or the lockfile. Limits stated in the plan: a change confined to a secret's
   value is invisible (the OS owns no credential leaf directly), and the check-then-write race is
   closed only in the observable direction, backed by upstream's own snapshot guard.
   Proven in the VM, not just asserted: an external `openclaw config set gateway.bind lan` makes
   `clawos config apply` exit 1 naming `gateway.bind`, write nothing, and recover under `--force`.
2. **§10.2's `curl … | bash` does not exist.** The repository is private and no `@clawos/*` package
   is published, so there is no registry path either. The installer now detects the
   piped-without-a-checkout case and reports what is missing; the plan no longer advertises it.
3. **§10.3 step 6 (plugins) is deferred, not done.** `clawos install` reports `deferred` for the
   kernel and gatekeeper-fs rather than claiming a postcondition it cannot meet. `10-plugins.json5`
   ships **empty**: declaring `enabled: true` for a plugin that does not exist produced an upstream
   stale-entry warning and asserted an enablement the system cannot honour.
4. **§3.3 `os/backups/` cannot be the archive output.** Upstream rejects an output path inside the
   source state tree, so archives live in `~/.clawos/backups/<cell>/`. Upstream restore is also never
   in place, so `clawos backup restore` performs upstream's documented activation sequence and keeps
   the displaced state at `<stateDir>.pre-restore-<ts>`.
5. **The `doctor --lint` criterion changed from "exit 0" to "no error-severity findings."** Exit 0
   means zero findings of any severity, and the hardened baseline deliberately produces two warnings
   (`node-hosting-preconditions`: loopback-only bind; `skill-workshop-tool-policy`: `skill_workshop`
   outside the `messaging` profile). Reversing either to win a green exit code would weaken the
   posture Phase 1 exists to establish. The third warning was a **real defect and is fixed**:
   `gateway.auth.token` is now a SecretRef (`{source:"env",provider:"default",id:…}`), which is on
   upstream's SecretRef credential surface, instead of a `${ENV}` string in a plaintext field.

**Other defects found and fixed during acceptance** (each was a genuine failure first):
`preflight` demanded `npm` before Node exists on a clean host; `pnpm` was absent and is now
provisioned at the version pinned in `packageManager`, never `latest`; `config apply` restarted a
Gateway whose unit step had not run yet; `--force` was short-circuited by the in-sync check; the
backup manifest's `archivePath` already includes the archive-root segment; `lv_shutdown` failed on
an already-stopped domain; and my own `tar … | grep -q` check was a false negative under `pipefail`.

**Security posture.** Secrets never enter argv: structured config goes to upstream by `--file`, the
Gateway token lives only in `~/.openclaw/.env` (600) behind a SecretRef, and `config get` reads the
redacted snapshot. `sanitize()` is a backstop on all captured output. Test fixtures for the redactor
are assembled at runtime so `check:secrets` stays strict rather than getting an exclusion.
Phase-1 artifact collection is allowlisted structural evidence; the raw `openclaw.json` and `.env`
are never collected.

**VM state sharing.** `CLAWOS_VM_STATE_DIR` lets a phase worktree reuse the bootstrap worktree's
immutable `base` snapshot **without** weakening the disk-ownership check: the path must resolve, end
in `scripts/vm/.state`, belong to a worktree of this repository (same `git --git-common-dir`), and
contain `tester.qcow2` and `ssh-key`. Rejection verified against `/tmp`, `~/.openclaw`, and a
nonexistent path. Named snapshots remain immutable. `alinaos-arch-validation` untouched; no
development-host OpenClaw or production service was invoked or changed.

**Not done, and why.**
- **macOS acceptance is missing.** No macOS host is available (`alina` is NixOS, `arch-zbook` is
  Arch); Lima on Linux runs Linux. The plan's Phase 1 acceptance requires a clean macOS machine, so
  **`phase-1` is not tagged and Phase 1 is not claimed complete.** This is a missing criterion, not a
  waived one. `preflight.sh` handles Darwin and `clawos install` is systemd-specific in its service
  step, so macOS (launchd) support is expected to need work, not just a test run.
- **The 12 conformance tests remain `todo`** and Phase 1 asserts none of them. The kernel is Phase 3.
  `test/phase-1.sh` records this in `scope.json` so a green Phase 1 cannot be misread as conformance.
- `pnpm lint` has no `eslint.config.js` (pre-existing Phase 0 gap; CI does not run it).
- `clawos status` reports host-layer health only and names `os.status`, grants and approvals as
  not observed, because those are kernel surfaces that do not exist yet.

**Next:** a macOS host for the remaining criterion, then tag; otherwise Phase 2 (contracts and kit).


## 2026-09-07 — Phase 1 resumed: atomic reconciliation repair and launchd preparation

**Supersedes the earlier concurrency claim:** `4421cfa`'s digest precheck was not atomic,
and its post-read only stored digests. The original 23/23 acceptance did not exercise the
check-to-write window. Replaced the real CLI patch with the installed public SDK
`config-mutation` transaction (`baseHash`, canonical cross-process lock, guarded publication).
The separate helper receives only paths and a revision; it suppresses SDK error values.
Each apply stages its own private candidate; generated/lock checkpoints advance only after
persisted-revision and lint checks. No upstream source modified or private subpath imported.

**Other fixes:** failed ownership reads are no longer interpreted as absence; lint error
findings block checkpoints; `--force` does not bypass the transaction and restarts when
recovering restart-requiring drift; named-cell reconciliation uses its actual port; child
state/config/profile/port selectors are explicit. Backup refuses to move state if Gateway
stop fails and uses upstream lifecycle commands on both platforms.

**macOS preparation:** upstream-owned LaunchAgent install/start, label-aware status/doctor,
reserved-label rejection, dotenv OS environment, and lsof port preflight. Unit/static checks
only; no macOS runtime claim. Requested an available disposable Mac; no machine identified yet.

**Verified:** first fresh-base Ubuntu run `vm-artifacts/20260907-222050-phase-1/`, command
`CLAWOS_VM_DRIVER=libvirt CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state scripts/vm/test.sh phase-1`,
exit 0, **25/25 assertions**, 356 seconds total. The new PATH shim injects an upstream edit
AFTER dry-run, removes itself before SDK resolution, and proves refusal under `--force`,
preserved external value, unchanged lockfile, then successful recovery with identical input.
This run predates the final staging/read/lint/backup changes. A second fresh-base acceptance
is currently running against the complete patch; it is **pending**, not counted as passed.

**Local final-patch checks:** workspace typecheck/build, **92 unit tests** (12 conformance
TODOs not passes), catalog/secret checks, shell syntax and `git diff --check` passed.
One added unit-test fixture initially failed because a `beforeEach` returned a mock function,
which Vitest treated as cleanup; corrected the fixture and all checks passed.

**Gates:** Phase 1 remains unmerged/untagged, macOS acceptance missing; no Phase 2 advance.
The old `installed` snapshot contains `4421cfa` and is **stale** for later phases; preserve it
until a new clean-install checkpoint can replace it. Production and unrelated VM untouched.

### Final-patch retest failure and correction

The second run failed at `gateway install`: `OPENCLAW_PROFILE=""` was rejected by the native-service
canonical identity guard. It is **not** equivalent to an unset selector there. Changed it to explicit
`default`; named cells retain their names. The failure has a clear pinned-source cause
(`isDefaultInstallIdentity` calls `resolveProfileStateDir` with the empty value). The test run was
stopped after the failed install to avoid cascading checks against an uninstalled Gateway; no full
verdict or snapshot is claimed. A fresh-base retest follows. Atomic config writes had completed.

### Backup stop regression and harness collection failure

Run `20260907-223137-phase-1` passed **24/25**, but backup restore refused before moving
state because upstream requires `gateway stop --force` for the default operator service.
A sanitized diagnostic confirmed the explicit refusal. `restore --yes` authorizes the
selected-cell stop, so the wrapper now supplies `--force`; it still fails closed on any stop
failure. The host collector also hit a shell syntax error because the running harness was
edited before it returned from the guest. Its complete guest verdict was 1; collection was
recovered separately with `collect.sh` and no full harness pass is claimed. Future changes
are finished before launching a harness, never while its shell is still reading the file.

CI for `422128e` passed on push and draft PR: runs 34167145981 and 34167148927. Fresh
acceptance of the backup correction follows before refreshing the installed snapshot.


## 2026-09-07 — Phase 1 Ubuntu accepted; installed snapshot refreshed; hosted macOS running

**Complete final-code Ubuntu acceptance:** `CLAWOS_VM_DRIVER=libvirt
CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state scripts/vm/test.sh phase-1`,
`vm-artifacts/20260907-223901-phase-1/`, **exit 0, 25/25 assertions**, 291 seconds total.
Includes the actual after-dry-run race, unchanged checkpoint, successful recovery,
two concurrent cells, and the corrected backup stop/restore/healthy round-trip.

**Clean installed snapshot:** same command with `base install-only`, artifacts
`vm-artifacts/20260907-224639-phase-1/`, exit 0, three preparation checks (install,
under-ten-minutes, healthy). This exits before deliberate drift/second-cell/backup mutations;
it is explicitly not full acceptance. Replaced stale `installed` after that successful clean
install, creation 15:49 PDT; base snapshot metadata hash unchanged. Dedicated VM stopped.

**Hosted macOS attempt:** added `github-hosted` adapter plus a dedicated workflow in `88bbe26`.
It requires the genuine Actions hosted-macOS environment, checkout match, no existing cells,
and a one-use runner marker. Re-running on a dirty runner or using it on the development host
fails closed (host rejection verified). Platform-specific assertions use launchd/lsof/BSD stat;
Linux remains the Node-less install target. Both still enter through the VM harness.
Only allowlisted structural artifacts are uploaded, not raw config/dotenv or LaunchAgent env.
Run https://github.com/ControlStackAI/openclaw-os/actions/runs/34167820614 is **pending**.

**CI:** `88bbe26` push/PR runs 34167820496 and 34167822735 passed; 92 unit tests and 12
conformance TODOs. Shell syntax and both VM-bootstrap regressions passed for the harness.
No Phase 1 merge/tag yet; macOS is the remaining gate. Review:
https://github.com/ControlStackAI/openclaw-os/pull/1.


## 2026-09-07 — Phase 1 acceptance complete

**macOS full acceptance:** https://github.com/ControlStackAI/openclaw-os/actions/runs/34167820614,
commit `88bbe26`, fresh GitHub-hosted macOS 14 VM through `scripts/vm/test.sh phase-1`.
Downloaded artifact `20260907-224656-phase-1` verified: **exit 0, mode full, Darwin, 25/25**,
install **65 seconds**, both cells healthy (firma port 18801), backup restore ready with
Doctor exit 0, healthy after restore, zero error-severity lint findings, zero critical audit
findings. Local copy: `vm-artifacts/github-macos-34167820614/` (ignored). Actions collection
and artifact upload passed; no separate physical Mac is required for this criterion.

**Ubuntu full acceptance:** `20260907-223901-phase-1`, exit 0, **25/25**, install 118 seconds.
**Clean installed snapshot:** `20260907-224639-phase-1`, install-only exit 0, install 134 seconds;
refreshed installed snapshot and stopped VM; base metadata unchanged.
**CI:** 34167820496 and 34167822735 green at `88bbe26`; 92 unit tests, 12 conformance TODOs.
The evidence-only changes after this revision do not change executable code.

**Checkpoint:** all Phase 1 gates are satisfied. Close PR #1 with a merge commit naming
Ubuntu/macOS evidence and annotate `phase-1`. No upstream edits or production deployment.
The 12 kernel conformance TODOs remain for later phases; Phase 1 does not claim them.
**Next project phase:** Phase 2, contracts and kit, from the completed Phase 1 main checkpoint.

### Phase 1 release checkpoint

All executable changes are accepted on Ubuntu and macOS, and the clean installed snapshot
is refreshed. The phase completion merge is PR #1, annotated as `phase-1`; its merge message
names Ubuntu run 20260907-223901 and macOS Actions run 34167820614. No acceptance criterion
was waived. Worktree/evidence are preserved, and production remains untouched.

## 2026-09-07 — Phase 2 contracts and kit: local acceptance complete

- Branch/worktree: `phase/2-contracts`, `openclaw-os-worktrees/phase-2-contracts`; Phase 1 parent `ed09c80`.
- Commits: `06ff79d` (shared contracts/evidence harness), `2218843` (kit and compatibility adaptations).
- Built: documented `packages/clawos-shared/src/{gatekeeper,grant,schemas}.ts` and wire-boundary tests; kit
  lifecycle builder, OAuthNonceMachine, TokenStore, OverlayStore, CacheMutationStore, ActionSequencer,
  KitGatekeeper journal/session lifecycle, sanitizeError, TestApprovalQueue, tests and `SKELETON.md`.
- Existing fs/GitHub scaffold entrypoints were adapted only to the kit's descriptor/action-id API. Their tool
  surfaces and URL patterns are unchanged; implementation and operator reviews remain Phase 3/4 work.
- Exact acceptance command: `scripts/vm/test.sh phase-2`. Explicit host-only exception from `docs/vm-testing.md`;
  no VM reset or Gateway invocation. `vm-artifacts/20260907-232940-phase-2/`: **exit 0**, revision `2218843`,
  Node `v22.23.2`, upstream pin `2026.9.2`, **86 library tests** (39 shared + 47 kit), typechecks, catalog and
  secret checks pass. Command log, mode, revision, versions and exit code retained.
- Additional commands: `pnpm typecheck` passed workspace-wide; `pnpm test` passed **168 tests**, with **12 TODO
  conformance tests not counted as passes**; `python3 test/vm-bootstrap.test.py` passed 2 regressions;
  `git diff --check` passed. Workspace logs copied into the acceptance artifact directory.
- Acceptance status: all four Phase 2 implementation/library criteria pass; tag/merge still pending live CI.
  Draft [PR #2](https://github.com/ControlStackAI/openclaw-os/pull/2);
  [branch CI](https://github.com/ControlStackAI/openclaw-os/actions/runs/34170233623) running on `2218843`.
- Clarifications recorded in the plan: JSON wire data vs. live callbacks; actual Crockford base32 alphabet;
  definition-time pure action descriptors; observation dry-pass separation; exact trusted synchronous approval
  binding; account/store-authenticated ciphertext; one resource owner per journal; uncertain remote outcomes
  require reconciliation and never blind replay. These libraries do not establish live kernel authorization.
- FORGE's editor denied the external worktree and the child settled without edits; implementation was completed
  in the authorized parent workspace. No filesystem boundary bypass, host runtime install, or production change.
- Open operator questions: none for Phase 2. Next: verify CI, close the phase/tag checkpoint; Phase 3 is kernel
  integration and the reviewed filesystem driver.

### Phase 2 CI and checkpoint verification

- [Branch CI 34170233623](https://github.com/ControlStackAI/openclaw-os/actions/runs/34170233623) passed on
  `2218843`, including typechecks/build/tests, the pinned upstream install and all workspace plugin metadata checks.
  Subsequent branch changes are evidence-only. [PR CI 34170298843](https://github.com/ControlStackAI/openclaw-os/actions/runs/34170298843) also passed.
- Built filesystem/GitHub placeholder modules both import successfully in a Node-only smoke check; no registration
  callback or service was invoked. Their real resource implementations remain unavailable.
- Phase 2 library acceptance remains `20260907-232940`; all required implementation criteria pass.

### Phase 2 completion

All Phase 2 gates are satisfied: recorded library acceptance, workspace checks, branch/PR CI, reviewed contracts and
authoring documentation. Close with the acceptance-named merge and annotated `phase-2` tag. No criteria waived.
Phases 0–2 are complete; next is Phase 3 kernel integration and gatekeeper-fs with its operator tool-surface review.
The 12 unimplemented live conformance tests remain explicit later-phase work. Production and the installed VM snapshot
were not modified. To inspect this checkpoint: `cat plans/PROGRESS.md` from the Phase 2 worktree.


## 2026-09-07 — Phase 3 filesystem contract prepared; STOP 1 pending

- Verified canonical `main` and `phase-2` at `a18d69e`, clean; no prior Phase 3 implementation
  or worktree survived the interrupted turn. Created `phase/3-kernel` in
  `openclaw-os-worktrees/phase-3-kernel` from that checkpoint.
- Prepared inert filesystem definitions in `packages/gatekeeper-fs/src/{tools,resources}.ts`
  and wired the placeholder entrypoint to them. Existing list/read/write names retained;
  closed input schemas, canonical grant handles and structured output schemas added.
- Concrete operator review: `plans/REVIEW-REQUESTED.md`. Includes local-only file URLs,
  explicit roots, no ambient access, relative paths, no symlink escape, encoded byte limits,
  bounded nonrecursive listing, external-edit refusal and owner-only audience requirements.
  These runtime requirements are proposed, not implemented or tested by schema checks.
- Checks passed: `pnpm install --frozen-lockfile --offline --ignore-scripts` (488 cached
  packages, no downloads); `pnpm --filter @clawos/gatekeeper-fs... build`;
  `pnpm --filter @clawos/gatekeeper-fs typecheck`; `pnpm check:catalog`;
  `pnpm check:secrets`; `git diff --check`. A TypeBox metadata smoke check validated all
  three definitions, representative inputs/outputs, resource mapping, malformed-handle
  refusal, caller identity-field rejection and description rules.
- No new persistent tests for this metadata-only preparation. No Phase 3 acceptance run,
  no VM snapshot restore/change, no OpenClaw CLI invocation, no live driver or kernel
  implementation, no merge/tag, and no production changes. Pin remains `2026.9.2`.
- Stop source: `.agents/skills/write-gatekeeper/SKILL.md` step 3 explicitly requires tool
  surface and URL-pattern operator review before driver implementation. Earlier Continue
  requests did not review this concrete contract. STOP 2 is not reached or waived.
- Next: operator review of the linked contract; after approval continue the ordered kernel
  implementation and filesystem driver up to STOP 2. Phases 0–2 remain complete;
  every Phase 3 acceptance criterion remains open.


## 2026-09-07 — Phase 3 STOP 1 approved; account/resource boundary prepared

- Operator “continuew” follows the concrete approval request for `7642efb`; recorded as
  STOP 1 approval, not a waiver of STOP 2. Contract preserved at `plans/fs-contract.md`.
- Implemented `gatekeeper-fs/src/{paths,account,directory,vendor}.ts`: strict original URL
  validation, copied explicit roots, directory identity binding, per-operator account
  lifecycle and revocation. Missing/malformed roots and symlink components deny.
- Existing kit lifecycle registration retained, deploy-inputs added, catalog/package
  metadata connected. Runtime sessions, reads, writes, observers and actions all deny.
- Host fs typecheck and **45 boundary tests pass**. These tests are not race-safe I/O
  proof; no file-I/O primitives are implemented. Focused VM verification is pending.
- Added explicit `scripts/vm/test.sh phase-3 installed fs-boundary` mode and allowlisted
  evidence collection. This pre-runtime authoring checkpoint is not full Phase 3 acceptance.
- Kernel runtime steps remain ordered and outstanding; no runtime plugin installation,
  grant activation, production config change, phase merge or tag. STOP 2 review is concrete
  in `plans/REVIEW-REQUESTED.md`; verify boundary first, then present it for approval.


### STOP 2 boundary verification

- Implementation commit **`6ac764f`**. Exact command:
  `CLAWOS_VM_DRIVER=libvirt CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state scripts/vm/test.sh phase-3 installed fs-boundary`.
- `vm-artifacts/20260908-031021-phase-3/`, restored **installed**, harness and boundary
  exit codes **0**; JSON report verified **45/45**, no failed/pending tests. Node
  **v24.20.0**, upstream pin **2026.9.2**. Shared/kit/fs build, fs typecheck,
  catalog and secret checks passed. Allowlisted artifact collection passed.
- Explicit scope: `fullPhaseAcceptance:false`, `fileOperationsEnabled:false`.
  This did not invoke OpenClaw or install/enable runtime plugins. Introduction metadata
  and directory identity were exercised; race-confined list/read/write remain unimplemented.
- Host checks: focused build/typecheck/45 tests, catalog/secrets, shell syntax, diff checks
  and **2 VM-bootstrap regression tests** passed. No need to repeat full workspace tests
  for this isolated disabled-data-plane checkpoint; earlier phase results are not new passes.
- STOP 2 review is `plans/REVIEW-REQUESTED.md`. Approval is needed for the skill’s later
  responsibilities 4–7. Full kernel integration and Phase 3 conformance remain outstanding.
  No phase merge/tag or production change. Base/installed snapshots were not replaced.


## 2026-09-07 — STOP 2 approved; Phase 3 enforcement resumed

Operator explicitly approved the concrete STOP 2 at `fc8b33f`. Continuing authorization,
simulation, caching, and observer enforcement in the existing worktree. Both authoring
stops are satisfied; no production directory access or deployment authorized. Kernel
integration is assigned to FORGE; parent owns filesystem implementation and acceptance.
Unsafe replacement operations remain disabled unless atomic external-edit protection can
be established; a check followed by rename does not satisfy the approved contract.


## 2026-09-07 — restart recovery: filesystem enforcement checkpoint verified

- Recovered the preserved worktree after a Gateway restart. Complete focused evidence
  exists at `vm-artifacts/20260908-035125-phase-3/`: harness exit **0**, enforcement exit
  **0**, JSON success **true**, **73 passed / 0 failed / 0 pending**. Node **24.20.0**,
  upstream pin **2026.9.2**, snapshot **installed**. Exact acceptance command:
  `CLAWOS_VM_DRIVER=libvirt CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state scripts/vm/test.sh phase-3 installed fs-enforcement`.
- Built `gatekeeper-fs/src/{io,state,directory,account,paths,vendor}.ts`: Linux no-follow
  descriptor reads/listing, byte bounds, linked/special-file refusal, private state,
  persisted resource identity, per-call queue checks, pending overlays and rejection.
  Concurrent symlink-swap and restart/revocation regressions are included. Focused VM
  build/typecheck/catalog/secret checks passed; collection is allowlisted.
- All real resource writes deny, including creation. There is no demonstrated atomic
  confined compare-and-publish primitive. No apply/revert/auto-approval success is claimed;
  this preserves the approved contract's explicit unsafe-operation denial requirement.
  The implementation plan and VM guide now record this limit; acceptance is not waived.
- Scope remains `fullPhaseAcceptance:false`, `liveKernelAcceptance:false`. No runtime
  plugin install, live grants, production changes, phase merge/tag or new phase completion.
- Kernel child remained active after restart; latest visible patch calls failed expected-line
  matching and no kernel acceptance verdict was recovered. Parent review identified missing
  retained-grant revocation checks, observer population, strict RPC validation/scopes and
  call-stash binding; findings sent to the active child. Kernel edits stay separate and
  unaccepted until corrected and verified. Interrupted/uncollected checks remain UNKNOWN.
- Next: collect the kernel handoff, review corrections, then run integrated live VM
  acceptance. Filesystem evidence alone cannot establish the kernel security boundary.


### Kernel handoff recovery blocked

Filesystem checkpoint saved as **`b0113a0`**. Scoped diff/shell checks, catalog/secret
checks and both VM-bootstrap regressions passed; dedicated VM confirmed **shut off**.
The uncommitted kernel/conformance handoff is not accepted: required hooks-fire,
tool-narrowing, gate-blocks and fs-gatekeeper checks currently use `it.skip`, and the
scripted-turn draft does not establish the claimed grant lifecycle.

Restart recovery lists the kernel child as active, but yielding returned “No pending child
completion is owned by this turn”; cancellation returned “Subagent task not found”, then
“Task outside session tree” for the recovered identifier. No bypass attempted. Steering
messages were accepted as queued, not proof of delivery or completion. Worker outcome is
**UNKNOWN**. Do not concurrently replace its uncommitted work or accept skipped tests.
Resume only after a settled handoff or restored worker ownership, then correct the security
and evidence gaps and run live acceptance. No Phase 3 completion or tag.


## 2026-09-07 — next task: fail-closed conformance runner verified

- The kernel worker settled, but its completion delivery failed/truncated. Its worktree draft is preserved;
  settlement is not acceptance. Continued with the next prerequisite: repairing the acceptance runner.
- Replaced the exit-code-only verdict with exact suite selection and JSON assertion validation. Missing,
  empty, skipped/TODO, failed, duplicated, unknown or unreported selected suites cannot pass. Abnormal
  process termination fails. Normal workspace tests now run offline verifier regressions; live suites
  run only in the dedicated live workspace. Raw subprocess/assertion payloads are not put in verdicts.
- Replaced the parameterless CLI RPC shim with the previously verified public SDK GatewayClient.
  Explicit endpoint/state, structured in-memory params, bounded handshake/request lifecycle, sanitized
  failures, cleanup and no exposed token field. The health test uses the requested endpoint.
- Corrected stale checklist entries: both filesystem STOP reviews were already approved. No new approval
  is required for this runner repair. No gatekeeper surface or filesystem data-path change.
- Host: conformance build/typecheck, **36/36 regressions**, catalog/secrets, diff/shell checks and
  **2/2 VM-bootstrap regressions** passed. Initial unit failures had clear fixture causes: asynchronous
  SDK import before fake-timer advancement, and pnpm resolving the parent package instead of the fixture.
  Both were corrected; real Vitest fixtures now distinguish pass, skip, failure and empty suite.
- Exact acceptance command: `CLAWOS_VM_DRIVER=libvirt
  CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state
  scripts/vm/test.sh phase-3 installed conformance-runner`.
  Evidence: `vm-artifacts/20260908-051842-phase-3/`; harness **exit 0**, **36 passed/0 failed/0 pending**,
  Node **24.20.0**, upstream pin **2026.9.2**. Build/typecheck/catalog/secrets and allowlisted collection pass.
- Real installed-guest SDK smoke: health RPC, parameterized `sessions.list`, wrong-endpoint refusal,
  sanitized failed RPC all pass (`transport.json`). All three HTTP health endpoints pass (one test).
  The deliberately selected still-skipped `hooks-fire` suite returns **exit 1 / ok:false** as required;
  that rejection is runner evidence, **not** a passing hooks-fire conformance result.
- Scope is `fullPhaseAcceptance:false`, `liveKernelAcceptance:false`, `hostWritesEnabled:false`.
  No kernel plugin install, live grants, production change, upstream modification, merge, push or phase tag.
  The SDK may maintain device identity in the disposable guest, as in S-1; no credentials are collected.
  The VM is stopped after collection; base/installed snapshots are not replaced.
- Kernel changes, the other unfinished live suites and scripted scenario remain a separate unaccepted draft.
  Next task: implement real hooks/narrowing/unknown-grant scenarios, repair live plugin installation,
  then verify kernel authorization/revocation/observer/RPC boundaries before full Phase 3 acceptance.
  The earlier worker route was reported as `openai/gpt-5.6-sol` → `openai/gpt-5.3-codex-spark`;
  this is a historical worker notice, not a claim about the current parent model.


## 2026-09-08 — live kernel enforcement checkpoint verified

Continued from `9355b13`; the settled worker's kernel draft was reviewed and corrected
in the authorized Phase 3 worktree. This is a focused checkpoint, not Phase 3 completion.
Both filesystem authoring approvals remain satisfied; no new tool surface or URL policy.

**Implementation:** shared full/discovery kernel runtime, validated static catalog/live
attachment, current cell/agent/session grant checks, parameter-bound one-shot call stash,
exact per-session approval queue identity, separate execution/audit lifetime, retained-session
closure on revocation, scoped grants listing, strict paired device-token operator RPCs,
observer-aware queues. The fs driver was not changed; all real filesystem writes still deny.
An already-authorized no-credential account may be reconstituted when resolving a persisted
grant; restart recovery of a live grant is not claimed by this run.

**Loader corrections:** embedded the existing config schema because the pinned validator
rejects unresolved manifest-local `$ref`. Declared the three already-approved fs tools on
the registering kernel's `contracts.tools`. Static catalog registration without that contract
was rejected by the host. Updated implementation plan/reference with both observed facts.

**VM failures retained (all exit 1, clear causes):**
- `20260908-163205-phase-3`: unresolved manifest schema ref; before Gateway startup.
- `20260908-163332-phase-3`: fs tool registrations dropped for missing manifest contracts.
- `20260908-163520-phase-3`: valid fs call denied by the kit's exact queue identity check;
  kernel incorrectly constructed fresh queues for dry/real calls. Fixed the kernel; retained
  the kit's authority check. No failure was treated as acceptance.

**Passing live command:** `CLAWOS_VM_DRIVER=libvirt
CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state
scripts/vm/test.sh phase-3 installed kernel-live`.
Artifacts `vm-artifacts/20260908-163653-phase-3/`: harness/live exit **0**, pinned
OpenClaw **2026.9.2**, Node **24.20.0**, **6/6 kernel tests**, **48/48 structural checks**,
eight real agent turns through the local deterministic provider. The four selected suites
pass **23/23 assertions / zero skipped**: hooks-fire 4, tool-narrowing 5, gate-blocks 7,
fs-gatekeeper 7. Grant creation/list/read, path escape refusal, hook-ID correlation,
successful-call/observation/revocation audit, and next-turn removal after revocation pass.
Shared Gateway auth alone and client-supplied operator identity cannot introduce grants.
A separate write-scoped client is verified `senderIsOwner:false`; its pasted URL creates
no grant. This is actual non-owner RPC traffic, not a claimed Telegram channel test.
After Gateway restart with kernel conversation hooks disabled, fs tools are visible,
the unknown-handle call is denied, and the independent trusted-policy audit confirms why.

**Evidence integrity:** passive fixture registers no tools or policies and cannot create
grants. All model traffic stays inside the VM; only names, call IDs, lifecycle flags and
fixture-match booleans are collected. Raw configuration, prompts, credentials and tool
bodies are excluded. Live conformance requires matching current-run evidence, all true
checks and no scenario failure; missing/stale reports fail, not skip.

**Runner follow-up:** updating hooks-fire required replacing the old deliberately skipped
suite assertion in `conformance-runner` with missing-current-evidence refusal. Fresh
`installed` run `20260908-163926-phase-3` exited **0**: **36/36 runner regressions** (including
real Vitest skipped/empty/failed fixtures), actual SDK parameterized/error/endpoint smoke,
health 1/1 and expected missing-evidence hooks-fire failure. Both runs pass build/typecheck,
catalog and secret scans, and allowlisted collection. Host affected typechecks, diff check,
catalog/secrets and **2/2 VM-bootstrap regressions** pass.

**Remaining:** plugin installation/projection and CLI integration; CLI grant/audit commands;
channel-origin operator URL introduction (before_prompt_build precedes before_agent_run
on this RPC path, so same-turn introduction/narrowing ordering needs review); live install
gate (draft reads guessed source/hash fields rather than the typed sourcePath/request
contract); remaining observer/egress and approval integration. Legacy full-test/script and
other live-suite drafts are preserved but unaccepted. No full-phase green, merge/tag, push,
production runtime invocation, production grants, upstream edits, or snapshot replacement.
**Next:** installer/CLI integration and the remaining real Phase 3 acceptance gates.

## 2026-09-08 — paired operator CLI checkpoint verified

Continued from `f74cb24` in `phase/3-kernel`. Added strict `clawos` commands for
kernel status, grant add/list/revoke, bounded audit tail, gatekeeper listing and
approval decisions. The client resolves the installed public Gateway SDK in an
explicitly cell-scoped subprocess, bootstraps device pairing, closes the shared
connection, then sends operator RPCs over a separate device-authenticated connection.
Structured parameters travel over stdin; raw upstream diagnostics and credentials
never reach argv/output. No direct kernel database access or upstream modifications.
Mounted `openclaw os` commands forward through this same installed client and reject
cell/profile/state/config disagreement. Real filesystem writes stay disabled.

The focused live harness now packs/installs the actual CLI, registers a canonical
named guest cell at `/home/tester/.openclaw-kernel-test`, and drives the original
read/revocation scenarios through real CLI grant mutation. Eight current-run CLI
assertions join the existing live suites. Other legacy acceptance drafts remain
unaccepted and are not included in this change.

Failed runs retained (all `phase-3 installed kernel-live`, all exit 1):

- `20260908-171213-phase-3`: source `bin/` PATH did not select a `clawos` executable;
  the snapshot's old CLI ran. Harness now packs and globally installs the tarball.
- `20260908-171403-phase-3`: direct paired CLI status passed; mounted `os` command
  was unknown. Added documented `cliCommands` and runtime descriptors.
- `20260908-171615-phase-3`: command still unknown; full-only CLI registration
  excluded `cli-metadata`/`discovery`. Moved inert declarations before construction.
- `20260908-171910-phase-3`: command discovered (`os --help` lists subcommands),
  but the strict JSON assertion failed. Paused edits for read-only diagnostics:
  isolated mounted status exited 0 with zero stdout bytes and output on stderr.
  Corrected console logging to direct stdout plus the SDK machine-output resolver.
  Diagnostic start/status/stop was not acceptance and collected only structural flags.

Host CLI tests: **111/111**. CLI/kernel typechecks and catalog/secrecy/diff/syntax
checks pass; VM bootstrap tests **2/2**. The metadata validator's host guard refused
execution before any upstream import/invocation; no host metadata validation is claimed.
The final live acceptance is recorded below. No phase acceptance, push, merge, tag,
production state access, real filesystem write, or snapshot replacement.


**Passing command:** `CLAWOS_VM_DRIVER=libvirt
CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state
scripts/vm/test.sh phase-3 installed kernel-live`.
Artifacts `vm-artifacts/20260908-172236-phase-3/`: harness/live **exit 0**,
OpenClaw **2026.9.2**, Node **24.20.0**. **31/31 live assertions**, zero skipped:
hooks-fire 4, tool-narrowing 5, gate-blocks 7, fs-gatekeeper 7, cli-mounted 8.
All **56 structural scenario checks** pass over eight real agent turns.
Guest tests: CLI **111/111**, kernel **11/11** (including cell-selector refusal).
The actual CLI creates the resource grant used for listing/reading, lists it,
revokes it, and retrieves matching observation/revocation audit records. The
mounted upstream command returns parseable JSON for the correct cell. Wrong-cell
and forged-identity CLI inputs deny. Unknown-handle policy denial still passes
with conversation hooks disabled. Catalog/secrets and allowlisted collection pass.

**Scope still incomplete:** no installer plugin projection or live install-policy
acceptance. The existing install hook still uses guessed source/hash fields instead
of the typed `request`/`sourcePath` contract; do not call that gate verified. Channel
URL introduction/ordering, observer/egress, approval decision integration and manual
Telegram acceptance remain. Audit time filtering is not implemented. Approval CLI
verbs have grammar coverage but their driver outcomes are not accepted by this run.
No full Phase 3 green, phase tag, merge/push, production change, upstream edits or
snapshot replacement. Next: installer/projection and the shared primary/secondary
install-policy implementation, then the remaining Phase 3 gates.

## 2026-09-08 — installer/policy integration in progress

Continued from `a9ba4ba`. The CLI now builds and ships self-contained first-party
kernel/fs plugins, their static catalog and a standalone primary-policy script.
`clawos install` deploys content-addressed artifacts beneath the selected cell's
`os/plugins/`, with empty fs roots and empty third-party install allowlists, then
projects native plugin allow/load configuration and a trusted absolute Node policy
command. The primary executable and typed secondary hook share one fail-closed
evaluator over `request.requestedSpecifier` and measured staged-file bytes.
No published npm package, upstream modification or implicit resource grant.

Installer postconditions now require paired kernel/fs health and a parsed deep
audit with zero critical findings. The first-install `config.state.json` handoff
no longer overwrites ownership digests refreshed in an existing lockfile.
Linux and launchd restart paths account for changed plugin/config artifacts.

Failed focused VM runs (all restored original Phase 1 `installed` snapshot):

- `20260909-000036-phase-3`, exit 1: packaged kernel lacked `config.schema.json`.
  Safe read-only audit inspection confirmed the exact missing asset. Required
  asset copying and actual kernel/audit postconditions added.
- `20260909-000335-phase-3`, exit 1: kernel/fs healthy and audit zero critical,
  but repeat install refused the kernel/fs owned paths. The installer replaced
  current lock digests with stale first-install handoff digests; precedence fixed.
- `20260909-000544-phase-3`, exit 1: repeat install and healthy no-grant runtime
  passed. Real plugin installation was refused before evaluating OS policy:
  npm had installed the CLI script and parent directories group-writable (775).
  Upstream correctly rejected that interpreter script. Replaced the npm-script
  policy target with a mode-600 self-contained payload under mode-700 OS state;
  no trusted-exec guard was weakened and no upstream file was altered.

Host checks so far: CLI 114/114, shared install-policy 3/3, affected typechecks,
VM-bootstrap 2/2, catalog, secrecy and diff checks. Legacy full-phase/other live
suite drafts remain preserved. Primary live acceptance is still pending at this
entry; secondary Gateway hook and full Phase 3 acceptance remain separate.

- `20260909-000926-phase-3`, exit 1: protected standalone policy worked;
  unlisted source denied and operator policy reconciliation passed. The explicitly
  allowed inert fixture reached installation but upstream required its separate
  capability consent. The VM fixture install now supplies documented
  `--accept-capabilities`; neither consent nor `--force` bypasses primary policy.

**Passing primary-policy command:** `CLAWOS_VM_DRIVER=libvirt
CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state
scripts/vm/test.sh phase-3 installed install-integration`.
Artifacts `vm-artifacts/20260909-001359-phase-3/`, harness/install exit **0**,
OpenClaw **2026.9.2**, Node **24.20.0**. Primary `install-gate` conformance
**8/8**, zero skipped; **11/11 structural scenario flags** true. Source install,
repeat no-op install, healthy bundled kernel/fs and zero default grants passed.
Real native local-plugin install denies an unlisted source even with force and
capability consent, installs after exact operator allowance, and fails closed
when the policy executable is unavailable. Forged source/hash labels, malformed
JSON and invalid protocol deny; normal ownership-aware policy restoration passes.
Guest CLI **114/114**, shared policy **3/3**, kernel/CLI typechecks and catalog/
secrecy checks pass. Artifact collection is allowlisted and exited successfully.

Full fresh-base installer regression is running separately; no phase-completion,
secondary Gateway-hook, macOS integration or new snapshot claim yet.


## 2026-09-08 — gateway restart recovery

Fresh-base regression `20260909-001807-phase-1` was interrupted by the host
gateway restart. The host log ends after 11 passing checks; no exit-code or
collection result exists. Guest recovery JSON reports success, but no guest
harness remains running. Overall outcome **UNKNOWN**, not pass or failure.
The prior primary-policy report remains intact. No running script was edited.
A fresh-base rerun will establish the full regression result. The older Phase 1
scope text was corrected to describe bundled kernel/fs health without claiming
full Phase 3 conformance.

Recovery review strengthened the policy-outage scenario to use a fresh, exactly
allowlisted fixture and require an install-policy diagnostic plus no installed
target. The earlier outage flag alone could also have meant “already installed”;
it is superseded by the strengthened rerun, not standalone proof of this criterion.
Shared evaluator now also rejects registry namespace URL/file/npm-alias overrides;
current host package-scoped tests pass CLI114/114 and policy4/4. An initial
root-workspace test invocation failed four RPC fixture checks because its cwd
resolved bin/gateway-rpc.mjs at the repository root; corrected package-scoped
invocation passes. Affected typechecks, catalog/secrecy, shell syntax, diff and
VM bootstrap2/2 pass. No runtime code change during the clean-base run.


**Fresh-base regression PASS:** `CLAWOS_VM_DRIVER=libvirt
CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state
scripts/vm/test.sh phase-1 base`. Restart-resilient service
`clawos-p3-fresh-recovery`, artifacts `vm-artifacts/20260909-002725-phase-1/`,
harness/collection exit0, **25/25** checks, zero failures. Install179s (under600s),
entire suite371s, OpenClaw2026.9.2 (3928bad), Node24.20.0. Healthy source install,
zero-critical audit (one warning/one info), repeat install, reconciliation no-op,
concurrent-edit/atomic-race refusal and recovery, two live cells with separate
ports/state/keys, OS-inclusive backup and restore, post-restore health, upstream
unit/drop-in separation and permissions all passed. Original base/installed
snapshots are retained; no replacement snapshot or full Phase3 acceptance.
Strengthened focused policy acceptance is running next from original installed.


**Strengthened primary-policy PASS:** `CLAWOS_VM_DRIVER=libvirt
CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state
scripts/vm/test.sh phase-3 installed install-integration`, independent service
`clawos-p3-policy-recovery`. Artifacts `vm-artifacts/20260909-003432-phase-3/`,
harness/install/collection exit0; **8/8 live conformance assertions**, no skips;
**12/12 structural flags**, including the fresh-fixture outage precondition.
Real unlisted source denies; exact operator allowance installs the inert fixture;
a distinct allowed/not-yet-installed fixture denies with an install-policy error
when the executable is unavailable. CLI114/114 and shared policy4/4 guest tests
pass; affected typechecks, catalog/secrecy checks pass. Node24.20.0, pinned
OpenClaw2026.9.2(3928bad), original installed snapshot. This supersedes the earlier
outage-only assertion weakness; no failed acceptance was silently relabeled.

Dedicated `clawos-test` confirmed **shut off** after collection. Immutable base
(2026-09-07 11:38 PDT) and installed (15:49 PDT) snapshots unchanged. No upstream
modifications, production config/state access or real granted-file writes.

**Checkpoint scope:** installer projection and shared primary/secondary install
policy implementation complete; primary live acceptance verified. Secondary hook
is typechecked and shares the tested evaluator, but a live Gateway-backed hook
installation is still unverified. Channel URL introduction/order, observer/egress
and approval decision integration, full Phase3 gate and macOS remain unaccepted.
No phase3 tag, merge, push or snapshot replacement. Existing unrelated full-phase
conformance/test drafts remain unstaged and preserved. Next: the remaining
Phase3 acceptance paths, beginning with secondary Gateway hook evidence.

## 2026-09-08 — secondary Gateway install fixture drafted; VM restore blocked

Continued from `f1e7a8f`. Added `install-hook` acceptance mode, a passive VM-only
before/after install monitor, and public-SDK authenticated archive scenarios.
The independent primary fixture bundles the existing production evaluator and
uses test-only rules; the real kernel's hook is neither patched nor invoked
directly. Draft assertions cover primary-before-hook ordering, terminal secondary
denial, exact upload allowance after restart, read-scope denial, exact installed
bytes, no grants, and consumed-upload replay. Upload archive contains only an
inert test fixture, not a published reusable skill. No production policy change.
This tests the skill upload path; **plugin-specific coverage remains separate**.
No acceptance criterion is waived or checked off.

Attempt: `CLAWOS_VM_DRIVER=libvirt
CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state
scripts/vm/test.sh phase-3 installed install-hook`, restart-resilient service
`clawos-p3-install-hook`. `vm-artifacts/20260909-021053-phase-3/` contains selected
mode/snapshot and separately captured host diagnostics. Service exit1 in
`snapshot-revert`, before source sync or guest execution. The normal harness
`exit-code`/collection was never reached; this is a **known bootstrap failure,
not a failed hook assertion and not an unknown live result**.

Read-only host journal gives exact cause: libvirt child `qemu-img snapshot -a
installed .../tester.qcow2` failed initializing `io_uring` with `Cannot allocate
memory`. Independent read-only `qemu-img snapshot -l` and even `qemu-img --help`
fail identically. VM is shut off; libvirt lists original base/installed snapshots
with unchanged dates. Host has ~7.1GiB available RAM, 8MiB memlock limits; the
specific exhausted io_uring resource is **not established**. Do not guess a host
limit change, kill sibling workloads, bypass VM acceptance, or claim corruption.
Per repository VM-failure stop rule, no restore retry or host configuration change.

Host checks: 36/36 conformance runner regressions, 2/2 VM-bootstrap tests,
conformance typecheck, standalone primary fixture build, shell/JS syntax,
catalog, secrecy and diff checks pass. First Python unittest module invocation
and first Vitest config path were invalid; corrected repository test commands
passed. These invocation failures are not VM/runtime evidence. The 15 new live
assertions have **not run**. Runtime kernel/shared code unchanged; older full-phase
and conformance drafts remain separately unstaged. No running script edited.

Next: resolve the host qemu-img/io_uring initialization failure, rerun the exact
fresh-snapshot command, inspect actual event ordering/verdict before accepting.
Then plugin-specific hook coverage, channel URL ordering, observer/egress/approval
integration and full Phase 3/macOS gates. Phase3 remains incomplete and untagged;
no push/merge, snapshot replacement, real granted-file writes or production changes.
