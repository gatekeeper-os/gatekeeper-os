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

Never use personal accounts. Create: a throwaway GitHub account with one private test repository and a fine-grained PAT (for CI) plus an OAuth app (for the device/web flow test); a Telegram bot token for a test bot and a test chat (for channel, pairing, and digest tests); one model provider key with a spending cap (or use OpenClaw's local/OpenAI-compatible test provider from the conformance suite so most tests need no paid model). Provide them to the VM only through `scripts/vm/secrets.env` (git-ignored, mode 600), injected as environment variables for the duration of a run and never written to disk inside the VM except through OpenClaw's own SecretRef mechanism.

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
