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
