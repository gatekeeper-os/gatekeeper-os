# Phase 3 acceptance and original-plan reconciliation

Status: **all Phase 3 automated gates accepted**, with Telegram execution alone
explicitly deferred by Matt. Merge/tag follow green CI for this candidate; no
transport result or later-phase beta completion is fabricated.

## Delivered against §9

| Required Phase 3 surface | Implementation and evidence |
|---|---|
| Store, registry, capability resolution | OS-owned SQLite, checked live vendor registry, originating action bindings, `Kernel.resolveGrant`, per-use authority checks |
| Policy pipeline and filesystem driver | Real model/tool calls, owner-first grants, unknown/revoked denial, disabled-hook trusted policy, bounded Linux filesystem reads and path escape denial |
| Approval queue and decisions | Pending simulation, ordered per-instance decisions, applied-only revert, durable uncertain outcomes, final post-resolution authority check; focused race/ordering/revert tests |
| Drainer | Shared-runtime single-flight; 30-second timer and agent-end trigger; both configured tag and per-action eligibility required; stops at ineligible/uncertain work; shutdown awaits effects |
| Agent access requests | Pending requests retain agent/session/resource; only authenticated operator decisions grant access; approvals list returns bounded actions and requests |
| OAuth and account-connect routing | Paired-operator RPC, private two-stage single-use kit nonces, fixed vendor routes, expiry/replay/cross-vendor/runtime checks, sanitized errors; static filesystem route tested through actual Gateway HTTP |
| RPC and CLI | Paired device-token identity; grant/list/revoke/audit/approvals/connect; no caller-supplied identity; installed upstream-mounted CLI |
| Operator chat | Private operator commands are claimed before the model; outsider, group and forged-scope cases cannot act or see approval data |
| Egress and audience | Actual Gateway `send` passes safe content to a synthetic transport and cancels denied content with an audit record; owner-only beta grants deny all shared minting/use |
| Install protection | Primary policy plus actual community `plugins.install` secondary-hook denial; exact staged plugin identity; skill-hook tests retained separately |

## Deliberate corrections, not scope reductions

- Command handling moved to authenticated `reply_dispatch`, because the pinned
  `before_agent_reply` context does not carry trusted owner/audience facts. The
  late hook denies command fallthrough. The intended no-model command behavior
  is preserved and tested with actual public-SDK dispatch.
- The secondary plugin fixture is community `mainctrl@1.1.0`, not a skill or an
  official package that skips the hook. Source-confirmation trust is distinct
  from the official-source exemption. No private imports or upstream changes.
- Resource decisions cannot use an unbound instance lookup. They retain and
  recheck the originating grant/session, including revocation during resolution.
  Old unbound or uncertain actions require reconciliation, not automatic retries.
- Shared grants are unavailable in beta even if a persisted row says active.
  Full observer ACL/dataset strategies remain the original v1.1 work.

## Evidence

Final candidate: `vm-artifacts/20260909-231728-phase-3/`, fresh installed snapshot,
run identity `2026-09-09T23:17:39Z`, harness and combined exits **0**:

- **78/78** conformance checks across the nine original suites plus separate skill
  and real plugin install-hook suites (17 and 14 checks respectively).
- **71/71** channel/OAuth/chat/egress checks; **nine actual model turns**.
- **98/98** kernel-live checks; **14 actual model turns**, including pending access
  request → paired approval → next-turn tools, simulated filesystem write/read,
  CLI rejection → base-content read, and denied real application with unchanged
  host bytes and non-retryable failure audit.
- Guest kernel **93/93** and CLI **117/117** tests. Final host workspace **410/410**;
  full workspace typecheck/build, catalog/secrecy and 10 packed-license checks pass.
- All six checkpoint report directories retained and inspected; no live cell
  state, raw model/Gateway bodies or credentials are collected.

The earlier `20260909-231055-phase-3` combined pass is retained separately; it
predates the final approval-race regression and extra live lifecycle scenarios.
Failed egress fixtures `20260909-230059` (injected callback bypassed outbound hooks)
and `20260909-230333` (Gateway send lacked explicit agent selection) remain failed,
not reclassified. Final cancellation uses actual Gateway `send` with explicit agent
and session selection, a positive delivery control, no blocked delivery, and audit.

Unit tests use explicit driver/SDK doubles where documented; they are not
presented as real provider OAuth or GitHub writes. VM traffic is disposable and
synthetic transport delivery is never presented as real Telegram or Slack.

## Retained boundaries and next phase

- **Telegram: deferred, not passed**, per [the explicit request](telegram-validation-deferred.md).
- Slack is an added deployment canary, not an original Phase 3 requirement; its
  unrelated uncommitted draft and production ALINA credentials are untouched.
- Filesystem real creation/replacement remains disabled under the approved
  atomicity contract. Simulation/rejection is not successful real host writing.
  Unsupported platforms deny filesystem data operations; Phase 1 macOS installer
  evidence is not a fresh macOS kernel-runtime claim.
- Phase 4 still owns the real GitHub adapter/account flow, external apply/reject/
  revert and upstream synchronous-approval roundtrip acceptance.
- Phase 5 still owns the TUI, additional chat aliases and real-channel digest/
  timed auto-approval UX acceptance. The Phase 3 infrastructure is implemented;
  passing generic tests does not close those later-phase live scenarios.
- Beta completion still requires Phases 4–7. No production deployment or public
  package release is implied by the Phase 3 milestone.
