# @clawos/gatekeeper-mcp

**STOP2: connection/grant-validation boundary; model tools and effects disabled.**

The [reviewed surface](../../plans/mcp-surface-contract.md) was approved on
2026-09-12. [STOP2](../../plans/mcp-stop2.md) describes the implemented boundary
and the next operator decision. This is not a general-purpose MCP proxy or beta
acceptance.

Opt-in plugin configuration binds a compiled server ID, exact public HTTPS URL,
operator identity and an environment credential reference. The initial compiled
surface is `demo` only; it is a synthetic notes example, not a deployed service.
No runtime discovery creates authority. No endpoint, credential or server-provided
text becomes a model tool parameter. Empty config contacts nothing.

Static credentials use the existing kernel-owned trusted account path and encrypted
TokenStore. An unauthenticated rejection plus authenticated inventory exchange is
required; this is not a vendor account-ID oracle. Generic OAuth discovery is not
implemented. Revocation tombstones survive restart; automatic reconnect is denied.
No secret values belong in plugin configuration or this package.

Transport supports only the bounded JSON-response HTTPS Streamable HTTP subset
using the public MCP SDK. DNS-to-socket pinning, public-address filtering, normal
TLS verification, fixed origins, no redirects, no retries, no client capabilities,
and exact reviewed inventory/schema comparison are enforced. SSE-only servers,
stdio, sampling, elicitation, resources/prompts, and tool calls are unsupported.

Verification:

```sh
pnpm --filter @clawos/gatekeeper-mcp typecheck
pnpm --filter @clawos/gatekeeper-mcp test
scripts/vm/test.sh phase-8 installed mcp-boundary
```

Full mode returns blocked until the later action/observation review and full
acceptance gates are complete. The fixture transport tests use local TLS sockets
with test-only network interception; there is no plugin-config loopback exception.
