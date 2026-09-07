# OpenClaw OS — Agent Kit

This folder is everything an autonomous coding agent needs to build OpenClaw OS: an operating-system layer over upstream OpenClaw (unmodified), modeled on Cloudflare OS and its gatekeeper concept. Hand the agent `KICKOFF_PROMPT.md` (one level up) and the `repo-skeleton/openclaw-os/` directory (which contains a copy of this `docs/` folder plus the generated scaffold); nothing else is required to start.

| File | What it is | When the agent reads it |
|---|---|---|
| `../KICKOFF_PROMPT.md` | The prompt that starts the engagement: mission, invariants, working method, VM-testing rule, reporting format, definition of done. | Given to the agent as its first message. |
| `agent-operating-rules.md` | Binding rules: the two invariants, capability and secrecy invariants, the kernel review bar, review priority, git and reporting conventions, when to stop. Becomes the repo's `AGENTS.md` and `REVIEW.md`. | Second, before any code. |
| `implementation-plan.md` | The full plan (v1.0): principles, verified foundations, architecture, gatekeeper contracts, kernel design, config/pin/update strategy, security model, repo layout, ten phases with acceptance criteria, installation, operations, open questions, appendices. | Third; kept open throughout. |
| `upstream-reference.md` | Verified OpenClaw and Cloudflare OS facts — CLI, paths, config keys, plugin SDK, hook signatures — with the remaining UNVERIFIED items flagged for Phase 0. | Fourth; consulted whenever touching upstream surfaces. |
| `vm-testing.md` | How to provision, snapshot, reset, and drive the Ubuntu 24.04 test VM; per-phase test scripts; test credentials; what "tested" means. | Fifth; before Phase 0's first VM run. |
| `phase-checklist.md` | Every acceptance criterion as a checkbox with an evidence slot; filled in as phases complete. | Continuously. |

The repo skeleton (`../repo-skeleton/openclaw-os/`, index in `../repo-skeleton/README.md`) already places these docs at `docs/` and derives `AGENTS.md`/`REVIEW.md` from `agent-operating-rules.md`. Keep them version-controlled alongside the code and update them in the same commits that change behavior.

Provenance: the plan and reference were researched on 2026-09-06 against `openclaw@2026.9.2` and the `cloudflare/cloudflare-os` and `cloudflare-os-starter` repositories at `main`. Upstream moves quickly; the first thing the agent does (Phase 0, spike S-1) is confirm the pinned version still installs and that the flagged UNVERIFIED items resolve as expected.
