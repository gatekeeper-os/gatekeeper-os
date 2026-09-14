# GatekeeperOS beta.4 — contingency publication handoff

Do not publish until checking whether kernel beta.3 has recovered. Recheck its
packument, exact version document, tarball integrity and dist-tags consistently;
if recovered before beta.4 publication, discard the never-pushed beta.4 tag and
proceed with beta.3 npm-only acceptance using its tag and rebased harness instead.
The beta.4 preparation does not authorize publication or any VM run while registry
listings are inconsistent. All five `latest` tags were still beta.2 at preparation.

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
kernel dependency. The acceptance harness currently targets beta.3; if beta.4 is
published, update its artifact identifiers to beta.4 before the authorized run.
Preserve all failed-run evidence. Up to three invocations, harness-only fixes between;
product failure is a hard stop. All 38 selected conformance checks, owner-only audience
and approval apply/reject must pass before harness/community PR9 merges with green
build-test and the real selected-version Tier 1 registry lockfile.

No visibility change, publication, deprecation, tag push, trusted publisher setup,
release-workflow rerun, phase tag or upstream post is performed by preparation.
