# Phase 4 real-provider acceptance prerequisites

**Not accepted.** `gateway-integration` uses synthetic GitHub and cannot pass
the full gate. `test/phase-4.sh` deliberately exits2; a live-provider runner and
protected OAuth setup still need implementation and verification.

## Required test setup

- Disposable GitHub login, repository and existing issue URL. Keep the account
  isolated from production repositories: OAuth App `repo` scope is broad even
  though OS grants remain resource-scoped.
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
  arguments, source, reports or snapshots. Do not reuse the developer's `gh`
  authentication as the disposable test identity.

No secrets are needed to provide the login/repository/app names and public
client ID. The single-use `clawos gatekeeper connect github` URL belongs only
in the operator's private login flow.

## Evidence required from the live runner

Run acceptance through `scripts/vm/test.sh phase-4 installed full`, after the
full runner is implemented. It must use the production driver entry/native
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

On the pinned release, ordinary native user denial logs the rejected body in console and file
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
