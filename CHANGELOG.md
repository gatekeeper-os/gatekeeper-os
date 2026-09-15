# Changelog

## 0.1.0-beta.5

beta.1–beta.4 cannot expose tools of gatekeepers the kernel manifest does not enumerate; fixed by per-gatekeeper tool ownership

The gatekeeper kit now registers exact manifest-declared tools under each
owning gatekeeper's plugin identity and delegates execution to the kernel runtime.
Catalog reconciliation admits those plugin IDs into messaging-cell tool policy;
adding a catalog entry does not grant resource access. The trusted-policy backstop
is verified independently of both tool registrant and wrapper delegation on
unmodified OpenClaw 2026.9.2. Explicit runtime allowlists, native denials and
sandbox policy are unchanged.

Also fixes Node 22 SQLite TEXT truncation of NUL-separated instance identities,
which caused deferred approval decisions to fail closed while Node 24 local
checks passed. Full key bytes are decoded on read; stored schema-1 identities,
lockdown, authority checks and uncertain-action semantics remain unchanged.

Five release packages and all internal dependency pins move to 0.1.0-beta.5.
Packed validation includes an independently owned gatekeeper absent from the
kernel manifest, no-grant backstop checks with an unsafe callback positive control,
and five model turns covering no-grant visibility, filesystem grants, synthetic
approval apply/reject effects and audit, and revocation with native denials intact.

This is prepublication evidence, not npm-only beta.5 acceptance. Beta.4's failed
npm-only runs remain failed. Real filesystem writes remain simulate-only; the
successful approval effects are synthetic. Real connected-provider/channel
acceptance is not established by these tests. The documented in-process trust
boundary and upstream native-approval logging limitation remain; synchronous
approval remains disabled by default. See docs/threat-model.md for unchanged limits.

## 0.1.0-beta.4

republish; identical to beta.3, works around a registry indexing failure for @gatekeeper-os/kernel@0.1.0-beta.3

No product code or policy changes. The five release versions, exact internal pins,
plugin version metadata and release lock are updated to 0.1.0-beta.4.
The beta.3 messaging-policy correction and native denials are unchanged.
The packed model-turn gate covers the shipped messaging baseline; prior Phase 3
kernel-live source evidence ran under the full profile. npm-only end-to-end
acceptance remains pending and must not run while the kernel listing is inconsistent.

Contingency only: if kernel beta.3 registry listings recover before beta.4 is
published, discard the never-pushed beta.4 tag and proceed with beta.3 acceptance.
Do not publish this contingency merely because its preparation gates pass.

## 0.1.0-beta.3

Messaging cells did not expose the kernel's tools to the agent (os_* and gk_*); affects 0.1.0-beta.1 and 0.1.0-beta.2. Fixed by admitting only gkos-kernel in the messaging policy; native denials unchanged.

The Phase 3 kernel-live evidence ran under the full profile, not the shipped
messaging baseline. It did not establish messaging-baseline end-to-end acceptance.
The packed model-turn gate now covers the shipped baseline from the CLI tarball:
os_list_grants and os_request_access are present with no grant, and all three
gk_fs_* tools are present after an owner-only grant. Native denials are asserted.
The same gate fails on the real beta.2 registry tarballs and passes on the fix.

All five release packages and their exact internal pins are 0.1.0-beta.3.
No other product behavior changes. Real filesystem writes remain disabled.

Private preparation only. npm-only beta.2 verified five registry identities,
cell creation, selector and 14/14 install-policy checks, then stopped in kernel-live
with `Tool os_list_grants not found` (run 20260913-171621-phase-3). Conformance,
owner-only audience and approvals were not reached. All failed runs remain on record.
Beta.3 npm-only end-to-end acceptance is pending publication; source-profile and
packed gate evidence are not substitutes for that VM run. Real Telegram and Slack
acceptance remain unproven. No publication, deprecation, visibility change, tag push,
trusted publisher setup, release-workflow rerun, phase tag or upstream post.

## 0.1.0-beta.2

rename to GatekeeperOS; no functional change

- GitHub: gatekeeper-os/gatekeeper-os, gatekeeper-os/gatekeepers, gatekeeper-os/.github.
- npm: @gatekeeper-os/{shared,gatekeeper-kit,kernel,gatekeeper-fs,cli}@0.1.0-beta.2.
- Standalone CLI gkos; owned environment prefix GKOS_; plugin ids gkos-kernel and gkos-gatekeeper-*.
- gk_* tools, os.* RPC methods, openclaw os, grant handles and stateDir/os layout unchanged.
- Independent-project disclaimer added; Cloudflare OS attribution and NOTICE retained.

No new functional acceptance is claimed. Real filesystem writes stay disabled;
real messaging and all previously documented unproven paths remain unproven.
The beta.1 npm-only run stopped on harness config validation after 14/14 install
policy checks, before kernel/audience/approval stages (0 model turns). Beta.2
npm-only VM acceptance and the community registry switch follow Matt's publication.

Private preparation only: no publication, visibility flip, tag push, trusted
publisher setup, release-workflow rerun, phase tag, or upstream post.

## 0.1.0-beta.1

Initial beta candidate for the capability kernel, shared contracts, gatekeeper kit,
filesystem reference driver, and CLI. First-release package set only; GitHub/MCP
remain unpublished pending acceptance. Release gates and known upstream logging
limitations are recorded in plans/PROGRESS.md. This entry does not claim a publish.
