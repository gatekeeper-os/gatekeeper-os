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
