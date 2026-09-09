# GitHub gatekeeper — concrete STOP 1 review

Prepared for the next phase while Phase 3 acceptance continues. **Not approved;
no Phase 4 driver implementation or GitHub action has been performed.**

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
The existing broad beta execution authorization does not document approval of
this newly presented resource/write surface. STOP 2 follows the account/grant
implementation and remains separate.
