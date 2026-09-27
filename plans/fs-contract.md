# Phase 3 filesystem gatekeeper — approved STOP 1 contract

Status: **approved by the operator’s “continuew” reply on 2026-09-07, following presentation of commit `7642efb`.**
STOP 2 was subsequently approved by “Approved continue”. See PROGRESS.md for implementation evidence and limits; this document preserves the originally reviewed surface.
Base: `phase-2` / `a18d69e`. Branch: `phase/3-kernel`.

## Approved decision

The three-tool directory contract below and local `file:///absolute/directory`
URL policy authorize filesystem driver implementation. This does not approve the
skill's separate STOP 2 (approval/simulation/observer implementation), grant access to
any real host directory, or authorize production installation. Configured roots stay empty.

## Tool surface

All three tools require an opaque `grant` handle. Unknown fields, including caller-supplied
identity or approval values, are rejected. All three belong to resource type `dir`;
`file` in the existing tool names does not create a separately grantable resource.

| Tool | Other inputs | Structured result (`ToolResult.details`) |
| --- | --- | --- |
| `gk_fs_dir_list` | optional relative `subpath`; omitted means grant root | `entries: [{name, kind}]`; kind is file, directory, or unavailable |
| `gk_fs_file_read` | relative `path` | `{path, content}` (UTF-8 text) |
| `gk_fs_file_write` | relative `path`, UTF-8 `content` | `{path, bytes}` |

Definitions: `packages/gkos-gatekeeper-fs/src/tools.ts` and `src/resources.ts`.
The existing tool names and input names are retained. New constraints are closed input
objects, valid handle shape, bounded paths/content, and explicit output schemas.
No delete, rename, mkdir, recursive listing, shell, binary-file, or arbitrary-host tools.

- Paths are relative POSIX paths, at most 4096 UTF-8 bytes. Reject absolute paths,
  empty components, `.`/`..`, backslashes and NUL. Paths are literal strings, not URLs;
  do not percent-decode tool parameters. Omit `subpath` to list the root.
- List one level, sorted by name, at most 1000 entries. Larger directories return a
  bounded error rather than a silently partial list; no pagination in this first API.
  Symlinks and special entries are labeled unavailable without following their targets.
- Read/write regular UTF-8 text files only, up to 1 MiB **encoded bytes**. Reject invalid
  UTF-8, binary/NUL content, oversized files and special files. Schemas bound strings;
  the driver must additionally enforce byte limits. Never silently truncate.
- Write creates or replaces one file; its parent directory must already exist.
  No automatic parent creation or permission changes. Do not expose absolute host paths,
  raw OS errors, or content in audit logs. Content is returned only through authorized reads.

## URL and authority boundary

Candidate metadata pattern stays `file:///:path+`; actual recognition must parse and
validate the original URL, not trust a glob or URL normalization alone:

- Accept only local, authority-empty `file:///absolute/directory` URLs. Reject credentials,
  ports, remote hosts (including `localhost` aliases), query strings and fragments.
- Decode URL path once; reject malformed escapes, encoded separators, NUL, and raw or
  encoded dot traversal before normalization. Spaces encoded as `%20` are supported.
- Directory must exist at or below an explicitly operator-configured `roots` entry,
  using component-aware containment (not a string prefix). Empty roots deny everything.
- No symlink components; no symlink following in grants, reads or writes. Reject multiply
  linked regular files for read/write to avoid granting an alias outside the root.
  Recheck identity/containment at use and apply time; a precheck alone is not a race defense.
  Implementation must prove replacement-race confinement or deny the unsafe operation;
  this review does not authorize weakening the boundary if portable primitives fall short.
- Configuring a root is an allowlist, not an ambient grant. Only the kernel's trusted
  operator path activates a grant; pasted URLs from non-operators cannot do so.
- Resource identity and credentials are constructor-bound, never taken from tool inputs.
  Tools execute only through `Kernel.resolveGrant()`; gatekeepers never register tools.
- Keep the plan's strategy D metadata, but v1 kernel owner-only audience enforcement
  remains mandatory. This is not permission to share filesystem content in group sessions.

Examples: `file:///home/tester/fixtures/project` is eligible only beneath a configured
root; `file://remote/share`, `file:///etc?x=1`, and sibling-prefix escapes are rejected.

## Later write behavior (not implemented or approved by this review)

After STOP 2, writes will use the kit's deferred action lifecycle: describe without side
effects, retain a pending overlay, then apply only on an operator decision. Do not advertise
revert support until implemented and verified; proposed v1 `implementsRevert: false`.
At apply, reject external changes since the captured baseline; never overwrite an edit
because an older preview was approved. No automatic write approval is proposed.

## Verification and stop source

Metadata validation is recorded in `plans/PROGRESS.md`; no Phase 3 VM acceptance or
filesystem enforcement is claimed. The vendor/account methods remain stubs.

`.agents/skills/write-gatekeeper/SKILL.md` says: “There are two mandatory STOP points
below — do not proceed past either without operator approval.” Step 3 is “STOP 1 —
present the tool surface and URL patterns for operator review.” Prior Continue requests authorized preparation. The later “continuew” reply followed the
concrete approval request and authorizes proceeding past STOP 1 only.

## Amendment 2026-09-27 — cooperative-writer adversary model for apply

Status: **operator decision (Matt), 2026-09-27.** The text above is unchanged and
still governs the tool surface, URL policy and read path. This amendment changes
only the adversary model for real filesystem **apply and revert**. It follows the
design review in [fs-apply-confinement.md](fs-apply-confinement.md), whose two
reproduced counterexamples ([evidence](fs-apply-confinement-evidence.md)) show that
no check-then-publish construction reachable from Node satisfies the original
wording against a hostile process running as the same Unix user.

**Adversary model.** Apply assumes *cooperative writers* on the operator's host:
the operator, their editors, and their tools may edit files in a granted tree at
any time, but no process races the driver on purpose. Hostile concurrent mutation
of the operator's own tree by a same-UID process is out of scope. This matches
[the threat model](../docs/threat-model.md): other code running as the Gateway's
user is trusted, like plugins; mutually distrusting parties get separate cells.

**What this assumes about the agent.** The agent is still an adversary (threat
model adversary 1). The guarantee holds only while the agent cannot run its own
code or native file tools against the granted tree. The baseline cell denies the
runtime, filesystem and automation tool groups (`config/config.d/00-baseline.json5`). An operator
who gives the agent `exec`, native file tools, or a sandbox mount over a granted
directory has let a possibly steered same-UID writer in, and the cooperative-writer
guarantee no longer holds for that tree.

**Benign concurrent edits.** Before publishing, the driver re-reads the target's
identity (device, inode, link count, size, timestamps) and content hash and compares
them with the baseline recorded when the write was queued. If anything changed, it
refuses and keeps both versions. The window between that last check and the
publishing syscall is **residual**: an edit that lands inside it is not prevented.
With `RENAME_EXCHANGE`, the driver then checks that the file it swapped out is the
baseline, so an edit that replaced the file in that window is detected and kept.
With plain `rename`, an edit that replaced the file in that window is lost.
The effect receipt records which publish mode ran.

**Counterexamples.**
- *CE-1* (parent moved outside the grant between the final check and publication)
  needs a process that deliberately moves an ancestor of the target mid-transaction.
  Only the excluded adversary does that. The driver still rechecks the parent's
  identity and path before and after publishing. If it detects a move, it records
  `uncertain` and blocks the resource. It does not claim to prevent the move.
- *CE-2* (external replacement of the final name) must become detected, recoverable
  divergence, never silent loss, whenever the publish mode can observe it: a
  replacement before the final check is refused with both versions kept; one in
  the exchange window is detected after the swap with both versions kept. In
  plain-`rename` mode the check→publish window above is the documented exception.

**Obligations that still hold.** No symlink following; no multiply linked,
special, oversized or non-text targets; parents are never created and permissions
are never changed; the preimage is journaled durably before any mutation; any
ambiguous outcome is `uncertain`, keeps its intent and preimage, blocks the resource
across restart, and is never retried or cleaned up automatically. Revert restores
only the persisted preimage, and only when the current file is the recorded applied
version. Revert of an originally absent file stays unimplemented. No race-safety
against hostile processes on the same host is claimed.
