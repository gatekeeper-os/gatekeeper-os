# @gatekeeper-os/cli — `gkos`

GatekeeperOS is an independent project. It is not affiliated with or endorsed by the OpenClaw Foundation. OpenClaw is a trademark of its owner.

Host orchestration uses upstream CLI/config APIs. Capability operations use the live
Gateway's paired-device operator RPCs; the CLI never opens the kernel database.

## Install the published beta

```sh
npm install --global @gatekeeper-os/cli@beta
gkos --version
gkos cell create evaluation --port 19100 --policy messaging
```

Use a disposable machine for provisioning. All five release packages are at
`0.1.0-beta.5`; `beta` and `latest` select it, with no stable release. npm-only
acceptance passed in `20260916-220009-phase-3` on Node22.22.3 / OpenClaw2026.9.2.
See the [release status](../../README.md#release-status) for remaining limits.
The npm package-page README updates on the next publication; this docs change
neither republishes nor changes the existing archive. No ClawHub listing is claimed.

Implemented commands:

```text
gkos install [--yes]                 gkos cell create|list
gkos status                         gkos doctor
gkos config apply [--dry-run]        gkos backup create|restore
gkos kernel status                  gkos gatekeeper list|connect <vendor>
gkos grant add --agent <id> <url> [--title <title>] [--audience owner-only]
gkos grant list [--agent <id>]        gkos grant revoke <handle>
gkos approvals list                  gkos approvals apply|reject|revert <id,id|all>
gkos approvals grant|reject-request <id,id|all>
gkos audit tail [--limit 1–1000]
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
The client resolves installer-created `GKOS_GATEWAY_TOKEN` env SecretRefs from the
cell's `.env`, or a directly configured local token; other authentication providers
are not yet supported. Credentials remain in process memory and never enter argv,
stdout, or error messages. RPC parameters travel to the helper on stdin.

With the kernel plugin enabled, `openclaw os status|grants|approvals|audit --json`
forwards to this same client. Both the CLI package and a registered cell are required.
Static plugin manifest metadata owns the `os` root command discovery.

The source installer projects the bundled kernel/filesystem plugins and configures
the cell-local install policy. `gkos install-policy` evaluates installation
requests for upstream; it is not a general plugin-management interface.

`gkos gatekeeper connect <vendor>` starts the kernel's single-use connection
flow. Static filesystem account connection has live Phase 3 evidence; real GitHub
OAuth and effects require Phase 4 acceptance. No connection grants resources by
itself. Shared grants are rejected under the owner-only beta boundary.

Blueprint provisioning and staged update/rollback are implemented with scoped runtime
checkpoints; see [blueprints](../../docs/blueprints.md) and [updating](../../docs/updating.md).
Full driver-integrated acceptance remains open. General gatekeeper installation
is not a successful stub or an accepted integration.
