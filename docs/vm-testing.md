# VM Testing Guide

All acceptance testing for OpenClaw OS happens on a disposable virtual machine, never on the development host. This document defines the VM, the snapshot discipline, the sync-and-run loop, and what evidence each phase must produce. The kickoff prompt makes this binding.

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

**Multipass** (simplest; Linux, macOS, Windows): `multipass launch 24.04 --name clawos-test --cpus 2 --memory 4G --disk 20G`. Snapshots: `multipass snapshot clawos-test --name base` / `multipass restore clawos-test.base`. Exec: `multipass exec clawos-test -- bash -lc '…'`. File sync: `multipass transfer` or `multipass mount ./ clawos-test:/home/ubuntu/src`.

**libvirt / virt-install** (Linux hosts, including Arch): create from the Ubuntu cloud image with cloud-init providing the `tester` user; snapshots with `virsh snapshot-create-as clawos-test base` / `virsh snapshot-revert clawos-test base`; exec over SSH.

**Lima** (macOS/Linux): `limactl start --name=clawos-test template://ubuntu-24.04`; no native snapshots — use `limactl stop` + copy of the disk, or recreate from scratch per run.

**Vagrant + libvirt/VirtualBox**: `vagrant up`, `vagrant snapshot save base`, `vagrant snapshot restore base`, `vagrant ssh -c '…'`.

**Cloud VM** (if no local hypervisor): any provider's Ubuntu 24.04 instance; "snapshot" becomes a provider image or simply re-creating the instance from a saved cloud-init; slower but acceptable.

If none of these can be made to work, the agent stops and reports what was tried. Docker containers are not a substitute (no systemd user session, no real service management, no nested sandboxing).

## 4. Snapshot discipline

Three named snapshots, taken in this order and never modified afterwards:

1. **`base`** — fresh OS with §2 base packages, `tester` user, linger enabled, Docker installed but no images pulled, `.ssh` authorized for the host. No Node, no OpenClaw. This is the starting point for every Phase 1 install test.
2. **`installed`** — taken after a successful `clawos install` from the current working tree (Phase 1 acceptance). Starting point for Phases 3–6 tests, so you are not paying the install cost every run.
3. **`connected`** — taken after `clawos gatekeeper add github` + `connect` with a test GitHub account and a test repository introduced to an agent (Phase 4). Starting point for approval, drainer, and update tests.

Rules: never test on a VM that was not just restored from a snapshot; re-take `installed` and `connected` whenever the installer or kernel changes in a way that affects them; delete and recreate `base` if the base image is updated. Record which snapshot each test run started from in `plans/PROGRESS.md`.

## 5. The sync-and-run loop

The repo ships `scripts/vm/` with thin wrappers so the commands below work regardless of hypervisor. Environment variable `CLAWOS_VM_DRIVER` selects `multipass` (default), `libvirt`, `lima`, `vagrant`, or `ssh` (for a cloud VM, with `CLAWOS_VM_HOST=user@ip`).

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
| `test/phase-1.sh` | `base` | `curl … \| bash` (from the synced tree's `installer/install.sh`), `clawos status`, doctor lint, security audit, idempotent re-run, second cell create, backup/restore |
| `test/phase-2.sh` | host only | unit tests for shared + kit (no VM needed; still recorded) |
| `test/phase-3.sh` | `installed` | install kernel + gatekeeper-fs from the tree, conformance subset, fs-grant scenario via `openclaw agent` scripted turns |
| `test/phase-4.sh` | `installed` | install gatekeeper-github, connect with `GITHUB_TEST_TOKEN` (device flow or PAT for CI), deferred-approval and require-approval scenarios, secret-leak grep, take snapshot `connected` |
| `test/phase-5.sh` | `connected` | auto-approval rule + drainer timing, digest delivery to a test channel, chat commands |
| `test/phase-6.sh` | `installed` | apply each blueprint, `blueprint lint` negative test, Docker sandbox exec |
| `test/phase-7.sh` | `connected` | `clawos update --to <latest>` full pipeline; compat-block test; conformance-fail test; kill-during-activate + `clawos rollback` |

## 6. Test credentials

Never use personal accounts in CI. Create: a throwaway GitHub account with one private test repository and a fine-grained PAT (for CI) plus an OAuth app (for the device/web flow test); a dedicated Slack app and test workspace identities (for channel, pairing, and digest tests); one model provider key with a spending cap (or use OpenClaw's local/OpenAI-compatible test provider from the conformance suite so most tests need no paid model). Local operator acceptance may reuse a host-managed SOPS environment only through protected stdin delivery into the test process. Never copy or interpolate its values into the repository, VM image, command arguments, or artifact bundle.

## 7. What "tested" means per phase

A phase is tested when `scripts/vm/test.sh phase-N` exits 0 from the required snapshot, the artifact directory exists and contains no secrets, every acceptance criterion in `docs/phase-checklist.md` for that phase is checked with a pointer to the artifact that proves it, and the run is described in `plans/PROGRESS.md`. Flaky tests are bugs: a criterion that passes on retry but not on first run is not passed.

## 8. Timing expectations

Fresh `base` → `installed` should take under ten minutes on a 2-vCPU VM (Phase 1 acceptance in the plan). The full Phase 7 update pipeline should complete in under fifteen minutes including staging and conformance. If a run exceeds twice these numbers, treat it as a defect to investigate rather than an inconvenience.

## Phase 0 libvirt implementation (2026-09-07)

On this development host, use `CLAWOS_VM_DRIVER=libvirt scripts/vm/up.sh` and
`CLAWOS_VM_DRIVER=libvirt scripts/vm/test.sh phase-0`. The driver uses
`qemu:///session`, a dedicated `clawos-test` domain, loopback SSH port 22240,
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
reach the `clawos-test` domain and the immutable `base` snapshot that `phase-0-bootstrap` built — and recreating
`base` would mean re-downloading the cloud image and discarding the reference point every earlier acceptance run
was measured against.

`CLAWOS_VM_STATE_DIR` selects a shared state directory deliberately. It **does not weaken the ownership check**:
the driver still requires the running domain's disk to be exactly the disk in the selected directory. Before use
the path is resolved, required to end in `scripts/vm/.state`, required to belong to a worktree of *this*
repository (compared by `git rev-parse --git-common-dir`), and required to contain `tester.qcow2` and `ssh-key`.
Anything else is refused — verified against `/tmp`, `~/.openclaw`, and a nonexistent path. Snapshots stay
immutable: `lv_snapshot` still refuses to overwrite a named snapshot, so a shared `base` cannot be destroyed by a
phase run.

```bash
CLAWOS_VM_DRIVER=libvirt \
CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state \
  scripts/vm/test.sh phase-1
```

Only one task may use the `clawos-test` domain at a time. The unrelated `alinaos-arch-validation` domain is never
touched.

### Phase 1 collection

`collect.sh` has a `phase-1` branch that pulls only the structural evidence `test/phase-1.sh` wrote to
`~/phase-1-evidence/`, plus unit status and the journal. The raw `openclaw.json` and the cell `.env` — the two
files that hold credentials — are never collected. The token-like-string grep still gates the run.

### Node provisioning

`installer/install.sh` provisions Node only when `CLAWOS_ALLOW_NODE_PROVISION=1`, which `test/phase-1.sh` sets
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

`CLAWOS_VM_DRIVER=libvirt CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state
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
`plugins.list` package metadata, then requests its exact `clawos.lock.json` version
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

## Phase 5 approvals-live checkpoint

`CLAWOS_VM_DRIVER=libvirt CLAWOS_VM_STATE_DIR=<original-phase0>/scripts/vm/.state
scripts/vm/test.sh phase-5 installed approvals-live` resets the original unconnected
snapshot. It uses a synthetic driver with the existing filesystem contract name,
not an actual filesystem/GitHub provider, and a local synthetic channel. Real
Gateway/model dispatch, authenticated SDK RPCs, packed CLI and message CLI exercise
queue order, timer, previews, operator commands, and digest delivery. Only structural
`phase-5-evidence` files are collected. No personal credentials or external message.
Default/full mode returns blocked; this checkpoint cannot claim full acceptance.

## Phase 7 runtime checkpoint (implementation branch)

`CLAWOS_VM_DRIVER=libvirt CLAWOS_VM_STATE_DIR=<shared original state>
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
