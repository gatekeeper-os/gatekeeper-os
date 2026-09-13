# GatekeeperOS beta.2 — private handoff (draft, not release-ready)

The ordered rename merges and clean-main annotated tag are still pending.
Do not run the commands until the final tagged SHA has been reported. These are
drafts only; no npm write or release workflow was run during preparation.

## Matt's manual first publication under the new scope

From the main checkout (its existing local directory name is historical):

```sh
cd /home/matthew/projects/Personal/openclaw-os-agent-kit/repo-skeleton/openclaw-os
test -z "$(git status --porcelain)"
tag_sha="$(git rev-parse 'v0.1.0-beta.2^{commit}')"
git switch --detach "$tag_sha"
test "$(git rev-parse HEAD)" = "$tag_sha"
pnpm install --frozen-lockfile
pnpm build
pnpm -r publish --dry-run --access public --tag beta
npm login
pnpm -r publish --access public --tag beta
```

The tag must remain local; do not push it as part of these commands. The five
selected names must be @gatekeeper-os/shared, gatekeeper-kit, kernel,
gatekeeper-fs and cli, all version 0.1.0-beta.2. No private package may publish.

After all five new registry packages are verified, deprecate the old versions:

```sh
npm deprecate @clawkeepers/shared@0.1.0-beta.1 "Renamed to @gatekeeper-os/shared. Install @gatekeeper-os/shared@beta."
npm deprecate @clawkeepers/gatekeeper-kit@0.1.0-beta.1 "Renamed to @gatekeeper-os/gatekeeper-kit. Install @gatekeeper-os/gatekeeper-kit@beta."
npm deprecate @clawkeepers/kernel@0.1.0-beta.1 "Renamed to @gatekeeper-os/kernel. Install @gatekeeper-os/kernel@beta."
npm deprecate @clawkeepers/gatekeeper-fs@0.1.0-beta.1 "Renamed to @gatekeeper-os/gatekeeper-fs. Install @gatekeeper-os/gatekeeper-fs@beta."
npm deprecate @clawkeepers/cli@0.1.0-beta.1 "Renamed to @gatekeeper-os/cli. Install @gatekeeper-os/cli@beta."
```

## After Matt confirms publication

Verify all five exact registry identities, run npm-only fresh-VM acceptance
against @gatekeeper-os/*@0.1.0-beta.2, and regenerate the real Tier 1 registry
lockfile. Only merge that switch after green build-test/live skill sync. Neither
step runs before publication. Retain all earlier incomplete acceptance evidence.

## Intentional survivors

See [migration](../docs/migration-gatekeeperos.md). Historic PROGRESS and NOTICE
text remains, as do old identifiers in migration/deprecation instructions. This
handoff's local directory names are real existing checkout paths. Community old
registry aliases/lock/identity checks and example driver id are a temporary bridge
until the separate beta.2 switch; historic LICENSE/NOTICE/validation stays intact.
