# VM Testing Guide

## Packed CI tool-visibility regression

`node scripts/check-package-licenses.mjs --pack --validate` now also runs two
deterministic loopback model turns under the messaging policy read from the
installed CLI tarball. It requires both os tools without grants, no gk tools
without grants, all three gk_fs tools after an operator-created owner-only grant,
successful list-tool results and native denials throughout. This CI artifact
regression complements, but does not replace, fresh-VM end-to-end acceptance.

For a read-only test of an exact published version through the same gate:
`node scripts/check-registry-packed-load.mjs 0.1.0-beta.2 /tmp/gkos-beta2-red-evidence`.
The receipt contains registry identities/integrities and structural model results,
not prompts, credentials or raw RPC bodies. Never treat expected beta.2 failure
as a passing acceptance result. Diagnosis: plans/BETA2-TOOL-DIAGNOSIS.md.

All acceptance testing for GatekeeperOS happens on a disposable virtual machine, never on the development host. This document defines the VM, the snapshot discipline, the sync-and-run loop, and what evidence each phase must produce. The kickoff prompt makes this binding.

## 1. Why a VM

The installer writes global npm packages, user-level systemd units, files under `~/.openclaw`, and optionally Docker sandboxes. Testing that on the development host would (a) pollute it, (b) hide "works on my machine" defects — the whole point of Phase 1 is a clean-host install — and (c) make INVARIANT 2 untestable, since update/rollback tests must start from a known state every time. A VM with snapshots gives a reproducible clean host for every run.

## 2. Target VM

| Property | Value |
|---|---|
| Image | Ubuntu 24.04 LTS (cloud image), x86_64 (arm64 also acceptable on Apple Silicon hosts) |
| Size | 2 vCPU, 4 GB RAM, 20 GB disk minimum (8 GB RAM if Docker sandboxes are exercised) |
| User | `tester`, passwordless sudo, login shell, `loginctl enable-linger tester` |
| Network | outbound HTTPS (npm registry, GitHub, model provider); no inbound needed |
| Base packages | `curl git build-essential ca-certificates jq sqlite3` and Docker CE (for Phase 6 sandbox tests) |
| Node | **Not** pre-installed — the OS installer must provision it (Phase 1 acceptance) |

Secondary targets, run only after the primary passes: Debian 12, Arch Linux (rolling), macOS 14+ (a Lima or UTM VM, or a real spare machine). Windows is covered only via WSL2 and is out of scope for automated runs.

## 3. Choose a VM tool

Use whichever of these is available on the host; the scripts in §5 abstract the difference.

**Multipass** (simplest; Linux, macOS, Windows): `multipass launch 24.04 --name gkos-test --cpus 2 --memory 4G --disk 20G`. Snapshots: `multipass snapshot gkos-test --name base` / `multipass restore gkos-test.base`. Exec: `multipass exec gkos-test -- bash -lc '…'`. File sync: `multipass transfer` or `multipass mount ./ gkos-test:/home/ubuntu/src`.

**libvirt / virt-install** (Linux hosts, including Arch): create from the Ubuntu cloud image with cloud-init providing the `tester` user; snapshots with `virsh snapshot-create-as gkos-test base` / `virsh snapshot-revert gkos-test base`; exec over SSH.

**Lima** (macOS/Linux): `limactl start --name=gkos-test template://ubuntu-24.04`; no native snapshots — use `limactl stop` + copy of the disk, or recreate from scratch per run.

**Vagrant + libvirt/VirtualBox**: `vagrant up`, `vagrant snapshot save base`, `vagrant snapshot restore base`, `vagrant ssh -c '…'`.

**Cloud VM** (if no local hypervisor): any provider's Ubuntu 24.04 instance; "snapshot" becomes a provider image or simply re-creating the instance from a saved cloud-init; slower but acceptable.

If none of these can be made to work, the agent stops and reports what was tried. Docker containers are not a substitute (no systemd user session, no real service management, no nested sandboxing).

## 4. Snapshot discipline

Three named snapshots, taken in this order and never modified afterwards:

1. **`base`** — fresh OS with §2 base packages, `tester` user, linger enabled, Docker installed but no images pulled, `.ssh` authorized for the host. No Node, no OpenClaw. This is the starting point for every Phase 1 install test.
2. **`installed`** — taken after a successful `gkos install` from the current working tree (Phase 1 acceptance). Starting point for Phases 3–6 tests, so you are not paying the install cost every run.
3. **`connected`** — taken after `gkos gatekeeper add github` + `connect` with a test GitHub account and a test repository introduced to an agent (Phase 4). Starting point for approval, drainer, and update tests.

Rules: never test on a VM that was not just restored from a snapshot; re-take `installed` and `connected` whenever the installer or kernel changes in a way that affects them; delete and recreate `base` if the base image is updated. Record which snapshot each test run started from in `plans/PROGRESS.md`.

## 5. The sync-and-run loop

The repo ships `scripts/vm/` with thin wrappers so the commands below work regardless of hypervisor. Environment variable `GKOS_VM_DRIVER` selects `multipass` (default), `libvirt`, `lima`, `vagrant`, or `ssh` (for a cloud VM, with `GKOS_VM_HOST=user@ip`).

```bash
scripts/vm/up.sh                  # create the VM, provision base packages, take snapshot "base"
scripts/vm/reset.sh base          # restore a snapshot
scripts/vm/sync.sh                # rsync the working tree (excluding node_modules, .git, dist) to /home/tester/src
scripts/vm/exec.sh 'bash -lc "…"' # run a command as tester
scripts/vm/test.sh phase-1        # reset → sync → run test/phase-1.sh inside → collect artifacts to ./vm-artifacts/<ts>/
scripts/vm/snapshot.sh installed  # take a named snapshot
```

`scripts/vm/test.sh <phase>` is the only command an acceptance run may use; it guarantees the reset happened and stores every output. Artifacts collected into `vm-artifacts/<timestamp>-<phase>/`: the full command log, `openclaw --version`, `openclaw plugins list --json`, `openclaw doctor --lint --json`, `openclaw security audit --deep --json`, `openclaw os status --json`, `systemctl --user status openclaw-gateway*`, `journalctl --user -u 'openclaw-gateway*' --since <start>`, the contents of `~/.openclaw/os/audit/`, and the conformance verdict JSON. Secrets must never appear in artifacts — the collector greps for token-like strings and fails the run if any are found.

Inside the VM, the per-phase test scripts live at `test/phase-N.sh` in the repo and do the following (the agent writes them in the phase they belong to):

| Script | Starts from | Runs |
|---|---|---|
| `test/phase-0.sh` | `base` | Node install, `openclaw@<pin>` install, `openclaw gateway run` foreground smoke, spike-probe plugin load, records S-1 answers |
| `test/phase-1.sh` | `base` | `curl … \| bash` (from the synced tree's `installer/install.sh`), `gkos status`, doctor lint, security audit, idempotent re-run, second cell create, backup/restore |
| `test/phase-2.sh` | host only | unit tests for shared + kit (no VM needed; still recorded) |
| `test/phase-3.sh` | `installed` | install kernel + gkos-gatekeeper-fs from the tree, conformance subset, fs-grant scenario via `openclaw agent` scripted turns |
| `test/phase-4.sh` | `installed` | install gkos-gatekeeper-github, connect with `GITHUB_TEST_TOKEN` (device flow or PAT for CI), deferred-approval and require-approval scenarios, secret-leak grep, take snapshot `connected` |
| `test/phase-5.sh` | `connected` | auto-approval rule + drainer timing, digest delivery to a test channel, chat commands |
| `test/phase-6.sh` | `installed` | apply each blueprint, `blueprint lint` negative test, Docker sandbox exec |
| `test/phase-7.sh` | `connected` | `gkos update --to <latest>` full pipeline; compat-block test; conformance-fail test; kill-during-activate + `gkos rollback` |

## 6. Test credentials

Never use personal accounts in CI. Create: a throwaway GitHub account with one private test repository and a fine-grained PAT (for CI) plus an OAuth app (for the device/web flow test); a dedicated Slack app and test workspace identities (for channel, pairing, and digest tests); one model provider key with a spending cap (or use OpenClaw's local/OpenAI-compatible test provider from the conformance suite so most tests need no paid model). Local operator acceptance may reuse a host-managed SOPS environment only through protected stdin delivery into the test process. Never copy or interpolate its values into the repository, VM image, command arguments, or artifact bundle.

## 7. What "tested" means per phase

A phase is tested when `scripts/vm/test.sh phase-N` exits 0 from the required snapshot, the artifact directory exists and contains no secrets, every acceptance criterion in `docs/phase-checklist.md` for that phase is checked with a pointer to the artifact that proves it, and the run is described in `plans/PROGRESS.md`. Flaky tests are bugs: a criterion that passes on retry but not on first run is not passed.

## 8. Timing expectations

Fresh `base` → `installed` should take under ten minutes on a 2-vCPU VM (Phase 1 acceptance in the plan). The full Phase 7 update pipeline should complete in under fifteen minutes including staging and conformance. If a run exceeds twice these numbers, treat it as a defect to investigate rather than an inconvenience.

## Phase 0 libvirt implementation (2026-09-07)

On this development host, use `GKOS_VM_DRIVER=libvirt scripts/vm/up.sh` and
`GKOS_VM_DRIVER=libvirt scripts/vm/test.sh phase-0`. The driver uses
`qemu:///session`, a dedicated `gkos-test` domain, loopback SSH port 22240,
4 GiB RAM, two vCPUs and a 24 GiB qcow2 overlay. It checks disk ownership before
operating on a domain and refuses to overwrite named snapshots. Images, private
SSH identity, generated seed and diagnostics stay in ignored `scripts/vm/.state/`.
The Ubuntu image is checked against the publisher's SHA256SUMS before use.

The NoCloud seed includes explicit instance metadata, and the Docker group is
created before `tester`. Bootstrap fails on cloud-init failure or preinstalled
Node; it never creates a misleading `base` snapshot. SSH uses its own known-hosts
file and `-F /dev/null`, independent of the development host's SSH includes.
The existing `alinaos-arch-validation` VM is not used or modified.

Legacy `secrets.env` command-line interpolation is disabled. S-1 uses an isolated,
deterministic local model and requires no personal/provider credentials. Future
credentialed phases must use protected delivery, not shell argument interpolation.
Phase-0 collection copies only allowlisted structural evidence; collector failure
propagates to the acceptance exit status.

## Phase 1 libvirt implementation (2026-09-07)

### Sharing VM state across worktrees

The libvirt driver derives its state directory from the worktree it runs in, and refuses to operate on a domain
whose disk is not the one in that directory. A phase branch lives in its own worktree, so by default it cannot
reach the `gkos-test` domain and the immutable `base` snapshot that `phase-0-bootstrap` built — and recreating
`base` would mean re-downloading the cloud image and discarding the reference point every earlier acceptance run
was measured against.

`GKOS_VM_STATE_DIR` selects a shared state directory deliberately. It **does not weaken the ownership check**:
the driver still requires the running domain's disk to be exactly the disk in the selected directory. Before use
the path is resolved, required to end in `scripts/vm/.state`, required to belong to a worktree of *this*
repository (compared by `git rev-parse --git-common-dir`), and required to contain `tester.qcow2` and `ssh-key`.
Anything else is refused — verified against `/tmp`, `~/.openclaw`, and a nonexistent path. Snapshots stay
immutable: `lv_snapshot` still refuses to overwrite a named snapshot, so a shared `base` cannot be destroyed by a
phase run.

```bash
GKOS_VM_DRIVER=libvirt \
GKOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state \
  scripts/vm/test.sh phase-1
```

Only one task may use the `gkos-test` domain at a time. The unrelated `alinaos-arch-validation` domain is never
touched.

### Phase 1 collection

`collect.sh` has a `phase-1` branch that pulls only the structural evidence `test/phase-1.sh` wrote to
`~/phase-1-evidence/`, plus unit status and the journal. The raw `openclaw.json` and the cell `.env` — the two
files that hold credentials — are never collected. The token-like-string grep still gates the run.

### Node provisioning

`installer/install.sh` provisions Node only when `GKOS_ALLOW_NODE_PROVISION=1`, which `test/phase-1.sh` sets
because it runs on a disposable VM. On any other host a missing Node is a hard failure with instructions, so the
installer cannot silently mutate a development machine's toolchain.

### Refreshing the installed snapshot after installer changes

First pass full fresh-base `scripts/vm/test.sh phase-1`. Then run
`scripts/vm/test.sh phase-1 base install-only` through the same driver. This explicitly
recorded mode exits after source install and healthy status, before drift, second-cell, and
backup scenarios. It is **not** full acceptance. Only after this clean install succeeds,
replace the stale disposable `installed` snapshot (base stays immutable) using the driver's
snapshot operation. A failed clean install never replaces the old snapshot.

### GitHub-hosted macOS acceptance

`github-hosted` is a disposable cloud-VM driver, used only in the macOS Actions workflow.
The Actions job creates the fresh image; reset verifies the hosted-runner identity and absence
of prior cells and refuses a second run on the same image. It does not pretend to restore a
local snapshot or make a reusable installed snapshot. Source is the checked-out commit;
acceptance still enters exclusively through `scripts/vm/test.sh phase-1`, and only allowlisted
structural evidence is uploaded. Linux libvirt remains the Node-less clean-install criterion.

## Phase 2 library-only acceptance (2026-09-07)

Phase 2 is the explicit host-only exception in the phase table: `scripts/vm/test.sh phase-2` builds and typechecks
shared/kit, runs their unit tests, and runs catalog/secret checks. It launches no Gateway, installs no runtime plugins,
and calls no VM driver. Evidence is retained under `vm-artifacts/<timestamp>-phase-2/` with `snapshot=host-only`,
mode, revision, Node version, upstream pin, command log and exit code. This establishes library behavior only; lifecycle
fixtures do not establish live Gateway authorization conformance, which remains Phase 3.


## Phase 3 pre-STOP 2 filesystem boundary checkpoint

`scripts/vm/test.sh phase-3 installed fs-boundary` restores the disposable `installed`
snapshot, syncs source, builds shared/kit/fs, and runs filesystem account-boundary tests.
It does not install a runtime plugin, invoke OpenClaw, or claim full Phase 3 acceptance.
The collector copies only `phase-3-fs-boundary-evidence/` (scope, Node/pin, test verdict,
exit code), with the harness log and explicit `mode=fs-boundary`. No Gateway config,
credentials, file contents or journals are collected in this mode. The standard full
Phase 3 conformance gate remains outstanding until kernel and data-plane implementation.


## Phase 3 post-STOP 2 filesystem enforcement checkpoint

`scripts/vm/test.sh phase-3 installed fs-enforcement` restores `installed`, syncs source,
builds shared/kit/fs, typechecks the driver and records its unit tests in the disposable
VM. Collection is restricted to `phase-3-fs-enforcement-evidence/` plus the harness log.
Scope explicitly records `fullPhaseAcceptance:false`, `liveKernelAcceptance:false`,
and `hostWritesEnabled:false`. It neither installs plugins nor invokes a Gateway.
The historical `fs-boundary` mode now refuses execution because the data plane is no
longer disabled; reproduce its original evidence only from checkpoint `fc8b33f`.

## Phase 3 conformance-runner checkpoint

`scripts/vm/test.sh phase-3 installed conformance-runner` records offline runner/transport regressions,
a real skipped-suite rejection and the existing installed guest Gateway's public SDK transport/health probes.
It installs no kernel plugins, creates no grants, changes no Gateway config, and does not count as kernel or full
Phase 3 acceptance. The SDK may maintain its own guest device identity as in S-1. Collection is restricted to
`phase-3-conformance-runner-evidence/`, containing structural verdicts, fixture-test results, versions and scope.
A skipped required live suite must produce nonzero conformance exit status; the checkpoint explicitly asserts
that negative result rather than reclassifying the suite as passed.


### Focused live kernel checkpoint

Run `scripts/vm/test.sh phase-3 installed kernel-live` using the configured libvirt
state directory. This resets `installed`, builds the kernel and fs driver, loads
them into an isolated foreground Gateway on guest loopback 19100, and runs a
local deterministic provider on guest loopback 19101. These ports are not exposed
by the VM and are separate from the installed cell at 18789. The passive monitor
has no tools, policies or grant-mutating surfaces. Only structure/fixture-match
booleans are collected; no config, device credentials, prompts or tool bodies.
The second Gateway run disables the kernel's conversation hooks and proves the
trusted capability policy still denies unknown handles. Both processes are stopped
by the harness. This is focused acceptance, not the full Phase 3 gate; file writes
remain disabled. Live suites reject absent, stale, or failed scenario evidence.
The `conformance-runner` checkpoint now tests missing live evidence rejection;
its unit fixtures continue to cover skipped/empty/failed suite rejection.

The live checkpoint also packs and installs the current CLI, registers the isolated
`kernel-test` cell at `/home/tester/.openclaw-kernel-test`, and exercises real CLI
status/grant/list/revoke/audit plus mounted `openclaw os status`. CLI unit verdicts
and eight CLI-specific current-run conformance assertions join the allowlisted
evidence. This does not test automatic installer plugin projection or install policy.

## Phase 3 installer checkpoint

`GKOS_VM_DRIVER=libvirt GKOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state
scripts/vm/test.sh phase-3 installed install-integration` restores the dedicated
VM, runs the source installer with packed self-contained plugins, verifies a no-op
reinstall and healthy empty-grant kernel/fs, then exercises actual pinned CLI
plugin installs under deny, explicit operator allow, and unavailable-policy states.
Only structural flags, test reports and safe install summaries are collected.
This focused checkpoint does not close secondary Gateway hook or full Phase 3 acceptance.

## Secondary Gateway install-hook fixture (not yet accepted)

`scripts/vm/test.sh phase-3 installed install-hook` restores the dedicated VM,
loads the real kernel into the isolated loopback Gateway at 19100, and stages an
inert private skill zip through documented admin upload RPCs. No model/provider,
registry, personal credentials or external messages are involved. The VM's primary
command bundles the production install evaluator with independently controlled
fixture rules; this intentionally distinguishes primary denial from secondary
kernel denial and does not re-test installer projection. Passive high/low-priority
hook handlers record only structural flags and never return policy decisions.

The expected sequence is primary deny with no hook, primary allow plus secondary
terminal deny, then a Gateway restart with an exact operator upload rule and a
successful install. It additionally checks read-only scope denial, byte equality,
no minted grants and consumed-upload replay refusal. Only structural evidence is
collected from `phase-3-install-hook-evidence/`. This skill path does not close the
checklist's plugin-specific hook criterion or full Phase 3 acceptance.

First attempted run `20260909-021053-phase-3` failed in snapshot restoration:
`qemu-img: Failed to initialize io_uring: Cannot allocate memory`. No guest test
ran. Both the 15-assertion suite and its fixture remain unaccepted until the host
VM blocker is resolved and a fresh run completes. Existing snapshots are retained.


## Phase 3 combined evidence and plugin-specific hook (2026-09-09)

`phase-3 installed full` runs the existing focused checkpoints in one reset VM,
with a fresh isolated test cell between them. It establishes the combined suite
set, not completion of every Phase 3 deliverable. `scope.json` explicitly records
`fullPhaseAcceptance:false`; real transports and incomplete kernel surfaces are
not implicitly accepted. The collector retains `checkpoints/{install,
conformance-runner,install-hook,channel-ingress,kernel-live}/` alongside the
aggregate verdict. Each contains only the focused harness's structural evidence;
no live cell state, model bodies, credentials or raw Gateway log is collected.

The older `install-hook` fixture remains a **skill** upload test. The separate
`phase-3 installed plugin-install-hook` mode exercises public Gateway
`plugins.install` for an uninstalled official plugin selected from the Gateway's own
`plugins.list` package metadata, then requests its exact `gkos.lock.json` version
through the supported ClawHub source. No account credentials or transport setup.
Hardcoded Slack and ACPX selectors did not reach policy; ACPX returned an
unknown-catalog error despite existing in the bundled fallback. The hosted runtime
catalog is authoritative, so the fixture discovers its actual installable target. An independently controlled primary policy first denies, then
allows staged material while the actual kernel's empty allowlist must still deny.
The passive hook monitor must observe typed plugin material before terminal denial;
config, installed plugin state and grants must remain unchanged. This tests plugin
installation policy, not external messaging or an ACP runtime activation. A failed network/catalog/preflight is
not a passing kernel denial; consult the explicit per-check verdict.


**Current result:** this mode is a retained failing diagnostic, not an accepted
plugin-hook fixture. Exact-version run `20260909-215951-phase-3` installed
`@openclaw/firecrawl-plugin@2026.9.2` after the primary fixture allowed it, with no
secondary hook observations. This is consistent with the documented trusted-official
bypass in `docs/upstream-reference.md:203`, not proof of an upstream defect.
A compatible **nonofficial** test package is needed to exercise the secondary
hook criterion. Do not repeatedly run the official control expecting different
behavior, weaken the primary policy, or relabel this failure as a pass.

## Nightly compatibility smoke (2026-09-11)

The nightly Actions job runs `scripts/ci/live-smoke.ts` only on a fresh GitHub-hosted
Ubuntu VM (`GITHUB_ACTIONS`, `RUNNER_ENVIRONMENT`, `RUNNER_OS` guards), with explicit
state/config selectors under `RUNNER_TEMP`. This is a read-only runtime compatibility
probe, not a phase acceptance run or a substitute for `scripts/vm/test.sh`. It starts
real kernel/fs plugins via supported `plugins.load.paths`, performs health and operator
RPC checks through the existing operator helper (bootstrap then device-token reconnect
using the target-installed public SDK), then stops the Gateway. Random throwaway auth
stays in the private config/in-memory SDK call; no raw Gateway output is uploaded.
Only structural verdict JSON leaves the runner. All full phase acceptance continues
through the snapshot/reset/sync/collect harness above.

### MCP authoring boundary (2026-09-12)

`./scripts/vm/test.sh phase-8 installed mcp-boundary` restores the original
installed snapshot, runs account/transport fixtures and the actual Gateway
empty-config lifecycle/denial probe. No real MCP account or effects are enabled.
Artifacts explicitly distinguish local TLS fixtures from live-provider acceptance.
`phase-8 installed full` returns blocked (exit2) at STOP2, never a fabricated pass.

## Phase 6 blueprint sandbox checkpoint (2026-09-12)

`phase-6 installed blueprint-sandbox` builds and installs the packed CLI in the
VM's isolated checkpoint prefix. It creates two actual cells via `gkos cell
create`: `blueprint-runtime` on 19100 and `blueprint-messaging` on 19110. A synthetic
model listens on loopback 19101. These ports are guest-only and checked by cell
creation; no host service binds them.

The runtime cell provisions coder, verifies idempotence/drift and runs native exec
inside real Docker. Container inspection checks network:none, read-only root and no
Docker socket, plus an inaccessible host-only file and a positive workspace write.
The messaging cell refuses coder before creating any agent and must print
`gkos cell create blueprint-messaging-runtime --port 19111 --policy runtime`.
Assistant, ops and researcher then provision idempotently and execute synthetic
Gateway turns: denied runtime/fs tools remain absent, positive allowed tools are
present, and researcher has only web tools. Each role uses a fresh session.

The fixture only supplies a synthetic model; it does not replace cell policy.
`00-baseline.json5` must equal the repository template byte for byte, and only the
runtime cell gets `05-policy-runtime.json5`. The minimal Debian sandbox image is
not proof of the upstream development image's inventory. GitHub integration remains
pending and HTTP is deferred beyond beta. `full` returns blocked, exit 2.
Only structural `phase-6-evidence/` files are collected, never configs, tokens,
model bodies or raw Gateway logs.

## Phase 5 approvals-live checkpoint

`GKOS_VM_DRIVER=libvirt GKOS_VM_STATE_DIR=<original-phase0>/scripts/vm/.state
scripts/vm/test.sh phase-5 installed approvals-live` resets the original unconnected
snapshot. It uses a synthetic driver with the existing filesystem contract name,
not an actual filesystem/GitHub provider, and a local synthetic channel. Real
Gateway/model dispatch, authenticated SDK RPCs, packed CLI and message CLI exercise
queue order, timer, previews, operator commands, and digest delivery. Only structural
`phase-5-evidence` files are collected. No personal credentials or external message.
Default/full mode returns blocked; this checkpoint cannot claim full acceptance.

## Phase 7 runtime checkpoint (implementation branch)

`GKOS_VM_DRIVER=libvirt GKOS_VM_STATE_DIR=<shared original state>
scripts/vm/test.sh phase-7 installed runtime-checkpoint` restores the original installed
snapshot, installs the current kernel, and introduces a disposable filesystem grant. No
personal credentials or connected snapshot. Collection is restricted to structural
`phase-7-evidence/` files; raw configs, tokens, vendor output, journals and backups stay in
private guest state.

The checkpoint exercises actual npm staging, Gateway/SDK health and grant operations,
systemd activation, verified archive restoration and an interrupted transaction. Its
step-five runtime probe is explicitly substituted by the test harness and cannot pass
production full-conformance validation. Both evidence files and command output distinguish
this checkpoint from full Phase 7 acceptance; the `full` mode currently returns blocked.

## Phase 9 prepublish checkpoint

```sh
GKOS_VM_DRIVER=libvirt GKOS_VM_STATE_DIR=<original-phase0>/scripts/vm/.state \
  scripts/vm/test.sh phase-9 installed prepublish
```

This resets the original installed snapshot, rebuilds and packs the current CLI,
and runs the two-cell Phase 6 checkpoint. After each cell's role scenarios,
`openclaw security audit --deep --json` audits that actual cell with its own
Gateway still running. The cell token is supplied through child environment
the canonical `GKOS_GATEWAY_TOKEN` SecretRef environment provider, not argv; the original state identity is preserved.

The gate requires zero critical findings and a successful authenticated deep probe.
Only the exact warning codes and per-cell predicates in `docs/blueprints.md` are
accepted. Runtime sandbox defaults and every effective agent mode are read from
upstream's public redacted config surface in the same run; messaging's global
denials and loopback bind are likewise checked. Unknown warnings, suppressions,
command/parse failures and `gateway.probe_failed` fail closed. Reports retain only
IDs, severities and structural predicate/probe results. Pure gate tests run with
`node --test test/scripts/blueprint-audit-gate.test.mjs`.

Phase 3/5/6/7 packed-CLI checkpoints now install with the isolated prefix
`/home/tester/phase-checkpoint-cli`; its bin directory is prepended for the test.
This prevents the new npm scope from colliding with the original snapshot's CLI
without overwriting or uninstalling it. Actual tarball names come from pnpm pack,
not the old npm scope. No snapshot is modified or replaced.

This command never publishes, logs into npm, tags, or claims the later npm-only
Phase 9 acceptance. The release's kernel changes also require the independent
`phase-3 installed kernel-live` checkpoint. Preserve failed runs as failed evidence.

## Published-package npm-only acceptance

`scripts/vm/test.sh phase-3 installed npm-only` uses the owned libvirt VM and the
original installed snapshot. Unlike source checkpoints, it stops the snapshot's
Gateway and removes `/home/tester/src`, then transfers only `test/npm-only` fixtures
and their runner to `/home/tester/npm-acceptance`. No repository is cloned or synced;
no product is built or copied from the host. All five `@gatekeeper-os` packages are
installed at `0.1.0-beta.5` from `https://registry.npmjs.org` into an empty prefix.
Registry identity, dist-tags, publish times and integrity metadata are retained.
The npm-only runner installs the README-pinned Node 22.22.3 in a disposable
test-only prefix, verifies the official archive SHA256, and retains its version
and executable in `guest-runtime.json`; snapshot Node/upstream are not modified.
The published beta.5 run `20260916-220009-phase-3` passed all selected stages on
Node22.22.3 / OpenClaw2026.9.2 after five-package listing/integrity verification. The
independent approvals fixture owns its manifest tools and obtains its sole added
messaging plugin admission from the installed CLI catalog-policy preview, with a
strict unchanged-native-policy check. This fixture step is not config-apply CLI evidence.

The installed CLI provisions `kernel-test --port 19100 --policy messaging`.
Its packaged kernel, filesystem driver, config fragments and install policy are
used unchanged. Test fixtures add a loopback synthetic model, passive observations,
disposable filesystem roots and a synthetic channel, preserving global messaging
denials and the canonical cell-token SecretRef. Guest-only ports 19100/19101 are
not exposed on the host. Install-policy checks cover actual CLI denial/explicit
operator allowance and unavailable-policy fail-closed behavior. Kernel scenarios
retain the selected 38 live conformance assertions through a dependency-free
test-only evidence adapter, plus owner-only audience checks.

The real filesystem driver still refuses applying writes; that limitation is not
patched away or recast as successful provider-write acceptance. Any synthetic
approval effects are recorded separately from real filesystem/provider effects.
Only structural evidence is collected from `npm-acceptance-evidence`; cell configs,
credentials, raw model traffic and Gateway logs stay private in the disposable VM.
The first failing command stops the run. Do not patch the product or retry a failed
acceptance as if it were the original result. No publication, release workflow,
visibility change or phase tag is performed by this checkpoint.

### Libvirt preflight: transient memlock and daemon identity

Verified on nova's session libvirt 12.7.0 / QEMU 11.1 (2026-09-12):
`qemu-img snapshot -a installed` and QEMU capability probing can fail with
`Failed to initialize io_uring: Cannot allocate memory` when the session
`virtqemud` inherits an 8 MiB soft/hard MEMLOCK limit. The tested process-only
workaround is **soft MEMLOCK 0**, preserving the original hard limit; do not
interpret this as increasing available memory or apply it to unrelated failures.

For `phase-3 installed npm-only`, `scripts/vm/test.sh` now automatically sources
`preflight.sh`: acquire the owned-state acceptance lock, require the VM off, hold
an interactive session connection, verify exactly one same-user timed virtqemud,
and record its PID/start identity and limits. `libvirt-preflight.py` applies the
process-only 0/8MiB fallback only to the evidenced 8MiB/8MiB condition (already-zero
is retained; unknown limits fail closed). No sudo or persistent host config edits.

The runner's EXIT/INT/TERM traps request graceful guest poweroff, then terminate
the keeper; its `finally` restores original limits on the same PID/start identity,
closes the connection, and compares the original internal snapshot table. Cleanup
failure produces exit98. Forced poweroff, snapshot recreation and release retries
are never performed. As with all traps, SIGKILL/host power loss cannot be handled.
A lost daemon identity is a recorded failure, never a reason to modify a new PID.

If original registrations have disappeared, supply the directory holding the
retained original `<snapshot>.original.xml` files via
`GKOS_VM_SNAPSHOT_XML_DIR`. Preflight verifies snapshot name and owned disk,
records each XML SHA256, and uses `snapshot-create --redefine` only for missing
registrations, restoring original ancestors before the requested child. Every
ancestor must have its own matching original XML and owned disk; missing XML,
invalid names and parent cycles fail closed. Existing registrations are untouched;
it never creates/replaces an internal snapshot. Host-only regression:
`python3 test/vm-snapshot-registration.test.py` (fake libvirt; no VM start/reset).

The artifact `libvirt-preflight.json` records before/applied/restored limits,
identity and snapshot equality. Keep scripts immutable during the single run.
Other VM modes and read-only diagnostic boots still require an explicitly held
connection and the same transient cleanup discipline; they do not implicitly
opt into this nova-specific workaround.

Inspection of a failed run must preserve its current guest disk: do not revert to
`installed` before reading retained logs/configs. Booting the current disk starts
its normal services; make only read-only diagnostic queries and redact auth fields.
