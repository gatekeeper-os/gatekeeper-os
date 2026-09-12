# @clawkeepers/kernel

The kernel (plan §5). **Kernel bar** applies: every line reviewed, every export doc-commented, SDK calls only in `src/upstream/`.
`Kernel.resolveGrant()` is the single chokepoint through which every gatekeeper reach passes.

## Operator surfaces

- `clawos gatekeeper connect <vendor>`: authenticated, cell-bound one-use browser start URL. The kernel owns the two-stage kit nonce; vendor adapters own provider PKCE/account checks and encrypted tokens. Static filesystem accounts require no external login.
- `clawos approvals list`: bounded `{actions, requests}` response, including action descriptions/previews and agent resource requests.
- `clawos approvals apply|reject|revert <IDs|all>`: serialized decisions through the originating grant/session, with durable uncertain-outcome records; applied actions alone may be reverted.
- `clawos approvals grant|reject-request <IDs|all>`: decide stored agent access requests; agents cannot mint grants.
- Private operator chat: `/approvals list|apply|reject|revert|grant|reject-request` and `/grants list|revoke`. Commands are claimed in authenticated `reply_dispatch`, before the model. The later `before_agent_reply` hook only denies unauthenticated fallthrough because it lacks trusted owner/audience facts.

Beta denies both minting and using shared grants. Resource access remains owner-only; known shared audiences are persistently tainted before prompt construction.

The drainer starts with the gateway and runs every 30 seconds and at `agent_end`. Both an explicit `autoApprove` tag rule and a per-action `autoApprovable: true` are required; synchronous-approval actions are excluded. It stops at ineligible/uncertain work and shares the explicit-decision mutex. Shutdown waits for in-flight effects before closing SQLite.

With operator `notify: {channel, target}` configured, pending counts are batched once per run through the installed `openclaw message send` CLI. Digests never contain action bodies or resource URLs. An uncertain send is audited and not automatically repeated. Real-channel digest acceptance and GitHub action acceptance remain Phases 5 and 4 respectively.

Old unbound pending actions cannot acquire authority from another grant. They require reconciliation, as do failed/uncertain resource effects. No exactly-once guarantee across external APIs is claimed. Filesystem real writes continue to fail closed under the approved atomicity contract; unsupported platforms deny filesystem data access.
