# QEMU 11.1: partial io_uring allocation failure

## Verified failure

On the development host, `qemu-img --help` failed with
`Failed to initialize io_uring: Cannot allocate memory`. A syscall trace showed
one `io_uring_setup(128)` succeeding and the second returning `ENOMEM`.
There was available host RAM; the session processes shared an 8 MiB memlock
limit. Descriptor counts suggested locked-memory pressure but did not establish
the exact charged allocation or prove a leak.

QEMU's `util/aio-posix.c`, `aio_context_setup()`, explains why partial success
is fatal: once one AioContext acquires io_uring, subsequent contexts must support
it. If the first allocation fails, QEMU instead selects its epoll fallback.
Disk `aio=threads` alone does not select this event-monitor backend.

## Process-local recovery

The successful diagnostic was:

```sh
prlimit --memlock=0:8388608 -- qemu-img --help
```

This lowers the process's **soft** locked-memory allowance to zero, keeps the
existing 8 MiB hard limit, and lets QEMU choose its built-in epoll implementation.
It does not disable io_uring globally, raise a resource limit, patch QEMU, or
change a disk image. Do not copy the hard-limit number to a different machine
without inspecting its actual limits.

For `qemu:///session`, libvirt starts both QEMU and `qemu-img` in the existing
session daemon, not the calling shell. Lowering only the `virsh` shell's limit
does not affect that daemon. On the affected host, the same soft-limit change
was applied to the verified, same-user **virtqemud** process. Its hard limit was
preserved. This affects future child processes, not already-running guests.

Before doing this, identify the owning session daemon, inspect its command,
UID, limits and running guests, and ensure it is not a system daemon or an
unrelated user's process. Use its verified PID; never a broad process-name kill.
An equivalent command for the observed 8 MiB hard limit is:

```sh
prlimit --pid VERIFIED_SESSION_DAEMON_PID --memlock=0:8388608
```

The change is reversible by restoring the recorded original soft limit using
`prlimit`. Do not change limits or restart a daemon during an acceptance run.
This workaround is **daemon-lifetime only**: a replacement daemon gets the host's
normal defaults. Reassess resource pressure if it returns; do not silently install
global resource policy as part of the application installer. Workloads that
explicitly require locked memory or io_uring need a separate host-level remedy.

## Evidence

After the change, the existing `clawos-test` domain booted. The exact saved run
`scripts/vm/test.sh phase-3 installed install-hook` restored `installed`, booted,
synced sources, and executed guest tests. Evidence:
`vm-artifacts/20260909-032758-phase-3/` in the Phase 3 worktree.

Four initial checks passed; `primary-denies-before-hook` failed and the harness
returned **1**. That is an application/fixture acceptance failure, **not a QEMU
bootstrap failure or successful Phase 3 acceptance**. Production Gateway and
the already-running unrelated validation guest were not stopped. Base and
installed snapshots were not replaced.

A transient `systemd-run --collect` unit may disappear after completion.
An inactive unit's default status is not proof of success: inspect the harness's
`exit-code`, verdict, and journal.
