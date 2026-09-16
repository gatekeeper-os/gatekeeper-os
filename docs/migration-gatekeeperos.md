# Rename to GatekeeperOS

GatekeeperOS provides capability-based access and deferred approvals for OpenClaw.

Matt selected this name because “OpenClaw OS” collides with the pending OPENCLAW
mark and two existing projects, and “clawkeeper” collides with three OpenClaw
security projects. This records the supplied rationale, not a new trademark search.

GatekeeperOS is an independent project. It is not affiliated with or endorsed by the OpenClaw Foundation. OpenClaw is a trademark of its owner.

## Identifier migration

| Previous | New |
|---|---|
| `clawkeeper/openclaw-os` | `gatekeeper-os/gatekeeper-os` |
| `clawkeeper/{gatekeepers,.github}` | `gatekeeper-os/{gatekeepers,.github}` |
| `@clawkeepers/{shared,gatekeeper-kit,kernel,gatekeeper-fs,cli}` | Same five names under `@gatekeeper-os` |
| Private npm github/mcp/http packages | Same suffixes under `@gatekeeper-os` |
| `clawos` standalone binary | `gkos` |
| `CLAWOS_*` owned environment variables | `GKOS_*` |
| `clawos-kernel` | `gkos-kernel` |
| `gatekeeper-{fs,github,mcp}` | `gkos-gatekeeper-{fs,github,mcp}` |
| `clawos.lock.json`, owned drop-ins and helper names | `gkos.lock.json` and `gkos` names |

The placeholder HTTP id and all driver id contracts follow `gkos-gatekeeper-*`.
Package directories follow the new identifiers. Tool names remain `gk_*`, Gateway
RPC methods remain `os.*`, and the mounted root remains `openclaw os`. Grant-handle
format, content-addressed cell-local layout and `<stateDir>/os/` are unchanged.
Upstream-owned `OPENCLAW_*` variables and upstream Gateway service names are unchanged;
GatekeeperOS-owned drop-ins/helper prefixes change. No automatic migration of an
existing cell is claimed: old configs/env/plugin ids must be reconciled deliberately.

## Current publication and acceptance

The rename is complete. Five `@gatekeeper-os` packages are published at
`0.1.0-beta.5`, with both `beta` and `latest` selecting it and no stable release.
The three repositories are public; trusted publishers are configured. npm-only
acceptance `20260916-220009-phase-3` passed on Node22.22.3 / OpenClaw2026.9.2;
core PR24 and community PR9 merged the acceptance and real registry dependency lock.
Real filesystem writes, real transports, GitHub/MCP full acceptance and ClawHub
listing remain unestablished.

The old-scope beta.1 and earlier renamed releases remain historical migration
receipts, not current installation instructions. Their failed runs are retained
unchanged in PROGRESS; the later pass does not reclassify them.

## Intentional old-name survivors

- `plans/PROGRESS.md`: original historical receipts, commands, SHAs and artifact
  paths remain verbatim; new entries identify GatekeeperOS.
- Root and all ten package `NOTICE` files: byte-for-byte retained license and
  attribution provenance, including the original project name; LICENSE unchanged.
- This migration note and the publication handoff: old→new mapping and exact old
  npm deprecation targets are necessary operator instructions.
- Separate community rename: historical temporary npm aliases/identity tests
  resolved the old beta.1 kit/shared. Those aliases were removed by the merged
  real beta.5 registry dependency switch. Community’s historical validation
  receipt and NOTICE retain the original identifiers.
- Existing external checkout/worktree paths and immutable VM/disclosure receipts
  retain their names. Remotes are repointed; unrelated worktrees are not rewritten.

A tracked-tree literal scan for `clawos|clawkeeper|CLAWOS_|openclaw-os` is recorded
with the release handoff. These survivors are not accepted runtime aliases.
