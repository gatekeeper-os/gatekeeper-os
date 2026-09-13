# GatekeeperOS beta.3 — private publication handoff

Preparation does not publish, deprecate or push the local tag. Matt runs the
following only after verifying the reported tag SHA. The process-only git-check
override permits pnpm publication from detached HEAD; no repository config changes.

## Manual publication from the tag SHA

```sh
cd /home/matthew/projects/Personal/openclaw-os-agent-kit/repo-skeleton/openclaw-os
test -z "$(git status --porcelain)"
tag_sha="$(git rev-parse 'v0.1.0-beta.3^{commit}')"
git switch --detach "$tag_sha"
test "$(git rev-parse HEAD)" = "$tag_sha"
pnpm install --frozen-lockfile
pnpm build
npm_config_git_checks=false pnpm -r publish --dry-run --access public --tag beta
npm login
npm_config_git_checks=false pnpm -r publish --access public --tag beta
```

Verify all five registry identities at 0.1.0-beta.3 and their beta dist-tags
before deprecating beta.2. The dry-run must select exactly shared, gatekeeper-kit,
kernel, gatekeeper-fs and cli under @gatekeeper-os, with no private packages.

```sh
npm deprecate @gatekeeper-os/shared@0.1.0-beta.2 "Messaging cells did not expose kernel tools to the agent. Install @gatekeeper-os/shared@beta."
npm deprecate @gatekeeper-os/gatekeeper-kit@0.1.0-beta.2 "Messaging cells did not expose kernel tools to the agent. Install @gatekeeper-os/gatekeeper-kit@beta."
npm deprecate @gatekeeper-os/kernel@0.1.0-beta.2 "Messaging cells did not expose kernel tools to the agent. Install @gatekeeper-os/kernel@beta."
npm deprecate @gatekeeper-os/gatekeeper-fs@0.1.0-beta.2 "Messaging cells did not expose kernel tools to the agent. Install @gatekeeper-os/gatekeeper-fs@beta."
npm deprecate @gatekeeper-os/cli@0.1.0-beta.2 "Messaging cells did not expose kernel tools to the agent. Install @gatekeeper-os/cli@beta."
```

## After Matt confirms publication

Verify real beta.3 registry artifacts. Run npm-only acceptance from the rebased
`test/npm-only-acceptance`: up to three invocations, harness-only fixes between;
product behavior failure is a hard stop with effective config and exact denial.
All stages must pass, including 38 selected conformance checks, owner-only audience
and approval apply/reject. Keep all failed-run evidence. Only on end-to-end success:
merge the harness after green build-test, regenerate the real beta.3 Tier 1 registry
lockfile, and merge community PR9 after green build-test. No acceptance run now.

## Public-flip launch gate (separate authorization)

No credential replacement. After the separately authorized public flip, rerun
community build-test and verify live core fetch/parity ran and passed, not skipped,
before removing the skip path. Private-core pinned parity is not live-sync success.
