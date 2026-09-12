# GitHub gatekeeper

`@clawos/gatekeeper-github` is the reference capability driver for OpenClaw OS.
It introduces GitHub.com repositories, individual issues, and individual pull
requests through operator-approved grants. Connecting an account does **not**
give an agent ambient GitHub access. The kernel alone resolves grants and
registers tools. Beta sessions remain owner-only.

**Status:** implemented with offline tests; real-provider login, disposable-repo
mutations, live VM conformance, and Phase 4 acceptance are still outstanding.
This package is not a claim that beta is released or that GitHub has been tested
with production credentials.

## Reviewed surface

| Resource URL | Observations | Deferred actions |
| --- | --- | --- |
| `https://github.com/:owner/:repo` | Metadata, bounded issues/pulls, one text file | Create issue |
| `https://github.com/:owner/:repo/issues/:number` | Issue and bounded comments | Add comment |
| `https://github.com/:owner/:repo/pull/:number` | PR, conversation/review comments, reviews, bounded diff | Add conversation comment; submit COMMENT/APPROVE/REQUEST_CHANGES review |

Every tool requires a grant. Tools cannot supply repository identifiers,
credentials, alternate endpoints, arbitrary API calls, merge/push operations, or
administration operations. URLs reject userinfo, ports, queries, fragments,
encoded separators/traversal, alternate hosts, and widened resource paths.
Inputs reject unknown fields. Responses select finite fields and indicate
truncation; oversized files/diffs/HTTP bodies fail explicitly.

## Connection and configuration

The implemented adapter uses GitHub's supported **OAuth App web flow with S256
PKCE** through the existing kernel OAuth nonce router. It does not implement a
device-code polling flow, PAT import, GitHub App installation tokens, or GitHub
Enterprise Server. OAuth `repo` scope is coarse at the provider, but OS grants
remain scoped to the explicitly introduced resource. Only enable this against a
disposable account/app and repository until acceptance is complete.

Inputs in [`deploy-inputs.json`](deploy-inputs.json) map to plugin config:

| Deployment input | Plugin configuration | Credential handling |
| --- | --- | --- |
| `GITHUB_OAUTH_CLIENT_ID` | `clientId` | Public identifier; not a catalog secret |
| `GITHUB_OAUTH_CLIENT_SECRET` | `clientSecret` | Env/default SecretRef below |
| `PUBLIC_BASE_URL` | `publicOrigin` | Trusted exact Gateway origin |

Example configuration fragment (no secret values):

```json
{
  "plugins": {
    "entries": {
      "gatekeeper-github": {
        "enabled": true,
        "config": {
          "clientId": "YOUR_PUBLIC_OAUTH_APP_ID",
          "clientSecret": {
            "source": "env",
            "provider": "default",
            "id": "GITHUB_OAUTH_CLIENT_SECRET"
          },
          "publicOrigin": "http://127.0.0.1:19100"
        }
      }
    }
  }
}
```

Provision the secret with host-owned masked entry or a private service
environment file. Never paste it into chat or shell commands. This adapter
supports only the explicit `env`/`default` SecretRef subset; unresolved `file` or
`exec` references and plaintext secret config are rejected. The kernel catalog
must also contain the enabled package root; plugin installation alone is not
activation. The package metadata describes setup inputs, not a finished
`clawos gatekeeper add` wizard.

Set the OAuth App callback to exactly:
`<publicOrigin>/os/gatekeeper/github/oauth/callback`. HTTPS is required except
HTTP on loopback. The origin must be browser-reachable; a remote host's loopback
is not the browser's loopback. Run `clawos gatekeeper connect github` and open the
single-use start URL privately. The kernel binds both nonce stages to the
operator and selected resources; the vendor preserves state, PKCE, callback,
ten-minute expiry, and the stable GitHub user ID. Restarting discards unfinished
authorizations. Reconnecting as a different GitHub user is rejected; explicitly
revoke the old account first when changing identity.

Access/refresh tokens are encrypted with the cell key using kit `TokenStore`.
Optional expiring OAuth App tokens use coalesced refresh, revalidate `/user`'s
numeric ID, and cannot resurrect a concurrently revoked account. An expired
refresh token requires reconnection. Revocation invalidates retained account,
resource, session and verifier objects. The driver never logs credentials or raw provider errors, and kernel-owned
execution failures return a payload-free structured error. Upstream native
approval denials and route failures can still log tool arguments before execution; complete
log secrecy remains an explicit release blocker.

## Optional native synchronous decisions

`config.synchronousActions` is an operator-configured array containing a subset
of the four existing action tool names. It defaults to `[]`, preserving deferred
simulation for every action. Example:

```json
{ "synchronousActions": ["gk_github_issue_comment"] }
```

Selected actions return `awaitDecision:true` on the instance-bound dry pass,
disable auto-approval eligibility and use the kernel's native plugin approval
flow. The agent cannot choose this policy in tool parameters. Without an exact
allow-once decision, no provider write or simulated overlay occurs. Allowed
actions apply once, invalidate reads and retain their existing revert contract.
Unknown/duplicate tool names are rejected. An operator restart is required for
a changed configuration; already-pending actions retain their recorded semantics.
This option does not grant resource access or implement provider authentication.

## Approval, simulation and remote effects

All reads await kernel observation authorization before fetching. Each bound
resource uses durable per-account/per-identity journals and selected read
snapshots below `os/gatekeepers/github/`; cached data never bypasses a fresh
access check. Pending effects merge into subsequent reads and survive restart.
Rejection removes the overlay. Selected read snapshots use at most 32 memory/disk slots per resource and a 30-second TTL, with fresh access/identity checks
even on a cache hit. Apply/revert invalidate them; pending effects are re-applied
on every read. Failed access checks never fall back to cached data. Restart
requires a fresh authoritative read, not trust in a saved snapshot.

Writes occur only through the kernel's action decision. GraphQL mutations bind
**stable provider node IDs**, not reusable repository names or issue numbers:
`createIssue`, `addComment`, `addPullRequestReview`. Label names are resolved
against the bound repository node. Repository and item identity are rechecked
before effects; renaming/reusing a URL cannot redirect the mutation to a new
repository. REST observations recheck resource identity before **and after**
fetching; multi-endpoint reads are not a transactional GitHub snapshot.

- Created issues revert by `closeIssue`; history is not erased.
- Created conversation comments revert by `deleteIssueComment` using the exact
  recorded comment node ID.
- Submitted reviews explicitly do **not** promise a generic revert.
- Only mention-free comments are eligible for a separately configured
  auto-approval policy; there is no default auto-approval.
- A failed/interrupted remote effect is uncertain and is never blindly retried.
  `clientMutationId` is not treated as an exactly-once idempotency key.

The observer verifier uses the observer's own credential and exact resource
access, not the owner's credential. Ordinary 403/404 mean denied; identified
rate-limit, transport, and server failures throw sanitized errors. Verifier
metadata does not enable shared grants in beta.

## Evidence and remaining acceptance

Run host checks:

```sh
pnpm --filter @clawos/gatekeeper-github... build
pnpm --filter @clawos/gatekeeper-github typecheck
pnpm --filter @clawos/gatekeeper-github test
pnpm check:catalog
pnpm check:secrets
```

Offline fixtures cover URL/authority boundaries, all seven observations and four
action kinds, rejection, apply-once/revert-once, persistent pending effects,
uncertain writes, PKCE/state/account binding, encrypted storage, refresh races,
and observer negatives. Fixtures do not authenticate with GitHub.

Phase 4 still requires the original live VM `deferred-approval` and
`require-approval-roundtrip` checks, real login and apply/reject/revert on a named
disposable repository, and separate provider-failure/approval-route-failure audit/log secrecy evidence.
See [real-provider acceptance prerequisites](../../docs/phase-4-real-provider.md). Do not reuse an agent's
personal `gh` login or production messaging credentials as acceptance fixtures.

## Provider contracts checked

Read directly on 2026-09-09:

- [GitHub: Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps):
  web authorization parameters `state`, `code_challenge`, `code_challenge_method`
  (`S256` only); exchange `client_secret`/`code_verifier`; `/user` revalidation;
  optional expiring tokens and refresh-token rotation.
- [GitHub public GraphQL schema](https://docs.github.com/public/fpt/schema.docs.graphql):
  `CreateIssueInput.repositoryId`, `AddCommentInput.subjectId`,
  `AddPullRequestReviewInput.pullRequestId`, `CloseIssueInput.issueId`, and
  `DeleteIssueCommentInput.id` are supported stable-ID mutation inputs.
- [GitHub GraphQL mutation reference](https://docs.github.com/en/graphql/reference/mutations).

These sources verify supported API shapes, not this driver's live acceptance.
