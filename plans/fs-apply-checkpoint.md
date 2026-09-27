# Filesystem apply — VM checkpoint receipt

Contract: [Amendment 2026-09-27](fs-contract.md#amendment-2026-09-27--cooperative-writer-adversary-model-for-apply) (cooperative writers).
Implementation: #32 (`6cd3875`). Harness: `test/phase-3-fs-enforcement.sh` + `test/scripts/fs-apply-checkpoint.ts` at `bac5b26`.

| Field | Value |
| --- | --- |
| Command | `GKOS_VM_DRIVER=libvirt GKOS_VM_NAME=clawos-test GKOS_VM_STATE_DIR=<phase-0-bootstrap>/scripts/vm/.state scripts/vm/test.sh phase-3 installed fs-enforcement` |
| Run id | **`20260927-051331-phase-3`** (snapshot `installed`, mode `fs-enforcement`, exit 0) |
| Guest Node | v22.22.3 (official archive, SHA256 checked, test-only prefix) |
| Guest kernel / filesystem | 6.8.0-138-generic, ext4 (Ubuntu 24.04) |
| Publish mode | **`rename`**: coreutils 9.4 and no util-linux `exch`, so the guest has no `RENAME_EXCHANGE` tool |
| fs package tests on guest | 244 passed, 1 skipped (unprivileged user namespaces are restricted on Ubuntu 24.04; replaced by the root bind mount below) |

Scenario evidence (`fs-apply-scenarios.json`, sha256 `c39187b9c84032cfe98720f79df63add6c0590c92b1662e2f5412a010024bda5`):

```json
{"publishMode":"rename","realWrite":{"replace":"rename","create":"link","receipts":true},"refusal":{"staleBaseline":"refused","symlinkTarget":"refused","mutated":false},"ce2-publishing":{"detected":true,"externalKept":true,"oursKept":true,"phase":"uncertain","blocked":true},"ce2-rechecked":{"detected":false,"externalKept":false,"oursKept":true,"phase":"applied","blocked":false},"ce2":{"beforeRecheck":"detected, both kept, resource blocked","window":"lost (documented rename residual)"},"revert":{"restored":true,"interveningEdit":"refused"}}
```

Mount interposition with a real root-created bind mount inside the grant: `{"mountInterposition":"refused"}`.

What this shows on the guest: an approved replace and create land, with receipts. A stale baseline and a symlink
target are refused, with no mutation. CE-2 before the final check is detected: both versions are kept and the
resource is blocked. Revert restores the preimage and refuses to overwrite an intervening edit. A bind mount
inside the grant is refused. In `rename` mode a CE-2 edit that lands between the final check and the rename
is lost. This is the residual window documented in the amendment, recorded here, not claimed safe. On hosts
with `exch`/`mv --exchange`, the same window is detected with both versions kept (unit and packed-gate
evidence on Linux 6.18.53, NixOS, util-linux 2.42.3).

Packed model-turn gate (`node scripts/check-package-licenses.mjs --validate`, local, pinned OpenClaw 2026.9.2):
10 model turns. The no-grant, owner-only, independent-gatekeeper backstop and native denials are unchanged. An
approved create lands with a matching receipt (`link`); an approved replace lands with a matching receipt
(`exchange` on that host); a rejected write never lands; an `uncertain` outcome (read-only parent after the
intent is journaled) leaves the kernel action `failed` and denies the next call on that resource.

Artifacts (not committed): `~/projects/Personal/openclaw-os-agent-kit/fs-apply-checkpoint-20260927/20260927-051331-phase-3/`.
