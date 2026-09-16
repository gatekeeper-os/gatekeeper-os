# @gatekeeper-os/gatekeeper-fs

GatekeeperOS is an independent project. It is not affiliated with or endorsed by the OpenClaw Foundation. OpenClaw is a trademark of its owner.

The published filesystem reference driver provides scoped directory listing,
bounded Linux file reads and simulated writes. No OAuth or external credentials
are required. Explicit `config.roots` is an allowlist; empty roots deny all
introductions. The kernel authenticates the operator and activates grants;
account lookup does not grant access. Accounts are per-operator and revocable.

The tools are `gk_fs_dir_list`, `gk_fs_file_read` and `gk_fs_file_write`.
Reads require authorization and revalidate it before returning data. Pending
writes are overlays visible to subsequent reads; rejecting an action removes
the overlay. **Applying real writes remains disabled** because the approved
atomic confinement requirement, including hardlinks and parent replacement,
has not been satisfied. Simulated effects do not imply a disk mutation. No
revert or automatic-write policy is offered; grants remain owner-only.

Titles omit host paths. `resourceKey` is a canonical URL for private kernel
storage, not an agent-facing title. Unsupported platforms deny filesystem
access; introduction-time identity checks alone do not establish I/O safety.
See the [approved filesystem contract](../../plans/fs-contract.md).

## Acceptance scope

Beta.5 npm-only run `20260916-220009-phase-3` passed on Node22.22.3 /
OpenClaw2026.9.2, including the 114/114 kernel-live stage with granted reads,
revocation, native denials and simulated-write refusal. Successful approval
apply/reject effects came from an independent synthetic gatekeeper, not this
filesystem driver. Earlier `fs-boundary` runs were narrower account/resource
checkpoints, not the current implementation limit. See [PROGRESS](../../plans/PROGRESS.md).

## Distribution

`@gatekeeper-os/gatekeeper-fs@0.1.0-beta.5` is published; `beta` and `latest` select it (no stable release). For cell installation use `npm install --global @gatekeeper-os/cli@beta` on a disposable evaluation machine, then follow the [CLI instructions](../gkos-cli/README.md). The npm package-page README updates on the next publication; this documentation change does not alter the existing archive.
