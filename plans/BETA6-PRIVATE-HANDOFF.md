# GatekeeperOS beta.6 — Matt's publication commands

Preparation does **not** publish, deprecate, push tags, change visibility, or post upstream. The release tag
`v0.1.0-beta.6` exists only locally, in `/home/matthew/projects/gatekeeper-os/gatekeeper-os`. The final
preparation report gives its exact commit SHA. Run these commands yourself, and only when you are ready to
publish that exact candidate.

## 1. Clean tagged source; publish only the five beta packages

```bash
set -euo pipefail
cd /home/matthew/projects/gatekeeper-os/gatekeeper-os
test -z "$(git status --porcelain)"
tag_sha="$(git rev-parse 'v0.1.0-beta.6^{commit}')"
# Compare tag_sha with the exact SHA reported in the final preparation handoff.
git switch --detach "$tag_sha"
test "$(git rev-parse HEAD)" = "$tag_sha"
test "$(node -p 'require("./package.json").version')" = 0.1.0-beta.6
pnpm install --frozen-lockfile
pnpm build
npm_config_git_checks=false pnpm -r publish --dry-run --access public --tag beta
```

The dry-run must select exactly these five packages, all at `0.1.0-beta.6`, and no private package:
`@gatekeeper-os/shared`, `gatekeeper-kit`, `kernel`, `gatekeeper-fs` and `cli`. Git checks are disabled only
because pnpm objects to publishing from a detached tag. The clean-tree and SHA checks above still apply.
Then authenticate in the terminal and publish:

```bash
npm login --registry=https://registry.npmjs.org
npm_config_git_checks=false pnpm -r publish --access public --tag beta --registry=https://registry.npmjs.org
```

## 2. Wait, then verify ALL FIVE before any latest tag

A successful publish response is not enough. Neither is a reachable exact-version document, or one package
being visible. The read-only verifier checks, for all five packages: full version listings, publication times,
exact-version documents, both tag surfaces, SHA512-verified archives, packed package identities and exact
internal pins. It never installs packages or writes to npm. A failed attempt cannot open the gate.

```bash
receipts="$(mktemp -d -t gkos-beta6-publication.XXXXXX)"
sleep 30
listed=false
for attempt in $(seq 1 20); do
  if python3 scripts/verify-release-listing.py 0.1.0-beta.6 > "$receipts/beta6-attempt-$attempt.json"; then
    listed=true
    break
  fi
  sleep 30
done
test "$listed" = true
```

If the barrier fails, stop and keep the receipts. Do not promote, retry publication blindly, or run npm-only
acceptance.

## 3. Promote latest only after that complete verification

```bash
npm dist-tag add @gatekeeper-os/shared@0.1.0-beta.6 latest
npm dist-tag add @gatekeeper-os/gatekeeper-kit@0.1.0-beta.6 latest
npm dist-tag add @gatekeeper-os/kernel@0.1.0-beta.6 latest
npm dist-tag add @gatekeeper-os/gatekeeper-fs@0.1.0-beta.6 latest
npm dist-tag add @gatekeeper-os/cli@0.1.0-beta.6 latest
python3 scripts/verify-release-listing.py 0.1.0-beta.6 latest > "$receipts/beta6-latest.json"
```

If latest verification is inconsistent, wait and rerun **the read-only verifier**. Do not continue until it
succeeds for all five packages.

## Not included

- **Deprecating beta.5.** beta.5 works on its pinned OpenClaw 2026.9.2 but not on 2026.9.5+. Deprecating it is
  your decision, and no command for it is prepared here.
- **Pushing the tag.** It stays local unless you push it (`git push origin v0.1.0-beta.6`).

## After publication (separate runs)

1. The branch `test/npm-only-acceptance` is rebased onto the prepared release and retargeted to beta.6. It is
   not merged or run. Once the listings are verified, start the npm-only VM acceptance explicitly.
2. The community gatekeepers repo (`gatekeeper-os/gatekeepers`, `template/`) moves to the driver/plugin shape and
   the beta.6 kit. Its CI then runs against the real registry lockfile.
