# GatekeeperOS beta.5 — Matt's publication commands

> Historical record, superseded for launch status. Its preparation commands and
> authorization holds are not current instructions and must not be replayed.
> Five packages are published at beta.5, all three repos are public, and npm-only
> run `20260916-220009-phase-3` passed. Remaining limits and the completed release
> gates are in [current release status](../README.md#release-status). Original
> failed receipts remain failed. Native approval policy follows the
> [closed advisory disposition](upstream-native-approval-logging.md), not a pending upstream change.


Preparation does **not** publish or deprecate. Keep the release tag local; do not
push it, change visibility, configure trusted publishers, or rerun a release workflow.
The final handoff supplies the independently verified tag commit SHA. Run these
commands yourself only when ready to publish that exact candidate.

## 1. Clean tagged source; publish only the five beta packages

```bash
set -euo pipefail
cd /home/matthew/projects/Personal/openclaw-os-agent-kit/repo-skeleton/openclaw-os
test -z "$(git status --porcelain)"
tag_sha="$(git rev-parse 'v0.1.0-beta.5^{commit}')"
# Compare tag_sha with the exact SHA reported in the final preparation handoff.
git switch --detach "$tag_sha"
test "$(git rev-parse HEAD)" = "$tag_sha"
test "$(node -p 'require("./package.json").version')" = 0.1.0-beta.5
pnpm install --frozen-lockfile
pnpm build
npm_config_git_checks=false pnpm -r publish --dry-run --access public --tag beta
```

The dry-run must select exactly `@gatekeeper-os/shared`, `gatekeeper-kit`, `kernel`,
`gatekeeper-fs`, and `cli`, all `0.1.0-beta.5`; no private package. Git checks are
disabled only for pnpm's detached-tag branch check; clean-tree and SHA checks above
remain mandatory. Then authenticate in the terminal and publish:

```bash
npm login --registry=https://registry.npmjs.org
npm_config_git_checks=false pnpm -r publish --access public --tag beta --registry=https://registry.npmjs.org
```

## 2. Wait, then verify ALL FIVE before any latest tag

A successful publish response, reachable exact-version document, or one package's
visibility is insufficient. The read-only verifier checks full version listings,
publication times, exact-version documents, both tag surfaces, SHA512-verified
archives, packed package identities and exact internal pins for all five.
It never installs packages or writes to npm. Failed attempts cannot open the gate.

```bash
receipts="$(mktemp -d -t gkos-beta5-publication.XXXXXX)"
sleep 30
listed=false
for attempt in $(seq 1 20); do
  if python3 scripts/verify-release-listing.py 0.1.0-beta.5 > "$receipts/beta5-attempt-$attempt.json"; then
    listed=true
    break
  fi
  sleep 30
done
test "$listed" = true
```

If the barrier fails, stop. Retain the receipts and investigate; do not promote,
deprecate, retry publication blindly, or run npm-only acceptance.

## 3. Promote latest only after that complete verification

```bash
npm dist-tag add @gatekeeper-os/shared@0.1.0-beta.5 latest
npm dist-tag add @gatekeeper-os/gatekeeper-kit@0.1.0-beta.5 latest
npm dist-tag add @gatekeeper-os/kernel@0.1.0-beta.5 latest
npm dist-tag add @gatekeeper-os/gatekeeper-fs@0.1.0-beta.5 latest
npm dist-tag add @gatekeeper-os/cli@0.1.0-beta.5 latest
python3 scripts/verify-release-listing.py 0.1.0-beta.5 latest > "$receipts/beta5-latest.json"
```

If latest verification is inconsistent, wait and repeat **the read-only verifier**;
do not continue to deprecation until it succeeds for all five.

## 4. Deprecate beta.4 one package at a time, with readback

Do not run these concurrently. Every command/readback must finish successfully
before the next package. Earlier beta deprecations are not rewritten here.

```bash
deprecation='Tool ownership prevents exposing gatekeeper tools absent from the kernel manifest. Fixed in 0.1.0-beta.5; upgrade all five @gatekeeper-os packages together.'
npm deprecate @gatekeeper-os/shared@0.1.0-beta.4 "$deprecation"
test "$(npm view @gatekeeper-os/shared@0.1.0-beta.4 deprecated)" = "$deprecation"

npm deprecate @gatekeeper-os/gatekeeper-kit@0.1.0-beta.4 "$deprecation"
test "$(npm view @gatekeeper-os/gatekeeper-kit@0.1.0-beta.4 deprecated)" = "$deprecation"

npm deprecate @gatekeeper-os/kernel@0.1.0-beta.4 "$deprecation"
test "$(npm view @gatekeeper-os/kernel@0.1.0-beta.4 deprecated)" = "$deprecation"

npm deprecate @gatekeeper-os/gatekeeper-fs@0.1.0-beta.4 "$deprecation"
test "$(npm view @gatekeeper-os/gatekeeper-fs@0.1.0-beta.4 deprecated)" = "$deprecation"

npm deprecate @gatekeeper-os/cli@0.1.0-beta.4 "$deprecation"
test "$(npm view @gatekeeper-os/cli@0.1.0-beta.4 deprecated)" = "$deprecation"
```

## After publication (separate run)

`test/npm-only-acceptance` is rebased and retargeted to beta.5, not merged or run by
this preparation. The beta.4 failures remain immutable evidence, not successes.
First verify consistent beta.5 listings/tags/archives, then explicitly start the
npm-only VM acceptance run. Do not merge that harness or community PR #9 / regenerate
the Tier 1 registry lock based only on the packed gate. The synthetic successful
approval effects do not enable real filesystem writes or establish real channel
transport / connected-provider acceptance.
