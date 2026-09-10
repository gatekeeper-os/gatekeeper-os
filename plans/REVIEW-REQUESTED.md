# Phase 3 filesystem gatekeeper — STOP 2 review

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

Source definitions: `packages/gatekeeper-github/src/tools.ts` and `resources.ts`.
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

## GitHub gatekeeper — concrete STOP 2 implementation boundary (2026-09-09)

**Approved under the already-recorded 2026-09-09 instruction to finish the beta.**
No additional approval is requested and no tests are waived. STOP 1's tool/URL
surface above is unchanged. This preserves the second review artifact rather
than silently treating auth implementation as Phase 4 acceptance.

The concrete responsibilities 1–3 boundary is now:

- `vendor.ts`: kernel-owned two-stage nonce binding, supported GitHub OAuth App
  web flow with S256 PKCE, fixed callback/origin, numeric user-ID revalidation,
  encrypted `TokenStore`, optional expiring-token refresh, and revocation races.
- `account.ts`/`urls.ts`: strict canonical GitHub.com introductions, account
  resource-type scope, fresh repository/item access and stable numeric/node
  identities, constructor-bound repo/issue/pull objects, account revocation.
- Strict schemas for the eleven already-reviewed tools; the kernel registers
  them, not this plugin. No arbitrary API, identifier, credential, or host input.
- Explicit config mapping: public client ID, env/default client-secret SecretRef,
  trusted `publicOrigin`; no plaintext credential or borrowed personal gh login.

The existing completion authorization also covers responsibilities 4–7:
per-session kernel authorization, durable deferred actions and overlays,
bounded selected caching, node-ID-bound remote writes/reverts, and account-owned
ACL verifiers. Those are implemented together in this worktree and still require
parent review and the original live acceptance. Real reads/effects are not
claimed from mock results. No commits, VM run, provider login, or real GitHub
mutation were performed by the implementation lane.

Implementation and supported-provider references:
[`packages/gatekeeper-github/README.md`](../packages/gatekeeper-github/README.md).
