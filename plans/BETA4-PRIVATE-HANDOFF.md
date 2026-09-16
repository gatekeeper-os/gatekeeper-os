# GatekeeperOS beta.4 — contingency publication handoff

**2026-09-14 status: published and verified.** Beta.3 is deprecated; discard its
acceptance plan. The manual publication commands below are retained as a release
handoff template/history, not an instruction to republish beta.4.

## Registry indexing barrier (release handoff template)

Never run dist-tag or deprecate writes until the publish process has exited and
every package listing has been verified. Check all exact version documents,
packument version entries and publication times, archive SHA512, internal pins,
and beta tags. A version document or successful command alone is insufficient.
Kernel beta.3 and gatekeeper-fs beta.4 listings lagged their version documents
until a later write (operator-reported incident); do not use concurrent metadata
writes to repair or probe indexing. After authorized tag/deprecation writes,
read listings and dist-tag endpoints again to confirm the actual result.

## Manual publication from the tag SHA (Matt only)

```sh
cd /home/matthew/projects/Personal/openclaw-os-agent-kit/repo-skeleton/openclaw-os
test -z "$(git status --porcelain)"
tag_sha="$(git rev-parse 'v0.1.0-beta.4^{commit}')"
git switch --detach "$tag_sha"
test "$(git rev-parse HEAD)" = "$tag_sha"
pnpm install --frozen-lockfile
pnpm build
npm_config_git_checks=false pnpm -r publish --dry-run --access public --tag beta
npm login
npm_config_git_checks=false pnpm -r publish --access public --tag beta
```

The dry-run must select exactly the five @gatekeeper-os packages at beta.4.
Verify all five beta.4 version identities, tarball integrities, packument entries,
exact internal pins and beta dist-tags before promoting latest or deprecating beta.3.
A successful dist-tag command alone is not proof: read each packument and tag endpoint.

```sh
npm dist-tag add @gatekeeper-os/shared@0.1.0-beta.4 latest
npm dist-tag add @gatekeeper-os/gatekeeper-kit@0.1.0-beta.4 latest
npm dist-tag add @gatekeeper-os/kernel@0.1.0-beta.4 latest
npm dist-tag add @gatekeeper-os/gatekeeper-fs@0.1.0-beta.4 latest
npm dist-tag add @gatekeeper-os/cli@0.1.0-beta.4 latest
```

Then verify both beta and latest resolve to beta.4 for all five packages.

```sh
npm deprecate @gatekeeper-os/shared@0.1.0-beta.3 "Superseded by beta.4 due to a registry indexing failure; identical code"
npm deprecate @gatekeeper-os/gatekeeper-kit@0.1.0-beta.3 "Superseded by beta.4 due to a registry indexing failure; identical code"
npm deprecate @gatekeeper-os/kernel@0.1.0-beta.3 "Superseded by beta.4 due to a registry indexing failure; identical code"
npm deprecate @gatekeeper-os/gatekeeper-fs@0.1.0-beta.3 "Superseded by beta.4 due to a registry indexing failure; identical code"
npm deprecate @gatekeeper-os/cli@0.1.0-beta.3 "Superseded by beta.4 due to a registry indexing failure; identical code"
```

## After consistent publication

Before npm-only acceptance, the kernel version referenced by the selected CLI and
filesystem installation path must be present consistently in registry listings.
The CLI directly pins kernel and gatekeeper-fs; gatekeeper-fs does not have a direct
kernel dependency. The acceptance harness now targets the verified beta.4 artifacts.
Preserve all failed-run evidence. Up to three invocations, harness-only fixes between;
product failure is a hard stop. All 38 selected conformance checks, owner-only audience
and approval apply/reject must pass before harness/community PR9 merges with green
build-test and the real selected-version Tier 1 registry lockfile.

No visibility change, publication, deprecation, tag push, trusted publisher setup,
release-workflow rerun, phase tag or upstream post is performed by preparation.
