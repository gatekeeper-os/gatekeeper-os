# Phase 3 filesystem gatekeeper — STOP 1 review

Status: **awaiting operator review; metadata only, driver unimplemented**.
Base: `phase-2` / `a18d69e`. Branch: `phase/3-kernel`.

## Decision requested

Approve the three-tool directory contract below and local `file:///absolute/directory`
URL policy so filesystem driver implementation can begin. This does not approve the
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

Definitions: `packages/gatekeeper-fs/src/tools.ts` and `src/resources.ts`.
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
present the tool surface and URL patterns for operator review.” Prior Continue requests
authorized Phase 3 preparation, but did not review this concrete contract.
