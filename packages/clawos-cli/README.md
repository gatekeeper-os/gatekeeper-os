# @clawos/cli — `clawos`

Host orchestration uses upstream CLI/config APIs. Capability operations use the live
Gateway's paired-device operator RPCs; the CLI never opens the kernel database.

Implemented commands:

```text
clawos install [--yes]                 clawos cell create|list
clawos status                         clawos doctor
clawos config apply [--dry-run]        clawos backup create|restore
clawos kernel status                  clawos gatekeeper list
clawos grant add --agent <id> <url> [--title <title>] [--audience owner-only|shared]
clawos grant list [--agent <id>]        clawos grant revoke <handle>
clawos approvals list                  clawos approvals apply|reject|revert <id,id|all>
clawos audit tail [--limit 1–1000]
```

All accept `--cell <name>` (default: `default`) and `--json`. `audit tail` is a
bounded, newest-first snapshot, not a follow stream; time filtering is not yet
implemented and unsupported options are rejected. Approval commands expose the
kernel's existing decisions, not a promise that a driver can apply or revert:
real filesystem writes remain disabled. These mutating commands are not all
idempotent.

The cell registry selects the loopback port; cell naming selects both state and
config paths. No arbitrary endpoint, token, or operator-identity option is accepted.
The installed public SDK runs in a separate explicitly cell-scoped process. It
bootstraps using the cell's local token, closes that connection, reconnects with the
SDK-issued device credential, and only then sends the operator request. Pairing
failure, invalid input, an absent Gateway, or a malformed response fails closed.
The client resolves installer-created `CLAWOS_GATEWAY_TOKEN` env SecretRefs from the
cell's `.env`, or a directly configured local token; other authentication providers
are not yet supported. Credentials remain in process memory and never enter argv,
stdout, or error messages. RPC parameters travel to the helper on stdin.

With the kernel plugin enabled, `openclaw os status|grants|approvals|audit --json`
forwards to this same client. Both the CLI package and a registered cell are required.
Static plugin manifest metadata owns the `os` root command discovery.

Plugin installation/projection, install policy, gatekeeper connection, blueprints,
updates and rollback are still pending; they are not exposed as successful stubs.
