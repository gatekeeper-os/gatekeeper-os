#!/usr/bin/env python3
"""Hold one session daemon and restore its exact process-local limit on termination."""
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import time


def identity(pid):
    p = Path('/proc') / str(pid)
    if p.stat().st_uid != os.getuid() or (p / 'comm').read_text().strip() != 'virtqemud':
        raise RuntimeError('not-own-session-daemon')
    return (p / 'stat').read_text().rsplit(')', 1)[1].split()[19]


def stop(_sig, _frame):
    raise SystemExit(0)


def main():
    target = Path(sys.argv[1])
    def snapshot_table():
        def child_limit():
            _, hard = resource.getrlimit(resource.RLIMIT_MEMLOCK)
            resource.setrlimit(resource.RLIMIT_MEMLOCK, (0, hard))
        return subprocess.check_output(['qemu-img', 'snapshot', '-l', sys.argv[2]],
                                       text=True, timeout=15, preexec_fn=child_limit)
    data = {'ready': False, 'restored': False}
    daemon = original = started = None
    hold = None
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    def save():
        tmp = target.with_suffix('.tmp')
        tmp.write_text(json.dumps(data, indent=2) + '\n')
        tmp.replace(target)
    try:
        # An open stdin keeps the interactive connection alive across daemon idle timeout.
        hold = subprocess.Popen(['virsh', '-c', 'qemu:///session'], stdin=subprocess.PIPE,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        hold.stdin.write(b'uri\n')
        hold.stdin.flush()
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            candidates = []
            for p in Path('/proc').iterdir():
                if not p.name.isdigit():
                    continue
                try:
                    stamp = identity(int(p.name))
                    args = (p / 'cmdline').read_bytes().split(b'\0')
                    if b'--timeout=120' in args:
                        candidates.append((int(p.name), stamp))
                except (OSError, RuntimeError, IndexError):
                    pass
            if len(candidates) == 1:
                daemon, started = candidates[0]
                break
            time.sleep(.1)
        if daemon is None or hold.poll() is not None:
            raise RuntimeError('session-daemon-not-unique')
        original = resource.prlimit(daemon, resource.RLIMIT_MEMLOCK)
        data.update(pid=daemon, start=started, original=list(original), changed=False)
        # Only the evidenced 8 MiB nova condition; never touch another limit pattern.
        if original == (8388608, 8388608):
            resource.prlimit(daemon, resource.RLIMIT_MEMLOCK, (0, original[1]))
            data['changed'] = True
        elif original[0] != 0:
            raise RuntimeError('unrecognized-memlock-condition')
        if identity(daemon) != started:
            raise RuntimeError('daemon-replaced')
        data.update(applied=list(resource.prlimit(daemon, resource.RLIMIT_MEMLOCK)),
                    snapshotsBefore=snapshot_table(), ready=True)
        save()
        while True:
            time.sleep(1)
            if hold.poll() is not None or identity(daemon) != started:
                raise RuntimeError('daemon-hold-lost')
    finally:
        data['ready'] = False
        try:
            data['snapshotsAfter'] = snapshot_table()
            data['snapshotsUnchanged'] = data.get('snapshotsBefore') == data['snapshotsAfter']
        except (OSError, subprocess.SubprocessError):
            data['snapshotsUnchanged'] = False
        try:
            if original is not None and identity(daemon) == started:
                resource.prlimit(daemon, resource.RLIMIT_MEMLOCK, original)
                data['restored'] = resource.prlimit(daemon, resource.RLIMIT_MEMLOCK) == original
            else:
                data['restoreReason'] = 'daemon-identity-unavailable'
        except (OSError, RuntimeError):
            data['restoreReason'] = 'original-daemon-exited-no-replacement-touched'
        if hold is not None:
            hold.stdin.close()
            try:
                hold.wait(timeout=5)
            except subprocess.TimeoutExpired:
                hold.terminate()
                hold.wait(timeout=5)
        save()


if __name__ == '__main__':
    main()
