# Draft upstream report: native approval denial logs tool arguments

**Draft only; not sent upstream.** Observed with unmodified OpenClaw2026.9.2 in
an isolated Ubuntu VM. No real GitHub credentials or effects were used.

## Reproduction

1. Register a plugin tool accepting a synthetic `body` string and a
   `before_tool_call` hook returning `requireApproval` for that tool.
2. Connect a paired operator client advertising `caps:["plugin-approvals"]`.
3. Have an actual agent turn request the tool with a unique synthetic body.
4. Resolve the native `plugin.approval.requested` ID via
   `plugin.approval.resolve({id, decision:"deny"})`.
5. Inspect both Gateway console output and the configured JSONL file log.

**Expected:** the tool never executes; a payload-free denial is returned and
failure metadata is recorded without raw arguments.

**Actual:** the tool correctly does not execute, but the thrown-error log includes
`raw_params` containing the body. This is arbitrary request data, not necessarily
a token-shaped secret. The same family of exposure occurs when there is no
native approval delivery route.

## Source trace on the published pin

- `pluginApprovalDeniedOutcome` returns `kind:"failure"` and
  `disposition:"blocked"`.
- The tool wrapper throws `BeforeToolCallFailureError` for that outcome before
  invoking the plugin tool's execute function.
- The adapter only recognizes `BeforeToolCallBlockedError` in its safe-veto
  predicate, and otherwise builds the raw/effective argument preview.
- Default token redaction does not remove arbitrary body strings.

These functions were inspected read-only in the published package; none is
imported or patched by the OS plugins.

## Local evidence

`vm-artifacts/20260911-184426-phase-4/scenarios.json`:92/93 checks passed,
10 model turns, final exit1. Native denial prevents the mutation/overlay; the
post-shutdown body scan fails in both console and JSONL file sinks. Only
structural reports were collected; raw logs were inspected only inside the disposable guest and are discarded by
the next snapshot reset.

Kernel-owned execution failures are separately mitigated by returning
`details.status:"error"` plus a generic message, instead of throwing. Actual
approved provider failure remained nonretryable, preserved failure auditing,
and did not expose its synthetic request/response canaries. That mitigation
cannot intercept a host failure before execute.

Expanded fresh run `20260911-184853-phase-4`:94/96 checks, exit1. Separate
`provider-failure-log-secrecy` and credential scans pass;
`native-denial-log-secrecy` and the aggregate body scan fail. This is retained
negative release evidence, not a green integration run.

Read-only comparison with the installed2026.9.4-csa.2-mcpfix.2 package finds the
same raw-preview/denial failure branch. That is source evidence only, not a
9.4 runtime test or an assertion about every upstream distribution.

## Requested upstream behavior and regression coverage

Do not log arbitrary tool arguments on denial, missing route, timeout, malformed
approval response, or other pre-execution failure. Retain outcome, tool name,
correlation identifiers and timing. Preserve denial/timeout distinctions and
never execute a denied action. Cover console, file/rotated logs and enabled
diagnostic exports using body canaries, while leaving legitimate model results
and operator previews usable.

The OS release remains blocked until a supported upstream remedy is verified;
no blanket log suppression or approval bypass is proposed.

## Additional isolated missing-route evidence (2026-09-11)

Fresh `20260911-222555-phase-4` on the same unmodified2026.9.2 pin: **100/103
checks,11 actual model turns, exit1**. Disconnecting the only `plugin-approvals`
client and reconnecting without the capability produces the specific upstream
approval-unavailable result. The tool has no provider effect, read overlay or
pending action. After reconnecting a reviewer, native approved-provider-failure
checks still pass. The post-shutdown log scan independently fails missing-route
body secrecy and native-denial body secrecy; credential and provider-error body
scans pass. Aggregate body secrecy is the third failed check. This closes the
previous *coverage gap*, not the security blocker. Report remains unsent.

The first attempt (`20260911-222333`) ran missing-route after the deliberate
uncertain provider effect. Resource reconciliation correctly prevented further
reads/writes; that run is not accepted as missing-route evidence. The corrected
run orders the case before provider failure and checks the specific unavailable
result, rather than treating any generic denial as approval-routing evidence.
