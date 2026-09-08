# Phase 3 filesystem gatekeeper — STOP 2 review

Status: **account/resource implementation verified; awaiting STOP 2 approval**.
Branch: `phase/3-kernel`. Phases 0–2 remain complete; Phase 3 is not complete or tagged.

## Approval already recorded

The operator’s “continuew” reply on 2026-09-07 followed the concrete STOP 1 request
at `7642efb`. It approves [the preserved filesystem contract](fs-contract.md), without
waiving this separate gate or granting access to production directories.

## Implemented for review

- No-credential vendor with explicit, copied root configuration and per-operator accounts.
  Account lookup alone provisions nothing; malformed roots fail closed.
- Original local-file URL parsing before normalization, component-aware containment,
  symlink-component refusal, and directory device/inode identity checks.
- Constructor-bound directory resources. Replaced paths cannot silently rebind retained
  resources. Revoking an account invalidates its retained resources without affecting another operator.
- Existing plugin lifecycle registration and catalog metadata retained; deployment inputs
  contain no credentials. No tools are registered by the gatekeeper.
- **All sessions, file operations, action application and observer verification remain
  disabled.** No unapproved data-plane behavior is reachable. No production/config changes.

Directory identity checks are introduction-time validation, **not race-safe I/O**. This
checkpoint does not claim confinement against concurrent replacement while reading/writing.

## Decision requested

Proceed to the skill’s authoring Phase 2 (responsibilities 4–7): integrate kernel-owned
read/action authorization; implement race-confined bounded list/read/write operations;
add persistent pending overlays and explicit operator application; reject external edits
at apply; enforce owner-only audiences; and run the required live VM conformance.

The approved three-tool surface and URL policy remain unchanged. No automatic writes,
revert support, sharing, or production installation is proposed. If confinement cannot
be established with supported primitives, unsafe operations must stay disabled.

Ordered kernel runtime implementation remains outstanding and must precede enabling
this driver. The focused VM boundary run is not a substitute for Phase 3 acceptance.

## Verification

See the current checkpoint in [PROGRESS.md](PROGRESS.md). Host typechecking and 45 boundary tests pass. Focused VM run
`vm-artifacts/20260908-031021-phase-3/` restored `installed` and exited **0** on
`6ac764f`: **45/45 tests**, build/typecheck/catalog/secret checks passed. Scope is
`fs-boundary`, with `fullPhaseAcceptance:false` and `fileOperationsEnabled:false`.

## Why this is a separate stop

[write-gatekeeper/SKILL.md](../.agents/skills/write-gatekeeper/SKILL.md) says:
“There are two mandatory STOP points below — do not proceed past either without
operator approval.” Step 6 is “STOP 2 — ask the operator whether to proceed to Phase 2.”
STOP 1 approved the API; STOP 2 covers the later approval/simulation/observer work.
