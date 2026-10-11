# GatekeeperOS beta.7 — Matt's publication commands

Preparation does **not** publish, deprecate, push tags, change visibility, or post upstream. The release tag
`v0.1.0-beta.7` exists only locally, in `/home/matthew/projects/gatekeeper-os/gatekeeper-os`. The final
preparation report gives its exact commit SHA. Run these commands yourself, and only when you are ready to
publish that exact candidate.

Prerequisites: Node 24.16+ and pnpm 10.15.0 on `PATH` (`node --version`, `pnpm --version`). On nova,
`/run/current-system`'s Node is 22, so use your user profile's Node 24 or `npx -y pnpm@10.15.0`.

## 1. Clean tagged source; publish only the five beta packages

```bash
set -euo pipefail
cd /home/matthew/projects/gatekeeper-os/gatekeeper-os
test -z "$(git status --porcelain)"
tag_sha="$(git rev-parse 'v0.1.0-beta.7^{commit}')"
# Compare tag_sha with the exact SHA reported in the final preparation handoff.
git switch --detach "$tag_sha"
test "$(git rev-parse HEAD)" = "$tag_sha"
test "$(node -p 'require("./package.json").version')" = 0.1.0-beta.7
pnpm install --frozen-lockfile
pnpm build
npm_config_git_checks=false pnpm -r publish --dry-run --access public --tag beta
```

The dry-run must select exactly these five packages, all at `0.1.0-beta.7`, and no private package:
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
receipts="$(mktemp -d -t gkos-beta7-publication.XXXXXX)"
sleep 30
listed=false
for attempt in $(seq 1 20); do
  if python3 scripts/verify-release-listing.py 0.1.0-beta.7 > "$receipts/beta7-attempt-$attempt.json"; then
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
npm dist-tag add @gatekeeper-os/shared@0.1.0-beta.7 latest
npm dist-tag add @gatekeeper-os/gatekeeper-kit@0.1.0-beta.7 latest
npm dist-tag add @gatekeeper-os/kernel@0.1.0-beta.7 latest
npm dist-tag add @gatekeeper-os/gatekeeper-fs@0.1.0-beta.7 latest
npm dist-tag add @gatekeeper-os/cli@0.1.0-beta.7 latest
python3 scripts/verify-release-listing.py 0.1.0-beta.7 latest > "$receipts/beta7-latest.json"
```

If latest verification is inconsistent, wait and rerun **the read-only verifier**. Do not continue until it
succeeds for all five packages.

## Not included (your decisions)

- **Deprecating beta.6 and beta.5.** beta.6's CLI creates cells that cannot load the filesystem gatekeeper, and
  beta.5 fails closed on OpenClaw 2026.9.5+. If you choose to deprecate them after beta.7 is verified as `latest`:

  ```bash
  for p in shared gatekeeper-kit kernel gatekeeper-fs cli; do
    npm deprecate "@gatekeeper-os/$p@0.1.0-beta.6" "Installer/CLI cells cannot load the filesystem gatekeeper; use 0.1.0-beta.7 or later."
    npm deprecate "@gatekeeper-os/$p@0.1.0-beta.5" "Unsupported on OpenClaw 2026.9.5+; use 0.1.0-beta.7 or later."
  done
  ```

- **Pushing the tag.** It stays local unless you push it (`git push origin v0.1.0-beta.7`).
- **ClawHub.** Not published to ClawHub. Installing from the Control UI Plugins page is planned for beta.8.

## After publication (separate runs)

1. `scripts/vm/test.sh phase-3 installed-2026-9-9 npm-only` against the published beta.7 (harness retargeted in
   this release; guest Node 24.16.0). Start it explicitly once the listings verify.
2. The community gatekeepers repo (`gatekeeper-os/gatekeepers`, `template/`) moves its kit dependency to beta.7.
