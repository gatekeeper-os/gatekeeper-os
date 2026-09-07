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
