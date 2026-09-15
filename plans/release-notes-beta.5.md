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
