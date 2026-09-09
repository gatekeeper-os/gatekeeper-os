# Telegram validation deferred — 2026-09-09

Matt explicitly requested committing the channel-ingress changes and skipping
Telegram validation for now. Real Telegram transport validation is **deferred,
not passed**. No Telegram test or credential setup is required for this checkpoint.

The implementation and focused ingress fixture are saved in `7a69f93`
(`feat(kernel): complete phase 3 ingress acceptance`). The previously verified
focused VM run `20260909-110033-phase-3` passed 29/29 checks with five actual
model turns, alongside 38 kernel and 114 CLI tests. It demonstrates synthetic
public-SDK ingress, first-request owner tools and notice, forged identity/scopes
rejection, and subsequent nonowner tool narrowing—not real Telegram transport.
No tests were rerun for this documentation-only checkpoint.

This deferral does not waive other Phase 3 or beta acceptance requirements,
claim a release, or change the separately tracked Slack transport canary.
Before claiming Telegram support is validated, run a disposable real-transport
canary through the supported VM harness and record first-turn owner access,
nonowner/group isolation, exact artifacts, and final verdict. Until then,
Telegram transport remains explicitly unverified.
