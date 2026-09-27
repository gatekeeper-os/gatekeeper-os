# @gatekeeper-os/gatekeeper-fs

GatekeeperOS is an independent project. It is not affiliated with or endorsed by the OpenClaw Foundation. OpenClaw is a trademark of its owner.

The filesystem reference driver provides scoped directory listing, bounded Linux
file reads, and operator-approved text writes (published beta.5 simulates writes only). No OAuth or external credentials
are required. Explicit `config.roots` is an allowlist; empty roots deny all
introductions. The kernel authenticates the operator and activates grants;
account lookup does not grant access. Accounts are per-operator and revocable.

The tools are `gk_fs_dir_list`, `gk_fs_file_read` and `gk_fs_file_write`.
Reads require authorization and revalidate it before returning data. Pending
writes are overlays visible to subsequent reads; rejecting an action removes
the overlay. Applying a write changes the disk only after an operator decision, under the
[cooperative-writer contract](../../plans/fs-contract.md#amendment-2026-09-27--cooperative-writer-adversary-model-for-apply).

- **Guarantee.** The target is reached by a no-follow descriptor walk that stays on the grant
  root's mount. It must be a single-link, regular, UTF-8 text file of at most 1 MiB, owned by
  the Gateway user, and its identity and content hash must still match the baseline recorded when
  the write was requested. Otherwise the write is refused and nothing changes. The driver journals
  the preimage durably, stages the new content beside the target, rechecks the baseline, publishes,
  verifies, fsyncs, and then writes an effect receipt
  `{actionId, resourceIdentity, path, bytes, sha256, preimageRef, publish}`. New files are
  published with `link()`, so an existing name is never replaced.
- **Residual window.** An edit that lands between the final check and the publishing syscall is
  not prevented. With `RENAME_EXCHANGE` (util-linux `exch` ≥ 2.40 or GNU `mv --exchange` ≥ 9.5,
  root-owned or in the Nix store) it is detected afterwards and both versions are kept. With
  plain `rename` (for example stock Ubuntu 24.04) it is lost. `publish` in the receipt records
  `exchange`, `rename` or `link`.
- **Excluded adversary.** Processes running as the Gateway's user that race the driver on
  purpose, including an agent given `exec`, native file tools or a sandbox mount over the grant.
  No race-safety against hostile processes on the same host is claimed.
- **Ambiguity.** Any failure after the intent is journaled leaves the action `uncertain`. Files,
  intent and preimage are kept, the resource is blocked across restarts, and nothing is retried or
  cleaned up automatically. Reconciliation is manual.
- **Revert** restores the recorded preimage, and only while the file is still the applied version.
  Revert of a newly created file is not implemented. No automatic-write policy is offered, and
  grants remain owner-only.

Titles omit host paths. `resourceKey` is a canonical URL for private kernel
storage, not an agent-facing title. Unsupported platforms deny filesystem
access; introduction-time identity checks alone do not establish I/O safety.
See the [approved filesystem contract](../../plans/fs-contract.md).

## Acceptance scope

Real apply (unreleased): VM checkpoint `20260927-051331-phase-3` passed on guest Node 22.22.3,
kernel 6.8.0, ext4, in `rename` mode: real write, refusal, CE-2 detection, revert and
bind-mount refusal ([receipt](../../plans/fs-apply-checkpoint.md)). The packed model-turn gate
covers approved create/replace, rejection and uncertain blocking.

Beta.5 npm-only run `20260916-220009-phase-3` passed on Node22.22.3 /
OpenClaw2026.9.2, including the 114/114 kernel-live stage with granted reads,
revocation, native denials and simulated-write refusal. Successful approval
apply/reject effects came from an independent synthetic gatekeeper, not this
filesystem driver. Earlier `fs-boundary` runs were narrower account/resource
checkpoints, not the current implementation limit. See [PROGRESS](../../plans/PROGRESS.md).

## Distribution

`@gatekeeper-os/gatekeeper-fs@0.1.0-beta.5` is published; `beta` and `latest` select it (no stable release). For cell installation use `npm install --global @gatekeeper-os/cli@beta` on a disposable evaluation machine, then follow the [CLI instructions](../gkos-cli/README.md). The npm package-page README updates on the next publication; this documentation change does not alter the existing archive.
