# Original-plan fidelity audit — pre-closure checkpoint

> Historical record, superseded for launch status. Its preparation commands and
> authorization holds are not current instructions and must not be replayed.
> Five packages are published at beta.5, all three repos are public, and npm-only
> run `20260916-220009-phase-3` passed. Remaining limits and the completed release
> gates are in [current release status](../README.md#release-status). Original
> failed receipts remain failed. Native approval policy follows the
> [closed advisory disposition](upstream-native-approval-logging.md), not a pending upstream change.


**Current reconciliation:** the final `20260909-231728-phase-3` candidate closes
the Phase 3 implementation gaps and passes every automated gate, retaining only
Matt’s explicit Telegram validation deferral. See [Phase 3 acceptance](phase-3-acceptance.md).
The historical findings below describe `cf31e0c` before this closure; their
"incomplete" and "remaining" labels are not the current milestone status.

Basis: supplied `docs/implementation-plan.md` in the parent agent kit, the tracked
living plan (§4.7, §5, §9), phase checklist, source code and actual saved artifacts.
Matt asked to continue and follow the original plan as closely as possible.
This is an evidence reconciliation, not a reduced beta scope or acceptance waiver.

## Preserved order and scope

| Original phase | Observed state | Gate |
|---|---|---|
| 0: bootstrap/spikes | `phase-0` checkpoint; public SDK corrections recorded | Complete per existing VM/CI evidence |
| 1: host installer | Linux + macOS 25/25 recorded, `phase-1`; later Linux installer regression 25/25 | Prior acceptance retained; not a fresh macOS kernel run |
| 2: contracts/kit | `phase-2`, library acceptance + CI | Complete per existing evidence |
| 3: kernel/fs | Active branch; actual SDK ingress, policy/CLI/fs and install-skill checkpoints | **Incomplete**; details below |
| 4: GitHub driver | Reviewed 11-tool surface, explicit completion authorization recorded | Implementation, concrete second review artifact and real-service evidence outstanding |
| 5: approvals UX | Partial kernel/CLI plumbing only | Auto-approval, chat UX and digest acceptance outstanding |
| 6: blueprints | Supplied templates are not accepted agents | Apply/diff/lint/idempotence + real sandbox execution outstanding |
| 7: update/rollback | Compatibility workflow scaffold is not an upgrade result | Nine-step update, failure injection, rollback and nightly verdicts outstanding |

Phases 8–9 in the original document are later driver expansion and release
hardening. MIT packaging preparation does not substitute for beta phases 3–7 or
claim the later publication/hardening work done. No phase-3 tag or merge is warranted.

## Phase 3 discrepancies and required closure

- **Owner-first shared audience:** source only added observers after a nonowner
  spoke. An owner in a group could therefore receive existing private capabilities.
  Fixed using finalized transport audience before prompt construction; persistent
  lockdown reuses the existing observer enforcement. New tests cover first group
  introduction, existing grants, stale preflight and owner return. Fresh combined
  VM `20260909-214819-phase-3` passed: 51/51 ingress checks, nine actual turns;
  47/47 named-suite conformance checks plus 17/17 skill-hook checks. All five
  underlying checkpoint directories were collected and directly inspected.
  Host typecheck/build, 362/362 tests, catalog/secrets and 10/10 packed-license
  checks also passed. These results do not close the gaps below.
- **Plugin vs skill install:** `test/phase-3-install-hook.sh` builds `SKILL.md` and
  calls `skills.install`. Its 17 checks remain valid skill-hook evidence, but the
  plugin-specific checkbox was checked without corresponding evidence. Reopened.
  New exact-version plugin diagnostic `20260909-215951` confirms the official
  path skips the secondary hook as documented; it is not an upstream defect.
  A compatible nonofficial fixture is still required; see `plugin-install-hook-gap.md`.
- **Combined evidence retention:** `20260909-201704-phase-3` has a real successful
  aggregator result (47 named-suite checks + 17 skill-hook checks + 33 ingress
  checks), but only totals/scope/log were collected. Collector now retains every
  focused structural evidence directory. It still excludes live cell state and
  raw model/Gateway data. Historical totals are not fabricated, but cannot replace
  missing per-check source artifacts. No retroactive evidence reconstruction.
- **Unimplemented kernel surfaces:** `oauthRouter` returns 404,
  `os.gatekeepers.connect` always throws, `startDrainer`/`stopDrainer`,
  `onBeforeAgentReply` and `onAgentEnd` are empty in `kernel.ts`. They are explicitly
  named in the original Phase 3 deliverables/ordered steps; later phases deepen
  them but do not make placeholders accepted implementations.
- **Approval integration:** list/decision RPCs exist, but no real GitHub apply,
  reject/revert or upstream require-approval roundtrip has passed. The decision
  code currently requires pending status even for revert; do not advertise
  applied-action reversion until repaired and verified.
- **Shared-grant surface:** `IntroduceParams` still accepts `audience: "shared"`
  even though §4.7 reserves sharing for v1.1. The new audience regression proves
  owner-only enforcement, not safe shared grants; this surface needs reconciliation
  before beta acceptance.
- **Egress/observer coverage:** unit coverage is not live delivery evidence.
  Known-group enforcement is strengthened here; generalized observer identity,
  replay/taint and real outbound cancellation still need explicit acceptance.
- **Filesystem writes:** intentionally fail closed under the recorded atomicity
  constraint. Pending simulation is not successful real file write support.
- **macOS:** prior Phase 1 installer acceptance is real; no Phase 3 runtime/macOS
  portability claim follows. Driver data operations deliberately deny unsupported
  platforms; retain this limitation wherever beta platform support is described.

## Approved deviations vs added work

- Telegram validation: **explicitly deferred by Matt, not passed**. Preserve the
  original manual scenario and resume it only when requested; no Telegram setup
  is needed for this checkpoint. See `telegram-validation-deferred.md`.
- Early URL introduction: moved from `before_agent_run` to public SDK
  `reply_dispatch` because pinned upstream builds the prompt first. This is a
  documented upstream-order correction, preserving dual channel owner/operator
  authorization and adding the distinct authenticated Control UI path.
- Config reconciliation: earlier verified upstream flag/API corrections and
  source-bundled plugin installation remain documented; no upstream patch/fork.
- Slack canary: added deployment evidence, not in the original plan. Its untracked
  draft targets the production ALINA app, waits for only one owner message and has
  no nonowner assertion; it also is not wired into the standard VM harness. Left
  untouched and not accepted. Do not repurpose a production listener/credential
  to make a disposable test pass. Test app/workspace requested (names only).

## Remaining external inputs

Disposable Slack app/workspace with owner/nonowner identities and a disposable
GitHub test repository/app/account are not established. Names/links were requested;
credentials must use the host-supported protected flow, never chat or shell literals.
No Telegram input is pending because its validation is explicitly deferred.

This report keeps the full planned beta open and distinguishes passing conformance
slices from completed deliverables. Continue Phase 3 closure before Phase 4.
