# @clawos/gatekeeper-mcp

**STOP1: proposed surface only; no usable MCP transport or plugin runtime.**

The overnight implementation order now prioritizes this driver after Phase6.
Review [the concrete contract](../../plans/mcp-surface-contract.md) before account,
transport, tool invocation or action implementation. `src/tools.ts` and
`src/resources.ts` are inert proposal metadata; the extension entry remains empty,
manifest tools remain empty, and startup remains disabled. No server is contacted.

The proposal uses individually named, operator-reviewed tools and owner-only
server grants. It does not expose arbitrary `tools/call`, URLs, headers, shell
commands or discovered tool lists to a model. Initial transport scope is HTTPS
Streamable HTTP; stdio and remote dynamic registration are separate review items.
