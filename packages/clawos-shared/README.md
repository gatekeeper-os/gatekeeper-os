# @clawos/shared

Contracts for plan §4.3. **Kernel bar:** every exported member is documented. This package depends only on TypeBox.

`src/schemas.ts` supplies strict JSON schemas for resource/tool metadata, observations and actions, dry-pass and tool
results, private verifier transport, credential-free account/vendor/resource summaries, grants, queue rows, audit records,
status, and operator request payloads. Unknown fields are rejected. Identity comes from trusted RPC context, never a payload.

Queues, vendors, accounts, sessions and `SessionCallContext` are process-local interfaces, not wire types. Do not serialize
live implementations or approval callbacks. Normalize optional void decision results to `{}` for their wire schemas.
`PendingAction.descriptionJson` must also be parsed and checked with `ActionDescriptionSchema` by the store adapter.
Metadata schemas do not prove authorization or validate vendor business rules; those remain the kernel/kit's responsibility.

Grant handles use eight lowercase Crockford base32 symbols (`0-9a-hjkmnp-tv-z`), including the plan's `7k3m9q2p` example.
The old scaffold's all-alphanumeric regex was not base32. No runtime grant data has shipped yet.

Checks: `pnpm --filter @clawos/shared test` and `pnpm --filter @clawos/shared typecheck`.
