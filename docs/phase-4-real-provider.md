# Phase 4 real-provider acceptance prerequisites

**Not accepted.** `gateway-integration` uses synthetic GitHub and cannot pass
the full gate. `test/phase-4.sh` now implements the live-provider runner, with protected stdin
delivery. It exits2 when OAuth input is missing. Real OAuth/effect checks passed
in run `20260912-035736-phase-4`; full acceptance still fails upstream log secrecy.

## Required test setup

- Dedicated test repository and issue. Matt explicitly authorized his personal
  `gh` login on2026-09-11: account `mmango7474` (56606128), private repository
  `mmango7474/clawos-beta-acceptance` (1366819708), issue1 (5430217206).
  This local exception does not authorize personal credentials in CI. OAuth App
  `repo` scope is broad even though OS grants remain resource-scoped.
- OAuth App public client ID and exact registered callback. The implemented flow
  is OAuth App web authorization with S256 PKCE, **not PAT import**.
- Browser-reachable Gateway origin. For the loopback VM fixture it is
  `http://127.0.0.1:19100`, with callback
  `http://127.0.0.1:19100/os/gatekeeper/github/oauth/callback`.
  The browser must actually reach the VM's loopback through a scoped tunnel;
  host/browser loopback alone does not establish this. Check port allocation
  before opening a tunnel. Do not bind the Gateway publicly to simplify OAuth.
- App secret provisioned privately through masked host-owned entry/private
  service environment delivery and the existing env/default SecretRef. Do not
  put secrets, authorization codes or single-use OAuth URLs in chat, command
  arguments, source, reports or snapshots. The authorized `gh` identity may act as the independent observer; its token
  must never be imported into the driver or counted as web OAuth acceptance.

No secrets are needed to provide the login/repository/app names and public
client ID. The single-use `clawos gatekeeper connect github` URL belongs only
in the operator's private login flow.

## Independent remote observation helper (live component verified)

`packages/clawos-conformance/src/github-observer.ts` is the read-only evidence
component for the full runner. It imports no driver, does not read the
OAuth journal and performs only uncached GETs to fixed `api.github.com` paths.
Each capture binds numeric repository/issue IDs, paginates all comments (bounded
to a disposable issue under 2,000 comments), and rejects count drift, duplicate
pages, malformed data and redirects. Keep this test issue otherwise idle: REST
pagination is not an atomic snapshot, and count stability cannot exclude every
concurrent edit. Unknown/inconsistent observations fail, never prove no effect.

The runner must construct it with the expected owner/repo, repository ID, issue
number/ID and numeric connected GitHub account ID. It compares opaque in-memory
captures for exact unchanged, created-once and recorded-comment-only reverted
deltas, including preservation of pre-existing comments and the expected author.
Only counts/booleans/comment IDs leave the helper; bodies and credentials do not.
Reversed, copied or foreign receipts are rejected. The runner must still bind
its report to the current run and verify actual OAuth identity separately.

Public test repositories need no observer credential. For a private test repo,
prefer a **separate read-only observer credential**. For this explicitly
authorized local test, the host-keyring `gh` token is delivered via protected stdin
and guest tmpfs; the observer itself remains GET-only. Never read the driver's
journal or substitute that credential into its OAuth flow. This is an independent read probe, not PAT import into the gatekeeper.
Production transport is VM/full-or-observer-live-mode-only; injected test transports always
report `realProvider:false`. Unit tests use synthetic HTTP. The separate `observer-live` VM run
`20260912-010743` passed9/9 checks against actual GitHub: exact single-comment
create, independent observation, recorded-comment deletion and baseline restore.
The actor used the authorized gh credential, not the gatekeeper. This proves the
observation component, not OAuth or full Phase4. Host readback confirmed zero
remaining comments.

## Evidence required from the live runner

Run acceptance through `scripts/vm/test.sh phase-4 installed full`, with protected input available. It must use the production driver entry/native
fetch, not the VM fixture or a token seeded into the driver journal.

1. Complete actual OAuth and bind the expected numeric GitHub account identity.
2. Introduce only the selected issue; verify no ambient tools or widened grant.
3. Simulate a unique comment, read the overlay, and independently confirm the
   remote issue is unchanged. Local action state or a cached driver read is not
   independent provider evidence.
4. Apply once, verify the exact remote effect, reject a second pending action
   without a remote effect, and revert only the recorded created comment.
5. Exercise native allow-once/deny, unauthorized reviewer and resolution replay;
   verify remote counts, terminal action status and audit outcomes.
6. Scan actual console, file/rotated logs and OS audit after shutdown, using
   synthetic unique request/response canaries plus credential detection. Collect
   boolean/count verdicts only. Account storage/session history and pending
   previews intentionally contain data; they are not body-free diagnostic logs.

The conformance report is current-run `provider:"github.com"`, `mode:"full"`,
`realProvider:true`, with all required checks literally true. Missing or false
`failed-tool-log-secrecy`, `native-denial-log-secrecy`, or `approval-route-failure-log-secrecy` must fail it.

## Remaining upstream logging blocker

On the pinned release and published2026.9.4, ordinary native user denial logs the rejected body in console and file
logs (fresh VM20260911-184426, **92/93 checks**, exit1). Also, removing every
`plugin-approvals` reviewer and requesting
a synchronous action yields a native no-route failure **before** the kernel's
tool callback. Upstream then logs raw tool arguments. Use only synthetic bodies
when reproducing it. Kernel-owned provider failures are protected separately by
structured error results; that does not repair the upstream denial/route-failure paths.

A [draft upstream report](../plans/upstream-native-approval-logging.md) records
the reproduction; it has not been sent externally.

See [verified source findings](upstream-reference.md#phase-4-tool-error-logging-boundary-2026-09-11).
No private SDK import, upstream patch, weakened approval rule, or blanket log
suppression is an accepted workaround. Until a supported fix is verified, keep
Phase 4 open and do not create the `connected` snapshot, merge/tag the phase, or
advance beta acceptance.

## Protected delivery and current gates

`CLAWOS_TEST_INPUT_STDIN=1 scripts/vm/test.sh phase-4 installed full` accepts
one private JSON envelope on stdin: `input` (public identities/client ID/origin),
`appSecret`, and optional `observerToken`. The launcher bounds input, creates a
mode0600 guest tmpfs file with exclusive/no-follow semantics, consumes/unlinks
it, and passes secrets only in the child environment. Never paste this envelope
into chat or shell history. The existing gh token is obtained directly from the
keyring into this pipe, not written to the repository or command line.

`os.gatekeepers.account({vendor:"github"})` exposes validated account metadata
only for the gateway-authenticated device operator; it cannot select another
operator or create an account. Full acceptance binds its numeric accountId after
actual web OAuth. The app client ID and masked private secret entry were supplied; actual web OAuth
and authenticated numeric identity binding passed in run `20260912-035736-phase-4`.
The authorized account alone cannot create an OAuth App through gh/API.

Missing-input VM `20260912-011344` correctly returned exit2, full acceptancefalse.
Published-latest mode (`phase-4 installed upstream-logging`) installs an exact
resolved release in an isolated guest directory without changing the pin.
Run `20260912-010401` on2026.9.4 passed103/106 checks: native-denial,
missing-route and aggregate body secrecy still fail. No supported remedy is
available/verified; the upstream report remains unsent.


## Live OAuth and GitHub effects verified — 2026-09-11
Issuer-fix full VM run `20260912-035736-phase-4` on unmodified pinned
OpenClaw 2026.9.2 completed real GitHub OAuth/PKCE, bound account56606128
(mmango7474), and rejected callback replay. All deferred simulate/readback,
operator-only apply, duplicate-apply rejection, reject, recorded-comment revert,
grant revocation, native allow/deny/no-route, unauthorized decision and replay
checks passed against actual GitHub. Two test-owned comments were reverted;
independent host GitHub GETs confirm issue1 has zero comments remaining.

Saved report: **94/98 checks**,9 model turns, exit1. The four false checks are
native-denial-log-secrecy, approval-route-failure-log-secrecy and their two
aggregate gates (secret-scan-clean/full-required-evidence-present). Post-shutdown
scan covered5 logs and1 audit: credentials and kernel-owned provider-failure
body checks pass; native denied/no-route bodies still leak in upstream logs.
The deliberate provider failure has real HTTP200 GraphQL-error provenance.
This is live OAuth/effect proof, **not full Phase4 acceptance**; the final two
conformance suites were not reached because the log-secrecy gate failed.
No upstream patch, connected snapshot, merge/tag, later-phase acceptance or beta.
OAuth App setup is no longer the blocker; a supported logging fix remains.
The existing private upstream report is still unsent, pending explicit permission.

Final host verification:594/594 Vitest +4/4 runner checks, catalog/secrets/diff checks pass. VM confirmed shut off; localhost19100 tunnel closed and transient host app-secret file removed. Original base/installed snapshots retained; no connected snapshot.
