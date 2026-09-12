# First-release preparation — 2026-09-12

**Prepared, not releasable. No npm credential, registry publish, release tag,
repository visibility change, or upstream post.**

The exact community/release addendum is incorporated in the separate
[plan PR #15](https://github.com/clawkeeper/openclaw-os/pull/15). This implementation
is [PR #16](https://github.com/clawkeeper/openclaw-os/pull/16). Preparation stops
before addendum step 5; writing the subsequent-release workflow does not authorize
running it.

## Integration and scope

- PRs #11, #12 and #13 were integrated on main, resolving overlapping kernel,
  test, CLI and documentation changes. Combined head: `c691bf2`.
- The required repository-URL PR #9 is also merged; main: `6b1996d`.
- The scope-only commit is `c2b9de4`: all workspace scope references changed to
  `@clawkeepers`; plugin IDs and the `clawos` executable did not change.
- Only shared, gatekeeper-kit, kernel, gatekeeper-fs and cli are publishable,
  at **0.1.0-beta.1**. All other workspace packages, including the spike, remain
  private. Package order is explicit in `config/release-packages.json`.
- Metadata, exports, embedded CLI helpers/templates and licenses are checked in
  actual pnpm tarballs. Internal dependency protocols are resolved by pnpm.
- MCP PR #14 remains separate and unmerged. Its approved STOP 2 implementation
  does not clear native action logging or full connected-provider acceptance.

## Hardening review against REVIEW.md

The integration review covered the changed kernel paths: prompt narrowing,
authenticated operator commands/RPCs, previews, maintenance admission, immediate
and timer draining, status/version reporting, and update recovery boundaries.
The existing grant resolution/registry path remains authoritative; scope changes
do not add an alternative authority source or allow drivers to self-register tools.

The review found an inconsistent maintenance check in immediate post-decision
draining: it read only config, ignoring the persisted update pause. A reproducer
observed two resource resolutions instead of one. `f0cec34` changes that path to
the same persisted maintenance predicate as the other drain/admission paths.
Downstream action authorization already prevented the effect; the fix prevents
the unnecessary resource reopen as well. The regression now passes.

The before-call fuzz test exercises 256 deterministic parameter mutations and
replays after authorization. Mutations and replay are denied; fixture calls only
perform dry-run work. This is bounded fuzz evidence, not exhaustive verification.

ESLint 9 now has a flat config. The secrets gate distinguishes clean scans,
detected credentials and incomplete scans, failing closed without printing matched
values. Its CI job is a prerequisite of build/test. Repository branch-protection
configuration is unavailable with the current private-repository entitlement
(GitHub returned 403); **CI dependency enforcement is not merge protection**.

No secret-leak scan or synthetic model checkpoint clears the documented upstream
native logging issue. No upstream API or SDK implementation was patched.

## Verification ledger

| Evidence | Result and limitation |
|---|---|
| Combined `c691bf2` host | 481 tests; build, types, catalog and secrets passed |
| Combined VM `20260912-112504-phase-3` | exit 0; 98 structural + 38 conformance checks; guest package/lock/kernel hashes matched the integrated source |
| Final release VM `20260912-121809-phase-3` | exit 0; 120 kernel + 163 CLI tests, 98 structural + 38 selected live conformance checks; kernel/harness hashes matched the guest |
| Release host/CI | 483 tests after fuzz and maintenance fix; 34 focused tests after loaded-version edit; CI run `34692506245` independently passed all 483 on `bc33baa` before failing packed authoring validation |
| Release utilities | release-version planning and secret-gate positive/negative/error controls passed |
| Tarballs | 10 packed-license checks pass; packed entry authoring validation fails as described below |
| Recursive publish dry-run | exit 0; exactly the five selected `@clawkeepers/*@0.1.0-beta.1` packages; no registry writes |

The actual dry-run command was:

```sh
npm_config_git_checks=false pnpm -r publish --dry-run
```

The one-command environment override permits the preparation branch; it does not
disable registry checks for any real publish. pnpm's login warning explicitly
said dry-run. Its default simulated dist-tag was `latest`; the eventual **real
first publish must use `--tag beta`**, as the addendum specifies.

Final rebuild/typecheck, ESLint, catalog/secrets, ten packed-license checks and
the recursive dry-run passed on runtime head `b91ab92`. Durable local logs and
`host-receipt.json` are under the kit's `release-prep-20260912/` directory.

VM release checkpoint receipts and final cleanup are recorded in PROGRESS.md.
Failed runs are retained, not overwritten or counted as passes.
The first final-kernel attempt stopped before testing when libvirt's graceful
shutdown was ignored; guest systemd poweroff recovered it without a forced stop.
Final VM state is **shut off**, with only the unchanged original base/installed
snapshots. No connected snapshot or production state was used.

## Release blockers

1. **Packed authoring validation:** the installed pin, OpenClaw 2026.9.2,
   rejects ordinary `definePluginEntry` exports with “plugin entry does not expose
   tool or feature authoring metadata.” It validates generated tool/feature
   authoring metadata, not the ordinary kernel/gatekeeper entry contract.
   The required command now really runs on extracted tarballs, with extracted
   internal dependencies and isolated state/config, and fails CI. The existing
   manifest inspector still passes, but is not substituted for the requested
   gate. This requires a reviewed contract-compatible resolution before tagging.
2. **Blueprint deep audits:** VM `20260912-120458-phase-9` passed 48 structural
   checks and four model turns, but all four audits returned warnings. The CLI
   returned valid JSON/exit 0; the stricter zero-warning gate correctly failed.
   All roles reported `gateway.trusted_proxies_missing` and
   `gateway.probe_failed`; assistant/ops also reported
   `tools.exec.host_sandbox_no_sandbox_agents`; coder reported
   `tools.exec.security_full_configured`. The isolated audit states did not
   establish a successful deep Gateway probe, so this is not deep acceptance.
   The proxy warning occurs even with this local-only UI; the sandbox-off warning
   explicitly describes fail-closed exec; coder's actual Docker restrictions
   passed. Do not add fictitious trusted proxies, relax exec, hide warnings, or
   reinterpret these results as clean. Probe authentication and the accepted
   blueprint policies need a follow-up resolution before the release gate closes.
3. **Existing acceptance limits:** native secrecy, connected driver/full-phase
   acceptance and the later npm-only fresh-VM acceptance remain open. No Phase 9
   acceptance tag has been created.
4. **Subsequent CI publishing:** npm provenance requires public source and public
   packages. Core remains private by instruction. The workflow fails closed on
   private source. npm trusted publishers can only be configured after Matt's
   first package creation. No token was acquired or stored.

## Exact eventual handoff — DO NOT RUN YET

**There is no publish-ready tagged commit today.** The intended tag is
`v0.1.0-beta.1`; do not publish from this preparation branch or treat a dry-run as
acceptance. After blockers are resolved, merge the reviewed preparation, record
the passing VM receipt, then create the local tag from a clean main checkout:

```sh
pnpm exec tsx scripts/release.ts --version 0.1.0-beta.1 \
  --notes-file plans/release-notes.md --tag
git rev-parse 'v0.1.0-beta.1^{commit}'
```

That exact resulting SHA must be recorded before handing publishing to Matt.
The script runs mandatory checks and never pushes or publishes. Do not push a
`v*` tag casually: once the workflow's prerequisites are met, it triggers publish.

Matt then uses a **clean local main checkout at exactly that tagged SHA**, not a
detached checkout or the shared worktree, and runs:

```sh
test -z "$(git status --porcelain)"
test "$(git branch --show-current)" = main
test "$(git rev-parse HEAD)" = "$(git rev-parse 'v0.1.0-beta.1^{commit}')"
pnpm install --frozen-lockfile
pnpm build
pnpm -r publish --dry-run
npm login
pnpm -r publish --access public --tag beta
```

`npm login` and its 2FA interaction are Matt's only. After package creation he can
configure npm trusted publishers for `clawkeeper/openclaw-os` / `release.yml`.
Installer/docs npm switch, ClawHub, community Tier 1, npm-only VM and `phase-9`
tag remain later deliverables, not claims made by this preparation.
