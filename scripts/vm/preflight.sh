#!/usr/bin/env bash
# Sourced by test.sh. No host config edits, daemon restarts, or snapshot creation.
vm_preflight_pid=''
vm_test_cleanup() {
  local rc=$? cleanup_rc=0
  trap - EXIT INT TERM
  if [ "$DRIVER" = libvirt ] && [ -n "$vm_preflight_pid" ]; then
    # Guest OS shutdown, never forced off; keep the daemon held until collection ends.
    if [ "$(lv domstate "$VM_NAME")" != 'shut off' ]; then
      lv_ssh 'sudo -n poweroff' >/dev/null 2>&1 || true
      local deadline=$((SECONDS+90))
      while [ "$(lv domstate "$VM_NAME")" != 'shut off' ]; do
        if ((SECONDS>=deadline)); then cleanup_rc=98; break; fi
        sleep 2
      done
    fi
    kill -TERM "$vm_preflight_pid" 2>/dev/null || true
    wait "$vm_preflight_pid" || cleanup_rc=98
    python3 -c 'import json,sys; r=json.load(open(sys.argv[1]));sys.exit(0 if r.get("restored") and r.get("snapshotsUnchanged") else 1)' "$out/libvirt-preflight.json" || cleanup_rc=98
  fi
  if [ "$cleanup_rc" != 0 ]; then rc=$cleanup_rc; fi
  printf '%s\n' "$rc" > "$out/exit-code"
  exit "$rc"
}
vm_test_preflight() {
  [ "$DRIVER" = libvirt ] || return 0
  [ "$LV_URI" = qemu:///session ] || vm_die 'automatic preflight requires session libvirt'
  exec 9>"$STATE_DIR/acceptance.lock"
  flock -n 9 || vm_die 'another acceptance run owns this VM'
  lv_owned
  [ "$(lv domstate "$VM_NAME")" = 'shut off' ] || vm_die 'preflight requires stopped VM'
  trap vm_test_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  python3 "$REPO_ROOT/scripts/vm/libvirt-preflight.py" "$out/libvirt-preflight.json" "$LV_DISK" > "$out/libvirt-preflight.log" 2>&1 &
  vm_preflight_pid=$!
  local deadline=$((SECONDS+20))
  until [ -f "$out/libvirt-preflight.json" ] && python3 -c 'import json,sys;sys.exit(0 if json.load(open(sys.argv[1])).get("ready") else 1)' "$out/libvirt-preflight.json"; do
    kill -0 "$vm_preflight_pid" 2>/dev/null || vm_die 'libvirt preflight failed'
    ((SECONDS<deadline)) || vm_die 'libvirt preflight timed out'
    sleep 1
  done
  # Re-register only operator-supplied original metadata if registration is absent.
  if ! lv snapshot-info "$VM_NAME" "$snap" >/dev/null 2>&1; then
    local xml="${GKOS_VM_SNAPSHOT_XML_DIR:?original snapshot XML directory required}/$snap.original.xml"
    python3 - "$xml" "$snap" "$LV_DISK" <<'PY'
import sys,xml.etree.ElementTree as E
root=E.parse(sys.argv[1]).getroot()
assert root.findtext('name') == sys.argv[2]
assert sys.argv[3] in [x.get('file') for x in root.findall('./domain/devices/disk/source')]
PY
    sha256sum "$xml" > "$out/snapshot-registration-sha256"
    lv snapshot-create "$VM_NAME" "$xml" --redefine
  fi
  vm_log 'session daemon held; transient MEMLOCK active; EXIT trap restores it'
}
