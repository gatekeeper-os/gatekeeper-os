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

## Publication and acceptance hold

Beta.1 exists only under `@clawkeepers`. Beta.2 under `@gatekeeper-os` has not been
published. The old scope’s `latest` resolves to beta.1 because no stable release
exists. New-scope install commands are post-publication instructions, not evidence
of an available registry package. No real messaging, fs-write or other unproven
acceptance claim changes with this rename.

The last npm-only beta.1 run `20260913-002140-phase-3` exited 1 after 5/5 registry
identities, messaging-cell/effective-selector checks and 14/14 install-policy checks.
A harness ownership declaration failed upstream validation; kernel-live, audience
and approvals did not run (0 model turns). The fixture-only correction passed a
schema probe but was not rerun. VM shutdown/memlock restoration/original snapshot
preservation are recorded in PROGRESS. Its harness changes remain separately
unmerged; this identifier-only PR does not adopt them or claim acceptance.

After Matt publishes beta.2: run npm-only VM acceptance against the five exact new
packages and merge the community Tier 1 dependency switch only after green CI.
No visibility change, publish, tag push, trusted-publisher setup, release-workflow
rerun, phase tag or upstream post is authorized by this preparation.

## Intentional old-name survivors

- `plans/PROGRESS.md`: original historical receipts, commands, SHAs and artifact
  paths remain verbatim; new entries identify GatekeeperOS.
- Root and all ten package `NOTICE` files: byte-for-byte retained license and
  attribution provenance, including the original project name; LICENSE unchanged.
- This migration note and the publication handoff: old→new mapping and exact old
  npm deprecation targets are necessary operator instructions.
- Separate community rename: temporary npm aliases and lockfile/identity tests
  resolve the actual published beta.1 kit/shared; the old example plugin id matches
  that kit’s enforced contract. New beta.2 deps/contract switch stays unmerged until
  publication. Community’s historical validation receipt/NOTICE stay as recorded.
- Existing external checkout/worktree paths and immutable VM/disclosure receipts
  retain their names. Remotes are repointed; unrelated worktrees are not rewritten.

A tracked-tree literal scan for `clawos|clawkeeper|CLAWOS_|openclaw-os` is recorded
with the release handoff. These survivors are not accepted runtime aliases.
