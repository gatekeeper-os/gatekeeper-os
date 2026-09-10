# OpenClaw OS documentation

Start with the [project introduction](../README.md) for current capabilities,
limitations, development setup and acknowledgments. The repository originated
as an agent implementation kit; these documents now travel with the implementation.

| Document | Purpose |
|---|---|
| [Implementation plan](implementation-plan.md) | Architecture, capability contracts, ordered phases and acceptance criteria; future-state design is not evidence of completion |
| [Phase checklist](phase-checklist.md) | Passed, deferred and outstanding acceptance gates with evidence |
| [Phase 3 acceptance](../plans/phase-3-acceptance.md) | Kernel milestone reconciliation and retained limitations |
| [Upstream reference](upstream-reference.md) | Verified interfaces and explicit unresolved assumptions |
| [VM testing](vm-testing.md) | Disposable-machine setup, snapshots, runtime checks and evidence collection |
| [Agent operating rules](agent-operating-rules.md) | Review standards and repository invariants |
| [CLI reference](../packages/clawos-cli/README.md) | Implemented host and operator command behavior |
| [Acknowledgments and provenance](acknowledgments.md) | OpenClaw, Cloudflare OS, adaptation scope and upstream licenses |
| [Open-source release](open-source-release.md) | License rationale, beta publication checks and possible organization transfer |
| [Progress](../plans/PROGRESS.md) | Historical implementation checkpoints; later evidence supersedes earlier state |

The original plan was researched on 2026-09-06 against `openclaw@2026.9.2`,
Cloudflare OS and Cloudflare OS Starter. Runtime facts are updated with acceptance
evidence; the lockfile remains authoritative for the current upstream pin.
