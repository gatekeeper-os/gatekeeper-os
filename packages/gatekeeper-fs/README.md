# @clawos/gatekeeper-fs

Phase 3's first driver, currently at the **STOP 2 account/resource checkpoint**.
No OAuth or external credentials. Explicit `config.roots` is an allowlist; empty roots
deny all introductions. The kernel, not this package, authenticates the operator and
activates grants. Accounts are per-operator and revocable; no account lookup auto-grants access.

Implemented: original local-file URL validation, component-aware root containment,
symlink-component refusal, directory identity capture/revalidation, account revocation,
constructor-bound `KitGatekeeper` resources, metadata and deployment inputs. Titles omit host
paths. `resourceKey` is a canonical URL for private kernel storage, not an agent-facing title.

**No list/read/write operation is executable.** Session creation, action application and
observer verification fail closed. Directory identity checks establish an introduction-time
binding only; they are not a replacement-race defense for file I/O. The later use/apply
implementation must prove confinement (including hardlinks and parent replacement) or deny.
No check-then-open/realpath-only I/O is permitted by the approved contract.

The approved tools remain `gk_fs_dir_list`, `gk_fs_file_read`, `gk_fs_file_write`.
After STOP 2: kernel authorization, race-confined bounded UTF-8 I/O, pending overlays,
external-edit refusal on apply, and owner-only audience enforcement. Strategy `low-stakes`
does not grant sharing; no revert or automatic-write policy is offered.

Focused checkpoint: `scripts/vm/test.sh phase-3 installed fs-boundary` from the disposable
VM driver. This is explicitly **not full Phase 3 acceptance** and installs no runtime plugin.
