# Acknowledgments and provenance

OpenClaw OS is an independent integration project. It owes both its execution
foundation and significant architectural ideas to existing open-source work.
This page identifies that work rather than presenting the design as wholly new.

## OpenClaw — execution foundation

- Repository: <https://github.com/openclaw/openclaw>
- Pinned release: [v2026.9.2](https://github.com/openclaw/openclaw/tree/v2026.9.2),
  as recorded in `clawos.lock.json`.
- License: [MIT, copyright 2026 OpenClaw Foundation](https://github.com/openclaw/openclaw/blob/v2026.9.2/LICENSE).
  OpenClaw also maintains its own `THIRD_PARTY_NOTICES.md`.

The upstream Gateway, agents, channels and plugin SDK provide the runtime.
OpenClaw OS installs upstream separately and integrates through public interfaces;
it does not fork, patch or vendor the runtime. Its MIT license does not replace
the notices or licenses in OpenClaw's own distribution.

## Cloudflare OS — architecture and adapted material

- Repository: <https://github.com/cloudflare/cloudflare-os>
- License: [Apache License 2.0](https://github.com/cloudflare/cloudflare-os/blob/44f7950acb543cef021991a7969ff82f32ec48ed/LICENSE).
- License/reference verification on 2026-09-09: commit
  `44f7950acb543cef021991a7969ff82f32ec48ed`.

Cloudflare OS's contributions to this design include resource introduction,
capability-oriented gatekeepers, deferred action approval, simulated effects,
observer admission, and a small kernel held to a higher review standard.

**Adaptation notice:** OpenClaw OS contributors changed the referenced contracts
and guidance for a self-hosted, single-process OpenClaw plugin and tool-calling
runtime rather than Cloudflare Workers, Durable Objects and gadget APIs. These
are adaptations, not an unchanged distribution of Cloudflare OS.

| Local material | Upstream origin or influence | Main adaptation |
|---|---|---|
| `docs/implementation-plan.md` | Cloudflare OS `README.md`, gatekeeper contracts and architecture documents | Maps introductions, drivers, approvals and observers to OpenClaw cells and tools; includes attributed quotations |
| `packages/clawos-shared/src/gatekeeper.ts` | `packages/workshop-shared/src/gatekeeper.ts` | Process-local sessions, opaque grants, tool results and kernel-owned approval interfaces |
| `docs/agent-operating-rules.md`, `AGENTS.md`, `REVIEW.md` | Cloudflare OS `AGENTS.md`, `REVIEW.md` | Local SDK, upstream-isolation, VM and phase conventions added; kernel and secrecy guidance retained |
| `.agents/skills/write-gatekeeper/` | Cloudflare OS gatekeeper-authoring guidance and skeleton | Tool-calling driver workflow, local kit and two review checkpoints |
| `packages/gatekeeper-kit/`, gatekeeper design | Cloudflare OS gatekeeper responsibilities and lifecycle model | Local encrypted stores, action journals, overlays and runtime lifecycle |

This is a provenance map, not a claim that all these files are verbatim copies or
that a complete line-by-line provenance audit has finished. The original kit
referenced upstream `main` on 2026-09-06 without recording exact source commits.
The verification commit above records the later license check; it must not be
misrepresented as the original source revision. A full distribution review
remains a beta publication check.

## Cloudflare OS Starter — customization and upgrades

- Repository: <https://github.com/cloudflare/cloudflare-os-starter>
- License: [Apache License 2.0](https://github.com/cloudflare/cloudflare-os-starter/blob/3d211477ad009e13a98d863d843e5c12a29ad02b/LICENSE).
- License/reference verification on 2026-09-09: commit
  `3d211477ad009e13a98d863d843e5c12a29ad02b`.

The starter's wrapper-owned customization, shared dependency catalog, explicit
upstream pin and deliberate upgrade/rollback discipline informed our deployment
plan. We adapt those ideas to a self-hosted daemon. The complete OpenClaw OS update
pipeline is still Phase 7 work; this credit is not a completion claim.

## License preservation

Original project contributions use MIT. Retained Apache-2.0 material continues
to be subject to Apache-2.0; the full license accompanies [NOTICE](../NOTICE).
The upstream Cloudflare repository trees checked above have no root `NOTICE`
file. Recheck notices and per-file headers for the exact material included in a
release; absence of a root notice does not remove the other license obligations.

Each workspace package includes project `LICENSE` and `NOTICE` files. The package
license checker requires them to match the root texts and inspects actual packed
artifacts when invoked with `--pack`. Bundled TypeBox code carries its own license
in generated `THIRD-PARTY-NOTICES`; this does not replace a complete dependency
inventory for release.

Project names are used to identify origin and compatibility. No endorsement,
affiliation, trademark ownership or third-party warranty is claimed.
