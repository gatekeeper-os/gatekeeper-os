# Phase 3 filesystem gatekeeper — STOP 2 review

> Historical record, superseded for launch status. Its preparation commands and
> authorization holds are not current instructions and must not be replayed.
> Five packages are published at beta.5, all three repos are public, and npm-only
> run `20260916-220009-phase-3` passed. Remaining limits and the completed release
> gates are in [current release status](../README.md#release-status). Original
> failed receipts remain failed. Native approval policy follows the
> [closed advisory disposition](upstream-native-approval-logging.md), not a pending upstream change.


Status: **STOP 2 approved by the operator’s “Approved continue” reply on 2026-09-07. Implementation in progress.**
Branch: `phase/3-kernel`. Phases 0–2 remain complete; Phase 3 is not complete or tagged.

## Approval already recorded

The operator’s “continuew” reply on 2026-09-07 followed the concrete STOP 1 request
at `7642efb`. It approves [the preserved filesystem contract](fs-contract.md), without
waiving this separate gate or granting access to production directories.

## Historical STOP 2 boundary (at `fc8b33f`)

- No-credential vendor with explicit, copied root configuration and per-operator accounts.
  Account lookup alone provisions nothing; malformed roots fail closed.
- Original local-file URL parsing before normalization, component-aware containment,
  symlink-component refusal, and directory device/inode identity checks.
- Constructor-bound directory resources. Replaced paths cannot silently rebind retained
  resources. Revoking an account invalidates its retained resources without affecting another operator.
- Existing plugin lifecycle registration and catalog metadata retained; deployment inputs
  contain no credentials. No tools are registered by the gatekeeper.
- **All sessions, file operations, action application and observer verification remain
  disabled.** No unapproved data-plane behavior is reachable. No production/config changes.

Directory identity checks are introduction-time validation, **not race-safe I/O**. This
checkpoint does not claim confinement against concurrent replacement while reading/writing.

## Approved decision

Proceed to the skill’s authoring Phase 2 (responsibilities 4–7): integrate kernel-owned
read/action authorization; implement race-confined bounded list/read/write operations;
add persistent pending overlays and explicit operator application; reject external edits
at apply; enforce owner-only audiences; and run the required live VM conformance.

The approved three-tool surface and URL policy remain unchanged. No automatic writes,
revert support, sharing, or production installation is proposed. If confinement cannot
be established with supported primitives, unsafe operations must stay disabled.

Ordered kernel runtime implementation remains outstanding and must precede enabling
this driver. The focused VM boundary run is not a substitute for Phase 3 acceptance.

## Verification

See the current checkpoint in [PROGRESS.md](PROGRESS.md). Host typechecking and 45 boundary tests pass. Focused VM run
`vm-artifacts/20260908-031021-phase-3/` restored `installed` and exited **0** on
`6ac764f`: **45/45 tests**, build/typecheck/catalog/secret checks passed. Scope is
`fs-boundary`, with `fullPhaseAcceptance:false` and `fileOperationsEnabled:false`.

## Why this is a separate stop

[write-gatekeeper/SKILL.md](../.agents/skills/write-gatekeeper/SKILL.md) says:
“There are two mandatory STOP points below — do not proceed past either without
operator approval.” Step 6 is “STOP 2 — ask the operator whether to proceed to Phase 2.”
STOP 1 approved the API; STOP 2 covers the later approval/simulation/observer work.


## Current implementation checkpoint

Both reviews are satisfied; no additional operator approval is pending here. Focused
VM run `20260908-035125-phase-3` passed 73/73 filesystem tests, exit 0. Confined Linux
reads, per-call queue authorization, private state/cache, and persistent simulation are
implemented. All real granted-file writes remain denied under the approved atomicity
requirement; pending effects can be inspected and rejected. This supersedes the historical
“all sessions disabled” state above. Kernel integration and live Phase 3 acceptance remain
unfinished; this driver is not installed in production.

## GitHub gatekeeper — concrete STOP 1 review

Prepared for the next phase while Phase 3 acceptance continues. **Authorized on
2026-09-09 by the operator: “you have my authorization to finish what needs to
be done to get beta”.** This follows presentation of the concrete surface below.
Implementation and its acceptance remain outstanding; this is not test evidence.

## Proposed surface

Every tool requires an opaque `grant` string. Account credentials and resource
identifiers are bound by the account, never supplied as tool arguments. The
kernel resolves each grant for the current agent, cell, session and audience.

| Resource | Tool | Inputs besides grant | Effect |
|---|---|---|---|
| Repository | `gk_github_repo_get` | none | Read name, description, default branch, visibility |
| Repository | `gk_github_repo_list_issues` | optional state, labels, limit 1–100 | Read bounded issue summaries; exclude pull requests |
| Repository | `gk_github_repo_list_pulls` | optional state, limit 1–100 | Read bounded pull-request summaries |
| Repository | `gk_github_repo_read_file` | path, optional ref | Read one bounded file, default branch when ref omitted |
| Repository | `gk_github_issue_create` | title, optional body and labels | Create one issue |
| Issue | `gk_github_issue_get` | none | Read issue and bounded comments |
| Issue | `gk_github_issue_comment` | body | Add one issue comment |
| Pull request | `gk_github_pull_get` | none | Read pull request and bounded review comments |
| Pull request | `gk_github_pull_diff` | none | Read a bounded unified diff |
| Pull request | `gk_github_pull_comment` | body | Add one conversation comment |
| Pull request | `gk_github_pull_review` | event: COMMENT, APPROVE or REQUEST_CHANGES; body | Submit one review |

Source definitions: `packages/gkos-gatekeeper-github/src/tools.ts` and `resources.ts`.
The implementation will reject unknown fields and enforce finite text/response
limits with explicit truncation indicators. No arbitrary API method, URL, token,
repository override, shell execution, merge, push, branch deletion or repository
administration tool is included.

## URL and authority contract

Only canonical HTTPS GitHub.com resource paths:

- `https://github.com/:owner/:repo`
- `https://github.com/:owner/:repo/issues/:number`
- `https://github.com/:owner/:repo/pull/:number`

Require positive integer issue/PR numbers. Reject userinfo, non-default ports,
query strings, fragments, extra path segments, encoded separators/traversal and
alternate hosts. A trailing slash may normalize to the same resource; do not
silently widen an issue/PR grant to its repository or follow cross-host redirects.
Validate both repository access and requested resource type with the operator's
own connected account before creating a grant. Non-operators cannot introduce
resources. Revocation closes retained sessions.

Beta grants remain owner-only as specified in implementation-plan §4.7. The
per-account ACL verifier must distinguish 403/404 (no access) from transport,
rate-limit and server failures (sanitized errors); implementing it does not enable
sharing or imply that all accounts can see identical restricted repository data.

## Writes and reversibility

These four write kinds enter the existing deferred action pipeline and only
reach GitHub after an operator decision (or separately configured eligible
policy). Pending effects appear in subsequent reads; rejection removes them.

- Issue creation: revert closes the created issue; it does not erase history.
- Issue/PR conversation comment: revert deletes only the comment created by that action.
- PR review: no generic revert promised; `implementsRevert` is false.

No default auto-approval. Previews identify the exact target and proposed change.
Retries after uncertain network outcomes must not blindly duplicate external
writes. Credentials, request/response bodies and raw vendor errors stay out of
logs and audit records.

## Authentication and evidence prerequisites

Use GitHub's supported device flow when enabled for the selected OAuth app;
otherwise its supported web flow. Preserve nonce/account binding and expiry.
Short-lived user-facing login codes go only to a verified private conversation.
Long-lived credentials use masked entry/protected storage, never chat or shell
literals. No personal production credential is silently repurposed as a fixture.

Acceptance needs a disposable test repository, test identity/app configuration,
and distinct operator/non-operator messaging identities. The parent has already
asked for names/links; no token has been requested in chat. Real action apply,
reject, revert and secret-leak checks must pass before Phase 4 is accepted.

## Review boundary

`.agents/skills/write-gatekeeper/SKILL.md` explicitly says:
“STOP 1 — present the tool surface and URL patterns for operator review.”
It also says “do not proceed past either without operator approval.”
This artifact is the concrete first review, not a request to waive both gates.
The subsequent 2026-09-09 explicit completion authorization covers this already
presented surface and the remaining beta implementation. Preserve both review
artifacts and the documented scope; do not request repetitive approval for the
same work. This authorization does not waive tests or capability invariants.

## MCP gatekeeper — historical STOP1 (approved 2026-09-12)

Historical context at STOP1: Matt requested MCP after Phase7→5→6. Those
implementation checkpoints were saved separately. The request below was approved
on 2026-09-12; STOP2 was also approved later that day; see the end of this file.

Review [mcp-surface-contract.md](mcp-surface-contract.md): HTTPS Streamable HTTP
only; fixed named tools from operator-reviewed manifests; owner-only server grant
`https://mcp.gatekeeper-os.invalid/servers/:server`; no generic invocation, stdio,
automatic discovery or cross-server widening. Exact synthetic read/append schemas
are in `packages/gkos-gatekeeper-mcp/src/tools.ts`; canonical resource metadata is in
`resources.ts`. These files are not exported by the inert plugin entrypoint.

**Decision:** approve this surface/URL/transport scope to proceed to account and
transport implementation, or specify changes. STOP2 remains separate before later
action/simulation/observer work. No current runtime or remote server is enabled.

The skill explicitly requires operator review at STOP1; per its unattended rule,
this run stops MCP implementation here and reports the completed overnight work.

## MCP gatekeeper — STOP2 approved (2026-09-12)

Matt explicitly approved responsibilities4–7 under
[mcp-surface-contract.md](mcp-surface-contract.md). Both reviews are satisfied;
no repeat approval is pending. The runtime publishes only private read-note.
Generic append keeps `awaitDecision:true`, `autoApprovable:false`,
`implementsRevert:false` and remains unregistered/hard-gated by upstream native
logging. Deferred action evidence uses only the separate deterministic synthetic
notes fixture. See [PROGRESS.md](PROGRESS.md) for actual host and disposable-VM
receipts; no full native/provider/beta acceptance, merge or publication.
