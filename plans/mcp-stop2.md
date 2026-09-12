# MCP gatekeeper — STOP2 connection boundary

STOP1 approved by Matt's **“Approved continue”** on 2026-09-12, following the
concrete [surface contract](mcp-surface-contract.md) and draft PR14. That approval
has been applied; no repeated STOP1 approval is requested.

## Implemented boundary

- Public HTTPS **JSON-response Streamable HTTP subset**, public MCP SDK1.30.0.
  No legacy/streaming SSE, stdio/subprocess, automatic OAuth/client registration,
  redirects, sampling, elicitation, resource fetching or remote tool execution.
- Fixed endpoint and operator-owned static bearer reference. A negative anonymous
  initialize must return401/403; authenticated initialize and `tools/list` must
  then succeed. Credentials are encrypted using the existing installer cell key.
  This proves an authenticated inventory exchange, **not a provider identity
  oracle**. No host MCP credentials are implicitly reused.
- All resolved IPs must be public; one validated address is pinned to the actual
  TLS socket without changing hostname/certificate validation. Bounded deadlines,
  headers, bodies, inventory pagination and schemas. Raw server errors/prose and
  credentials are never returned or logged.
- Exact schema/inventory matching; unreviewed extra/missing tools deny introduction.
  Only the **compiled demo read/append contract** currently exists. Adding another
  mapping means changing/reviewing compiled metadata, not sending model parameters
  or relying on `tools/list` to create tools.16/32 are maxima, not a claim that16
  actual servers have been integrated. No provider has been configured.
- Logical grant URLs never become fetch destinations. Bindings include exact
  operator, server, endpoint and reviewed schema. Account lookup provisions nothing;
  only the kernel's trusted account/introduction path can import explicit credentials.
- Every introduction revalidates inventory and credential liveness. Revocation
  invalidates retained resource handles and writes an encrypted tombstone that
  survives restart. Changing a credential binding never silently reuses the old
  record. Automatic reconnect and revocation-tombstone reset are unavailable.
- Opt-in driver lifecycle registration, empty default server config and **no model
  tools registered**. Every session/action/observer entry denies at this checkpoint.
  The plugin is not installed in production and no external server is contacted
  by importing it or loading the empty configuration.

## Decision requested: authoring Phase2

Proceed with the already-reviewed two-tool demo mapping using:

1. Kernel-only grant resolution and queue-authorized bounded read projection.
2. `awaitDecision:true`, `autoApprovable:false`, `implementsRevert:false` for the
   append action. No fabricated simulation, speculative mutation or generic undo.
3. Durable uncertain/nonretryable outcomes after ambiguous writes; exact-call
   native approval binding and explicit reconciliation rather than blind retries.
4. Owner-only observations; no generic MCP ACL oracle or shared-audience access.
5. Adversarial synthetic VM tests followed by an explicitly configured real server
   if/when available. Native denied/no-route secrecy remains a full acceptance
   blocker until a supported upstream fix passes. No approval/logging bypass.

This decision does not approve a new server, broaden tool schemas, enable stdio,
merge phase branches, release a beta, publish a package, or deploy to production.

## Evidence scope

See [PROGRESS.md](PROGRESS.md) for completed host/VM receipts. Account unit fixtures,
local TLS protocol tests and real Gateway plugin-lifecycle checks are distinct
claims; none counts as real-provider effect or full conformance acceptance.

## Why stop here

[write-gatekeeper/SKILL.md](../.agents/skills/write-gatekeeper/SKILL.md) step6 says
**“STOP 2 — ask the operator whether to proceed to Phase 2.”** Its opening rule is
**“do not proceed past either without operator approval.”** STOP1 approved the
presented API/URL contract; STOP2 is the concrete approval/action/observer work
above. Implementation does not cross this second boundary yet.
