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

The packed checks above were recorded before publication. The subsequent npm-only
beta.5 run `20260916-220009-phase-3` passed on Node22.22.3 / OpenClaw2026.9.2:
registry5/5, actual cell and selector, install-policy14/14, kernel-live114/114,
selected conformance38/38, owner-only audience72/72 and independent approval30/30
(25 local model turns /39 requests). Core PR24 and community PR9 merged after
green build-test; the community Tier1 lock uses the real beta.5 registry artifacts.
Beta.4's failed npm-only runs remain failed. Real filesystem writes remain simulate-only; the
successful approval effects are synthetic. Real connected-provider/channel
acceptance is not established by these tests. The documented in-process trust
boundary remains. GHSA-22jj-m53c-524m was closed by maintainers on 2026-09-12
as requiring no upstream change: denied tools do not execute and logs/transcripts
are operator-owned. Synchronous approval remains disabled by default as
GatekeeperOS's own log-hygiene choice, not pending upstream. See
[threat model](../docs/threat-model.md) for the full disposition and limits.
