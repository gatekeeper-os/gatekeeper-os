# First beta release handoff — 2026-09-12

**Preparation only. No package publication, tag push, visibility change or upstream post.**

## Approved gate corrections

- Ordinary `definePluginEntry` plugins have no generated authoring metadata. The
  withdrawn `plugins validate --entry` gate is replaced by actual packed installs
  in isolated state/config, a loopback Gateway, clean enabled/loaded plugin list
  and authenticated live kernel RPC. All ten packed-license checks and the
  existing manifest inspector remain mandatory. Shared/kit/CLI are not plugins;
  their actual npm-installed archives pass import/bin smoke checks. Unpublished
  scope dependencies resolve through an ephemeral read-only registry fixture,
  never workspace-package links or registry writes.
- Baseline `00-baseline.json5` is unchanged. Messaging remains default. Explicit
  runtime cells copy one coupled global fs/exec + all-turn Docker sandbox fragment
  (`05-policy-runtime.json5`), omitting the messaging `20-sandbox.json5`.
  Config apply rejects sandbox weakening. Coder requires the runtime ceiling;
  blueprint apply checks upstream config and never widens an existing cell.
  Exec uses sandbox host and the least non-deny mode `allowlist`; Docker, not a
  command allowlist inside the container, is the execution boundary.
- Researcher is web-tools-only. Assistant/ops deny exec and fs. HTTP is planned
  beyond beta, not an expected provisioned dependency.
- Audit accepts no critical findings. Exact conditional warning codes and one-line
  rationales are in `docs/blueprints.md`. Probe authentication uses the cell's
  canonical `CLAWOS_GATEWAY_TOKEN` SecretRef provider, not a competing override.
  Failed probes, other warnings and suppressed findings fail.
- MCP stays a private read-only demo. Generic actions remain
  `awaitDecision:true` / `implementsRevert:false`; `append_note` is unregistered
  pending upstream logging acceptance. Synthetic deferred evidence is not native
  action acceptance.

## Release set and evidence

Exactly five packages at `0.1.0-beta.1`: `@clawkeepers/shared`,
`@clawkeepers/gatekeeper-kit`, `@clawkeepers/kernel`,
`@clawkeepers/gatekeeper-fs`, and `@clawkeepers/cli`. All others remain private.
The scope-only migration is `c2b9de4`; plugin IDs and CLI binary are unchanged.
PRs #9 and #11–13 were integrated previously. The requested final merge order is
#15 → #16 → #14 → gatekeepers #6 → .github #1; #15 is merged as `2a48d4d`.

`plans/PROGRESS.md` is the append-only verification/merge ledger, including failed
runs and their causes. The old release blockers are superseded only by the
corrected gates' actual passing receipts, not by reclassifying failed evidence.
Remaining full connected-driver/native-logging and npm-only acceptance limits
are not waived by this preparation or by the beta tag.

## Local tag boundary

After green candidate CI, approved merges and the integrated Phase 3 regression,
run from clean main:

```sh
pnpm exec tsx scripts/release.ts --version 0.1.0-beta.1 \
  --notes-file plans/release-notes.md --tag
git rev-parse 'v0.1.0-beta.1^{commit}'
```

The release script checks and creates only a local tag. The final response reports
its exact SHA. Do not publish unless that tag exists at the reported SHA.
**Do not push the tag before Matt's manual first publish:** `release.yml` triggers
on `v*` tags. It is for subsequent trusted-publisher releases, not initial package
creation; it also rejects private source.

## Matt's manual first publish

Use the clean local **main** checkout at precisely the reported local tag SHA:

```sh
test -z "$(git status --porcelain)"
test "$(git branch --show-current)" = main
test "$(git rev-parse HEAD)" = "$(git rev-parse 'v0.1.0-beta.1^{commit}')"
pnpm install --frozen-lockfile
pnpm build
pnpm -r publish --dry-run --access public --tag beta
npm login
pnpm -r publish --access public --tag beta
```

Only Matt performs npm login/2FA and publication. Neither the agent nor the
workflow stores a long-lived npm token.

## Post-publish checklist — Matt/later authorized work

1. Push the local tag: `git push origin v0.1.0-beta.1`.
2. Make `.github`, `openclaw-os` and `gatekeepers` public together.
3. Configure each npm package's trusted publisher for `clawkeeper/openclaw-os`
   and `release.yml` (OIDC, subsequent releases use `--provenance`).
4. Configure `build-test` as an actual required branch-protection check. The
   current private Free-org entitlement rejected this; CI prerequisites alone
   are not merge protection.
5. Gatekeepers Tier 1: npm kit/shared builds and live core-skill sync; replace
   Tier 0's explicitly documented pinned-snapshot integrity check.
6. Publish catalog/discovery through ClawHub and switch install/docs to npm.
7. Fresh-VM verification using npm only, with no repo clone, through the Phase 3
   acceptance path. Record evidence before creating the `phase-9` tag.
