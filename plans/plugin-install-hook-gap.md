# Plugin-specific install-hook evidence gap — 2026-09-09

The original checklist requires a real plugin install denied by the secondary
kernel hook. The previously accepted 17-check fixture installs a **skill**, so
its success cannot close this gate. The checkbox is reopened.

## Actual attempts (all via the VM harness; all exit 1)

| Artifact | Request path | Observed result |
|---|---|---|
| `20260909-215430-phase-3` | Official Slack selector | Failed before any policy event; no hook evidence |
| `20260909-215615-phase-3` | Official ACPX selector | Sanitized `unknownCatalog` category, no policy events |
| `20260909-215804-phase-3` | Actual `plugins.list` official Firecrawl entry | Compatibility rejection before policy; default release does not match pinned upstream |
| `20260909-215951-phase-3` | ClawHub `@openclaw/firecrawl-plugin`, exact `2026.9.2` | Primary denial passes; primary allow then succeeds without secondary hook callbacks |

Last run observed a healthy kernel, empty kernel allowlist, real primary-policy
block with unchanged config, and then two primary allow events with **zero**
before/after monitor events. The Gateway install request returned success.
Read-only post-run diagnostics confirmed a downloaded extension package whose
name/version exactly match the requested artifact; these diagnostics are labeled
`diagnosticAfterRun:true`, not retroactive acceptance assertions. The config's
legacy JSON install-record lookup did not find a record; no upstream SQLite was
read to supplement it. The VM was shut down without snapshot changes.

## Interpretation and correction

`docs/upstream-reference.md:203` already states that trusted/bundled paths may
skip `before_install`; `security.installPolicy` is the mandatory primary boundary.
This official source is therefore an unsuitable positive fixture for secondary
plugin-hook acceptance. It is **not evidence of an upstream defect** or failure
of the primary policy, which denied the same request until the fixture explicitly
allowed it. No production rule was weakened and no runtime was repinned.

The initial live interpretation that this contradicted upstream was corrected
once the existing trusted-path exception was reconciled. The source invariant
still prohibits patching upstream or manufacturing a callback.

## What remains

Select/provision a compatible nonofficial test plugin available through the
supported Gateway install path, preserve primary denial/allow separation, then
require actual typed plugin hook observations, terminal kernel denial and no
installation/config/grant side effects. Retain the current official control as
failed diagnostic evidence, not as a release gate pass. Do not resume Phase 4 or
tag Phase 3 based on skill-hook success or aggregate suite counts.
