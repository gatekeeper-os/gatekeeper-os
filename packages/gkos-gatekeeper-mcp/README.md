# @gatekeeper-os/gatekeeper-mcp

**STOP2 approved: private observations implemented; generic native actions disabled.**

The [surface contract](../../plans/mcp-surface-contract.md) and
[STOP2 decision](../../plans/mcp-stop2.md) were approved on 2026-09-12. Runtime
publishes only `gk_mcp_demo_read_note`. The reviewed append mapping is still
checked for inventory drift, but is not registered under GatekeeperOS's own default-off
native-approval log-hygiene policy. No provider or production installation exists.

Opt-in configuration binds the compiled `demo` server, exact public HTTPS URL,
operator identity and an environment credential reference. Empty config contacts
nothing. Logical `.invalid` grant identifiers are never network destinations.
Static credentials use the kernel’s trusted account path and encrypted TokenStore;
anonymous rejection and authenticated inventory are required, not an account-ID
oracle. Persistent revocation tombstones prevent silent re-provisioning.

Bounded JSON-response Streamable HTTP uses the public MCP SDK, DNS/socket pinning,
normal TLS, fixed origins and no redirects/retries. Same-session inventory/schema
checks precede reads. SSE, stdio, OAuth discovery, sampling, elicitation and
resources/prompts are unsupported; returned content never supplies authority.

Every read authorizes before fetching and again before returning, checks liveness,
projects bounded note fields, and refreshes a private bounded cache. Failed refresh
never returns stale content. Sharing is private-only; no generic ACL oracle exists.
Generic append has `awaitDecision:true`, `autoApprovable:false`,
`implementsRevert:false`, no simulation, and hard apply denial.

The deterministic notes adapter under `src/testing/` is test-only, excluded from
the production bundle and not selectable in configuration. It exercises the kit’s
standard deferred path, overlays, operator apply/reject and durable uncertain
outcomes in unit tests and the disposable Gateway fixture. This is not a real
provider or native action acceptance claim.

```sh
pnpm --filter @gatekeeper-os/gatekeeper-mcp typecheck
pnpm --filter @gatekeeper-os/gatekeeper-mcp test
scripts/vm/test.sh phase-8 installed mcp-boundary
```

Full mode returns blocked until real-provider and native secrecy gates pass.
See [PROGRESS](../../plans/PROGRESS.md) for actual host/VM results.

## Distribution

This is a source/workspace package, not one of the five published beta packages. Its implementation or tests do not establish full driver acceptance. See the [release status](../../README.md#release-status).

**GHSA-22jj-m53c-524m disposition (2026-09-12):** the OpenClaw maintainers closed the advisory as not requiring a change: “crosses no OpenClaw trust boundary — a denied tool still never executes, and the logs are operator-owned on the operator's host, where the same tool arguments are already retained in operator-readable session transcripts”. GatekeeperOS keeps the synchronous path (`awaitDecision` → native `requireApproval`) off by default as its own log-hygiene choice, not pending an upstream fix. Enabling it can put tool arguments in the operator's Gateway logs on denial or when no approval route exists; denial still prevents execution. This disposition does not turn previous failed body-secrecy checks into passes or establish full GitHub/MCP acceptance.
