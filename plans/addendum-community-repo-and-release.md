# Plan addendum — community repo and npm release

> Historical record, superseded for launch status. Its preparation commands and
> authorization holds are not current instructions and must not be replayed.
> Five packages are published at beta.5, all three repos are public, and npm-only
> run `20260916-220009-phase-3` passed. Remaining limits and the completed release
> gates are in [current release status](../README.md#release-status). Original
> failed receipts remain failed. Native approval policy follows the
> [closed advisory disposition](upstream-native-approval-logging.md), not a pending upstream change.


**Date:** 2026-09-12 · **Applies to:** `docs/implementation-plan.md` §8 (repository layout) and §9 Phase 9 · **Status:** decided; to be merged into the repo's plan by the agent in the same commit that starts the work.

**Rename decision 2026-09-12:** GatekeeperOS, npm `@gatekeeper-os`, GitHub
`gatekeeper-os/gatekeeper-os`. This supersedes prior naming decisions. The original
beta.1 procedure below is historical; beta.2 is prepared privately without publication,
visibility changes or tag pushing. See `docs/migration-gatekeeperos.md`.

The plan predates the `gatekeeper-os` org. This addendum adds what the org changed and turns Phase 9's two paragraphs into deliverables.

## A. Repository layout (amends §8)

Two public repos under `gatekeeper-os`, plus `.github` for the org profile.

- **`gatekeeper-os/gatekeeper-os`** (core, kernel review bar): everything in §8 as written, including the four **reference drivers** `gkos-gatekeeper-fs`, `gkos-gatekeeper-github`, `gkos-gatekeeper-mcp`, `gatekeeper-http` in `packages/`. Reference drivers never move out; they need atomic kernel+driver changes, the VM harness and the conformance runner.
- **`gatekeeper-os/gatekeepers`** (community, normal review bar): one folder per vendor at the repo root, built against the **published** `@gatekeeper-os/gatekeeper-kit` and `@gatekeeper-os/shared`. It exists so contributors don't need the core repo's bar or its VM harness. It has two tiers of readiness:
  - **Tier 0 — hub (before any package is published; do now, docs only):** README states that the four reference drivers live in core and that community drivers land here once the kit is on npm; `template/` holds the skeleton as real files (`openclaw.plugin.json`, `package.json`, `deploy-inputs.json`, `README.md`, `src/{index,vendor,account,tools,resources,simulate,api}.ts` stubs that type-check against the kit); CONTRIBUTING and the five `gatekeeper-wanted` issues carry a one-line "tool-surface PRs welcome now; builds here start once the kit is published" note; `.agents/skills/write-gatekeeper` matches core's copy (core is the source of truth; a CI check diffs them).
  - **Tier 1 — buildable (after Phase 9 publishes):** pnpm workspace with each vendor folder a package depending on published `@gatekeeper-os/*` versions (no `workspace:` links to core); `catalog.json` at the root listing each driver's npm spec, required secrets and status (`draft`/`alpha`/`stable`) — the same shape as core's `config/gatekeepers.json` so `gkos gatekeeper add <vendor>` can read either; CI on hosted runners: install pinned upstream + published kernel/kit, build every driver, run its kit-harness tests, run `defineGatekeeper()` rule checks and the secret grep, then the hosted compatibility smoke (real Gateway, no VM) from core's `scripts/ci/live-smoke.ts` pattern. VM acceptance stays in core; a community driver reaching `stable` needs one VM run recorded in core's evidence tree.
- **`.github`**: profile README, SECURITY, CONTRIBUTING, CoC, templates (seeded).

## B. Phase 9 — Hardening and release (expands §9)

Order matters: publish nothing until `main` carries the prompt-narrowing fix from PR #13 (native tools were being stripped) and PR #9 (repository URLs).

1. **Integrate** PRs #11, #12, #13 onto `main` with one combined regression (kernel edits overlap); rerun the Phase 3 kernel-live and conformance suites on the integrated head.
2. **Hardening** (as in the plan): threat-model re-review against `REVIEW.md` after integration; fuzz `before_tool_call` param rewriting; secret-leak grep as a required CI gate; `openclaw security audit --deep` clean on every blueprint; fix the missing ESLint 9 flat config so `pnpm lint` runs.
3. **Package metadata**, per publishable package — `@gatekeeper-os/shared`, `@gatekeeper-os/gatekeeper-kit`, `@gatekeeper-os/kernel`, `@gatekeeper-os/gatekeeper-fs`, `@gatekeeper-os/cli` in the first release; `@gatekeeper-os/gatekeeper-github` and `@gatekeeper-os/gatekeeper-mcp` only after their acceptance: `private:false`, `publishConfig.access:"public"`, `files` limited to `dist/`, manifests, `LICENSE`, `NOTICE`, `README`; `exports`/`main`/`types` pointing at `dist`; `openclaw.extensions` paths valid inside the packed tarball; `peerDependencies.openclaw` byte-identical to the catalog range (`pnpm check:catalog`); `repository.url` = gatekeeper-os. `pnpm pack` every package and validate with `openclaw plugins validate --entry` on the *packed* output, not the workspace (the packed-license check already runs; extend it to entry validation).
4. **Rename to GatekeeperOS and scope `@gatekeeper-os`** in one commit across the workspace: package names, `catalog:` entries, every import, `openclaw.plugin.json` ids/contracts where the scope appears, `config/gatekeepers.json`, `install.allowSources` (`npm:@gatekeeper-os/*`, `clawhub:@gatekeeper-os/*`), installer, docs, org README. Plugin ids use `gkos-*`, CLI `gkos`, and owned environment variables `GKOS_*`; upstream interfaces remain unchanged. Full build/test/catalog/secrets after the rename.
5. **First publish** (Matt, once, from a clean checkout of the tagged commit): `npm login` with 2FA, then `pnpm -r publish --access public --tag beta` (pnpm rewrites `workspace:` and `catalog:` specs to concrete versions on publish). Version `0.1.0-beta.1`, git tag `v0.1.0-beta.1`. Dry-run first with `pnpm -r publish --dry-run`. The agent prepares everything up to this step and verifies the dry run; it never holds the npm credential.
6. **Subsequent releases via CI with trusted publishing.** After the packages exist, configure each on npmjs.com with a trusted publisher pointing at `gatekeeper-os/gatekeeper-os` and a `release.yml` workflow; the workflow publishes with `--provenance` on `v*` tags using OIDC, no long-lived token. `scripts/release.ts` bumps versions, updates `gkos.lock.json` plugin versions, writes the changelog entry, and tags.
7. **Installer and docs switch** from source install to `openclaw plugins install npm:@gatekeeper-os/kernel@<ver> --pin --accept-capabilities` (with `--force` until ClawHub listing, per the plan's §7.5 note); org README "Try it" section updated; `gkos install` uses the lockfile pin.
8. **ClawHub**: `clawhub package publish` for kernel and reference drivers so `clawhub:@gatekeeper-os/*` installs work; `allowSources` lists both prefixes.
9. **Community repo Tier 1** (section A) lands immediately after step 6.
10. **Release verification**: fresh VM, install from npm only (no repo clone), run the Phase 3 acceptance path; record in `plans/PROGRESS.md`; tag `phase-9`.

## C. Corrections to earlier instructions

- The overnight instruction to build `gkos-gatekeeper-mcp` under `gatekeepers/mcp/` is withdrawn; `packages/gkos-gatekeeper-mcp` in core is correct.
- `plans/agent-kickoff-prompt.md` in this project should not reference the gatekeepers repo as a build target until Tier 1 exists.
