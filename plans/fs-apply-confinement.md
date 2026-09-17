# Filesystem apply confinement — design and blocking proof obligations

Status: **design-only; implementation blocked; real apply remains denied**.
Date: 2026-09-16. Base: `a029ed024e36295fc42742f97399e86459d48d4a`.
This document reports the design before product implementation. It does not change
[the approved contract](fs-contract.md), narrow its threat model, or claim a VM pass.
Linux local filesystems only; macOS parity and network filesystems are out of scope.

## Decision

The proposed combination of strict `openat2`, descriptor identity checks,
same-directory temporary files, `renameat`, and `fsync` **does not establish the
existing contract on a concurrently mutable directory tree**. Two deterministic
Linux syscall schedules reproduced an outside-grant publication and loss of an
external edit. See [source and recorded results](fs-apply-confinement-evidence.md).
These are counterexamples to this construction, not a proof that every possible
Linux isolation architecture is impossible.

Do not enable writes, advertise revert, or replace the threat-model/README
simulate-only statements with a stronger guarantee. The contract requires both:

- Replacement-race confinement or refusal (contract lines 55–59).
- Never overwriting an external edit because an older preview was approved
  (contract lines 75–76).

Detecting a violation after publication and journaling `uncertain` is necessary
recovery behavior, **not permission to cause an unconfined effect first**.
A narrowed create-only mode is not a completed replacement/revert implementation.

## Race inventory and Linux mechanisms

| Race | Mechanism and its actual guarantee | Remaining obligation / refusal |
| --- | --- | --- |
| Symlink swap between check and open | `openat2(rootfd, relative, RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_XDEV)` constrains that resolution. The fallback opens each component relative to a held directory FD with `O_DIRECTORY | O_NOFOLLOW`, then verifies with `fstat`; final files use `O_NOFOLLOW` and regular-file checks. No standalone `lstat`-then-path-open is acceptable. | Resolution protection is not post-open ancestry stability. Replaced final names must never be opened for truncation. Refuse if any traversal guarantee cannot be established. |
| Hardlink to outside the root | Reject non-regular or multiply linked files (`st_nlink != 1`). Publish a new inode instead of modifying the existing target inode, so an old alias is not written through. | Link count is a snapshot. A new alias to the staged inode, source-name replacement, or changes during preimage capture need prevention, not only rechecks. Same-UID actors are not stopped by protected-hardlink sysctls. Refuse absent a proven staging/ownership boundary. |
| Parent replacement / move after last check | Held FDs prevent a replaced pathname from silently retargeting an already-open FD. Strict resolution checks where it was opened. | An FD pins the directory object, not its location. The directory can move outside the grant before `renameat`. CE-1 reproduces this. Refuse unless ancestry stability through publication is established. |
| Mount changes / bind mounts | `RESOLVE_NO_XDEV` rejects crossings, including bind mounts, during the lookup. Native mount identity checks can supplement this. | Equal `st_dev` is NOT equivalent: a same-filesystem bind mount can retain it. Mountinfo or identity rechecks do not freeze topology. A fallback must prove equivalent restrictions or refuse; no transparent weak fallback. No hostile mount experiment was run here. |
| Final-path TOCTOU after baseline validation | No-follow preimage capture and stamp/hash comparison reject changes already visible. Atomic rename publishes a complete file. | Plain `renameat` is not compare-and-swap against an expected destination inode/version. CE-2 replaces an external edit after the last comparison, while the final desired hash still passes. Refuse replacement without exclusion or an adequate conditional transaction. |
| Crash / incomplete persistence | Write all bytes to a same-directory temporary file, handle short writes, fsync the file, publish atomically, fsync the parent. Persist intent and preimage before mutation, then the effect receipt. | Durability does not establish confinement or baseline freshness. Interrupted/ambiguous publication must remain blocked for reconciliation, never automatically replayed. |

### `openat2` and fallback limits

A native helper/addon owned by `packages/gkos-gatekeeper-fs` could expose the required
Linux calls; Node's standard `fs` API does not expose `openat2` or rename flags.
Any such packaging must work on the pinned Node 22.22.3, not just the development
runtime, and refuse unsupported kernels/filesystems. A helper is an implementation
option, **not a solution to CE-1/CE-2 by itself**.

The current `ConfinedIO` uses a controlled `/proc/self/fd` no-follow walk. Do not
call it fully equivalent to all strict `openat2` flags: mount crossings and concurrent
ancestry changes need separate proof. On `openat2` unavailability, a native
`openat`/`O_NOFOLLOW` + `fstat` identity walk may support the no-symlink portion;
real apply must still refuse if the full proof is unavailable. Do not downgrade
arbitrary syscall errors into a permissive fallback.

### Counterexample schedules

1. **CE-1:** open parent with strict `openat2`; stage/fsync; verify FD and path
   identity; hostile fixture moves parent outside grant and recreates old path;
   `renameat` relative to held parent publishes outside. A postcheck notices too late.
2. **CE-2:** capture baseline; verify target identity; hostile fixture replaces the
   final name with a new inode containing an external edit; rename replaces that
   inode. The new file has the desired hash, although the edit was lost.

The diagnostic uses explicit scheduling between checks and publication, not timing
luck. Both reproduced on Linux 6.18.50 x86_64. It uses only disposable fixtures;
there is no product exploit or product write path in this change.

`RENAME_NOREPLACE` can enforce absent-destination publication, not expected-inode
replacement, and does not solve parent movement. `RENAME_EXCHANGE` preserves a
swapped-out entry temporarily but still changes the target before validating it.
Exchange-back, verify-then-unlink, or post-write hash comparison introduce further
races; they are not accepted remedies. `flock` is advisory. A private mount
namespace alone does not prevent mutations through other aliases of the same
underlying filesystem. A mode/UID check alone does not exclude existing writable
FDs, mappings, ACL rights, or concurrent editors.

## Current integration facts (no changes)

- [Filesystem driver](../packages/gkos-gatekeeper-fs/src/directory.ts) describes and
  simulates pending writes, records a baseline stamp and overlay, and refuses
  `applyAction` before the kit journal is changed. `implementsRevert` is false.
- [I/O](../packages/gkos-gatekeeper-fs/src/io.ts) bounds text to 1 MiB, validates
  relative paths, checks regular/single-link files, and denies `create`.
- [Binding](../packages/gkos-gatekeeper-fs/src/paths.ts) records ancestor identities.
  Its own comment correctly says introduction-time validation is not race-safe I/O.
- [Kit journal](../packages/gatekeeper-kit/src/kit-gatekeeper.ts) persists
  `applying` before invoking the implementation; a throw becomes `uncertain`.
  `assertSettled` blocks sessions with unresolved outcomes. `applyAction` itself
  does not generally call that guard: a driver must also guard direct lifecycle
  entry points and recovered resource state, not assume session checks cover them.
- [Kernel coordinator](../packages/gkos-kernel/src/actions.ts) resolves the action's
  originating grant/session and calls `authority.authorize()` before claiming and
  applying it. The resolver in `kernel.ts` checks current grant, audience,
  lockdown, maintenance, and resource identity. This is authorization revalidation,
  not another interactive approval prompt.

The kit's `ActionImpl.apply(params, actionId)` does not receive a fresh grant callback.
A future driver must prove the authorization lifetime across sequencing/async helper
boundaries under existing interfaces; account liveness alone is not a grant check.
Do not assert that a kit change is inevitably required without that analysis, and do
not add a parallel grant authority to bypass the kernel. Kernel/kit remain unchanged.

## Conditional apply/revert design — NOT yet implementable under the proof above

Only after a supported environment/mechanism proves exclusion or atomicity for all
races, the driver-local transaction would be:

1. Resolve and re-authorize the original grant through the existing kernel decision
   path. Bind the exact resource/action, validate liveness and any unresolved driver
   receipt, and establish the final mutation's authority lifetime.
2. Acquire the proven confinement/serialization boundary. Resolve parent without
   symlinks or unsupported mounts. Refuse special, multiply linked, oversized,
   invalid-text or stale-baseline targets. Never create parents or alter permissions
   to manufacture a successful confinement check.
3. Capture a consistent **recorded preimage** (or explicit absence), identity,
   bytes and SHA256. Durably persist intent/preimage in private driver state, outside
   the grant, keyed to action and resource. The pending desired content is not the
   preimage; old cache contents are not a substitute.
4. Stage in the same parent with exclusive no-follow creation and a proven
   protected source identity; write bounded bytes and fsync. Recheck identities
   under the still-held exclusion boundary. A fresh check without that boundary
   is insufficient.
5. Publish without invalidating the approved baseline, fsync parent, then durably
   record `{actionId, resourceIdentity, path, bytes, sha256, preimageRef, phase}`.
   `path` is grant-relative; no host path or content goes into public audit output.
   A driver-owned effect-journal sidecar can carry these fields without extending
   the kit schema; its ordering/recovery relationship to the kit must be tested.
6. Return success only after effect and journal durability are established. Any
   uncertain outcome throws through kit `uncertain`, retaining the intent/preimage
   and blocking further actions for this resource across restart. If writing an
   uncertainty marker also fails, the prior durable in-flight record must still
   prevent retry. An intent phase is not proof a syscall never ran.

A deterministic denial before starting a transaction must perform no host mutation.
Once an apply transaction has started, ambiguity blocks instead of pretending it was
rejected. The current disabled path is unchanged; it does not claim an uncertain
host write that never occurred. No automatic cleanup/unlink/exchange-back is allowed
where target identity or confinement cannot be proved.

Revert is a new confined transaction, authorized again, only from the persisted
preimage. It must verify that the current file is the recorded applied version;
otherwise refuse/mark uncertain rather than overwriting an intervening edit.
An originally absent target needs safe conditional removal, **not create-new**;
that deletion introduces the same last-check race and also remains blocked. Neither
success nor `implementsRevert: true` may be advertised before the full matrix passes.

## What would unblock implementation

A follow-up design must demonstrate either an adequate atomic transaction primitive,
or an enforced single-writer/namespace boundary for the whole mutation interval.
For example, a separately managed driver-owned tree with an enforceable isolation
boundary merits investigation. Simply declaring all writers cooperative does not.

Any proposed restriction must state who can rename every ancestor (including above
the grant), replace a name, write through an existing descriptor/mapping, create
hardlinks or mounts, and mutate the protected staging area. It must account for
benign external edits as well as hostile races. Excluding same-UID processes or
allowing temporary replacement followed by reconciliation would change supported
assumptions and cannot silently replace the approved contract.

ATLAS's planning review agreed on the counterexamples, but its suggested
exchange-and-reconcile/ownership alternative is **not adopted as a safe design**:
post-effect recovery falls short of the no-overwrite requirement; mode checks do not
prove exclusive writers. No general impossibility theorem or permanent refusal of
all future implementations is claimed. Until the above obligations are met, deny.

## Acceptance plan and current receipts

Required before a product PR can claim completion:

- Deterministic hostile fixtures for symlink, hardlink, source-temp substitution,
  parent/root relocation, mount interposition, final-name and in-place edits. Run
  at each mutation boundary; assert outside sentinels and external edits unchanged,
  not just an error return. Exercise openat2 and forced fallback/refusal separately.
- Apply-time revoked/expired/wrong-resource grant refusal; crash/fault injection
  before and after every journal, write, rename and fsync; persistent uncertain
  blocking on all action entry points; no blind retries.
- Revert from the durable preimage only, including absent preimage, intervening edit,
  lost/corrupt receipt, restart and durability failures.
- Packed model-turn gate: explicit approved write lands on disk with matching
  path/byte/hash effect receipt; rejected write never lands; ordinary capability,
  owner-only, independent-gatekeeper and no-grant denials stay intact.
- VM runner only: `scripts/vm/test.sh`. The old `test/phase-3-fs-boundary.sh` is a
  retired entry point that exits 2; the maintained home is
  `test/phase-3-fs-enforcement.sh`. A new checkpoint must exercise the real write
  and refusal cases, record guest Node 22.22.3, kernel, filesystem, source SHA and
  run id, and must not relabel historical boundary receipts as a new pass.

**This change:** two raw-syscall design counterexamples reproduced; documentation
review only. No new product unit/race/packed write test, no VM invocation, no VM run
id. Existing threat-model and README proof rows remain unchanged because real
filesystem apply has not passed. Green PR `build-test` is repository regression
validation, not acceptance of this blocked feature.

## Syscall references

- [openat2(2)](https://man7.org/linux/man-pages/man2/openat2.2.html): resolve flags
  constrain lookup; `RESOLVE_NO_XDEV` includes bind mounts.
- [open(2)](https://man7.org/linux/man-pages/man2/open.2.html): directory FDs remain
  stable references even if the directory is renamed.
- [rename(2)](https://man7.org/linux/man-pages/man2/rename.2.html): atomic replacement,
  `RENAME_NOREPLACE` and `RENAME_EXCHANGE` semantics; no expected-inode argument.
- [flock(2)](https://man7.org/linux/man-pages/man2/flock.2.html): advisory locking.
- [fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html): data/metadata
  durability and separately syncing the containing directory.
