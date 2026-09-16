# beta.2 messaging tool visibility — 2026-09-13

> Historical record, superseded for launch status. Its preparation commands and
> authorization holds are not current instructions and must not be replayed.
> Five packages are published at beta.5, all three repos are public, and npm-only
> run `20260916-220009-phase-3` passed. Remaining limits and the completed release
> gates are in [current release status](../README.md#release-status). Original
> failed receipts remain failed. Native approval policy follows the
> [closed advisory disposition](upstream-native-approval-logging.md), not a pending upstream change.


## Cause (reported before product edits)

The shipped messaging baseline omitted `tools.alsoAllow: ["gkos-kernel"]`.
Upstream registered the tools, then excluded them from the effective turn tool
list under the messaging profile. `Tool os_list_grants not found` means absent
from that turn's resolved tools, not necessarily failed global registration.
This omission predates the rename and affects source and npm alike.

The previous source kernel-live fixture selected `tools.profile: "full"`, whereas
npm-only preserved messaging. That uncontrolled policy difference hid the
installer defect; full profile is **not** the fix.

## Controlled VM evidence

Failed acceptance20260913-171621-phase-3 at612497c: registry5/5, cell1/1,
selector1/1, install14/14, kernel13/14; one model turn/two provider requests.
Stopped before conformance/audience/approvals. Both product plugins were healthy.

Diagnosis retained the failed disk and npm cell without snapshot reset.
Source070bc13 was archived, transferred and built unchanged. A separate cell was
created with that source CLI, pointing to source package/catalog roots. Only
diagnostic provider/workspace/sandbox fixtures were added. The same deterministic
no-grant turn attempted os_list_grants:

| Layout / effective policy | OS tools | Result | Turns / requests |
| --- | --- | --- | --- |
| Retained beta.2 npm / messaging | both absent | Tool os_list_grants not found | 1 / 2 |
| Source070bc13 / same messaging ceiling | both absent | Tool os_list_grants not found | 1 / 2 |
| Same source cell / full-profile control | both present | successful list | 1 / 2 |

All three no-grant turns exposed no gk tools. Both messaging lists were identical:
ask_user, conversations_list/send/turn, message, session_status, sessions,
sessions_history/list/search/send/spawn/yield, subagents. Native denials stayed
group:runtime, group:fs, group:automation, browser; exec stayed deny. No external
model provider or resource grant was used in diagnosis.

Evidence outside git in project-kit `beta2-tool-diagnosis-20260913/`:
comparison.json, retained-guest.json, packed/pre-rename manifest snapshots,
source070bc13 archive/build logs and host cleanup receipt. VM gracefully off,
keeper closed, original8MiB limits restored, original snapshot tables unchanged.

## Requested registration evidence

- Retained log: `2026-09-13T17:20:01.098+00:00 [gateway] http server listening
  (4 plugins: gkos-gatekeeper-fs, gkos-kernel, gkos-kernel-monitor, memory-core;
  1.4s)`. No tool-contract, trusted-policy or catalog warning. The unrelated
  multi-agent heartbeat-owner warning was retained.
- Packed cell kernel manifest equals070bc13 source in every field. Compared with
  the pre-rename kernel manifest at a64ef47's parent, contracts.tools is unchanged;
  plugin/trusted-policy IDs were consistently renamed to gkos-kernel and
  gkos-capability-policy. Branding/version also changed.
- Kernel contracts.tools: os_request_access, os_list_grants, gk_fs_dir_list,
  gk_fs_file_read, gk_fs_file_write, gk_mcp_demo_read_note,
  gk_mcp_demo_append_note. The fs plugin declares no agent tools: the kernel owns
  their registration.
- `<state>/os/gatekeepers.json` exists: version1, one gkos-gatekeeper-fs/fs entry
  rooted in the cell-local content-addressed bundle, with the three fs tool
  schemas and a grantable dir resource (`file:///:path+`, low-stakes observer).
  Full structural catalog retained in retained-guest.json.
- Packed dist9809–9837 allows full/discovery/tool-discovery registration modes;
  registers os_request_access/list_grants unconditionally at9822/9829, then
  iterates catalog.tools at9486–9487. Missing catalog could suppress gk tools,
  not the two OS tools.
- Pinned upstream2026.9.2 loader-DPiOPJjR.js:3910 rejects undeclared tools by
  diagnostic and omission: `plugin must declare contracts.tools before
  registering agent tools` or `plugin must declare contracts.tools for: <names>`.
  Trusted policy declaration/enablement checks at2308/2312 likewise fail closed.
  Neither rejection describes this manifest.
- tool-catalog-79RBtNnN.js:462 defines messaging without kernel tools;
  tool-policy-pipeline-BwOD5Xc9.js:32,140 filters by profile;
  agent-core-fAQEcq-h.js:1063 emits the exact not-found error. Kernel toolsAllow
  is a later intersection, already documented in docs/upstream-reference.md.

## Correction and regression contract

Messaging additively admits only gkos-kernel. Native denials, grant and owner
enforcement remain. Runtime deletes the additive field during fragment merging
and retains its explicit allowlist (nonempty allow/alsoAllow together is invalid).

The unit regression checks merged messaging admission/denials and runtime ceiling.
The packed gate reads baseline and catalog from the **installed CLI tarball**,
performs two deterministic turns and requires both OS tools/no gk tools without
a grant, all three fs tools with an operator-created owner-only grant, successful
list-tool results and native denials. It never borrows checkout config or switches
to full profile.

Reproduce with real registry artifacts through that same gate:

```sh
node scripts/check-registry-packed-load.mjs 0.1.0-beta.2 /tmp/gkos-beta2-red-evidence
```

Real beta.2 failed exit1 at `Packed model gate: no-grant-os-tools`, after one model
turn/two provider requests. All five archive identities and SHA512 integrities
verified against npm; structural verdict and receipt retained in beta2-red/.

Final rerun with the completed gate reproduced beta.2 failure (1turn/2requests).
Fixed source tarballs passed exit0:2turns/4requests, both OS tools without a grant,
all3fs tools with an owner-only grant, successful list results and native denials.
Initial fixed attempts exposed a test fixture placed inside protected Gateway
state; the product correctly refused its grant. Only that fixture moved outside
state; failed attempts and the final proof are retained. All600unit tests passed.

No version bump, tag, publication, release workflow, npm-only acceptance rerun,
community merge or upstream post is part of this PR. Existing-cell upgrades remain
subject to ownership-aware reconciliation; no installed beta.2 cell was patched.
