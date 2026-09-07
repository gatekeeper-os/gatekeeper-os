#!/usr/bin/env bash
# Disposable, per-worktree libvirt VM. No host installs or production Gateway access.
LV_URI="${CLAWOS_LIBVIRT_URI:-qemu:///session}"
LV_PORT="${CLAWOS_VM_SSH_PORT:-22240}"
LV_DISK="$STATE_DIR/tester.qcow2"
LV_KEY="$STATE_DIR/ssh-key"
lv() { virsh -c "$LV_URI" "$@"; }
lv_ssh() { ssh -F /dev/null -i "$LV_KEY" -p "$LV_PORT" -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$STATE_DIR/known_hosts" "$VM_USER@127.0.0.1" "$@"; }
lv_wait() {
  local deadline=$((SECONDS+300))
  until lv_ssh true 2>/dev/null; do
    (( SECONDS < deadline )) || vm_die 'VM SSH did not become ready within 300s'
    sleep 2
  done
}
lv_owned() {
  lv dumpxml "$VM_NAME" | python3 -c 'import sys,xml.etree.ElementTree as E; root=E.parse(sys.stdin); expected=sys.argv[1]; paths=[x.get("file") for x in root.findall("./devices/disk/source")]; sys.exit(0 if expected in paths else 1)' "$LV_DISK" || vm_die 'VM is not owned by this worktree'
}
lv_up() {
  if lv dominfo "$VM_NAME" >/dev/null 2>&1; then
    lv_owned
    lv start "$VM_NAME" 2>/dev/null || true
    lv_wait
    return
  fi
  for cmd in virsh virt-install qemu-img curl python3 ssh-keygen; do command -v "$cmd" >/dev/null || vm_die "missing $cmd"; done
  [ -e "$LV_DISK" ] && vm_die 'unregistered VM disk exists; inspect before reuse'
  if ss -H -tln "sport = :$LV_PORT" | rg -q .; then vm_die "SSH port $LV_PORT is occupied"; fi
  umask 077
  local image="$STATE_DIR/noble-server-cloudimg-amd64.img"
  [ -f "$image" ] || curl -fL --retry 2 -o "$image" https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
  curl -fsSL -o "$STATE_DIR/SHA256SUMS" https://cloud-images.ubuntu.com/noble/current/SHA256SUMS
  (cd "$STATE_DIR" && rg ' noble-server-cloudimg-amd64.img$|\*noble-server-cloudimg-amd64.img$' SHA256SUMS | sha256sum -c -)
  qemu-img create -f qcow2 -F qcow2 -b "$image" "$LV_DISK" 24G
  [ -f "$LV_KEY" ] || ssh-keygen -q -t ed25519 -N '' -f "$LV_KEY"
  python3 - "$REPO_ROOT/scripts/vm/cloud-init.yaml" "$LV_KEY.pub" "$STATE_DIR/user-data" <<'PY'
import pathlib,sys
source,key,target=map(pathlib.Path,sys.argv[1:])
s=source.read_text().replace('    lock_passwd: true','    lock_passwd: true\n    ssh_authorized_keys:\n      - '+key.read_text().strip())
pathlib.Path(target).write_text(s)
PY
  printf "instance-id: %s\nlocal-hostname: %s\n" "$VM_NAME" "$VM_NAME" > "$STATE_DIR/meta-data"
  virt-install --connect "$LV_URI" --name "$VM_NAME" --memory 4096 --vcpus 2 --cpu host-passthrough \
    --import --osinfo ubuntu24.04 --boot hd --disk "$LV_DISK,format=qcow2,bus=virtio" \
    --cloud-init "user-data=$STATE_DIR/user-data,meta-data=$STATE_DIR/meta-data,disable=on" --graphics none --network none \
    --qemu-commandline="-netdev user,id=clawosnet,hostfwd=tcp:127.0.0.1:$LV_PORT-:22 -device virtio-net-pci,netdev=clawosnet,bus=pcie.0,addr=0x1e" \
    --serial "file,path=$STATE_DIR/console.log" --noautoconsole
  lv_wait
}
lv_exec() { lv_owned; lv_ssh "bash -lc $(printf %q "$1")"; }
lv_sync() {
  lv_owned
  local transport="ssh -F /dev/null -i $LV_KEY -p $LV_PORT -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$STATE_DIR/known_hosts"
  rsync -az --delete -e "$transport" --exclude node_modules --exclude .git --exclude dist --exclude vm-artifacts \
    --exclude 'scripts/vm/.state' --exclude 'scripts/vm/secrets.env' "$REPO_ROOT/" "$VM_USER@127.0.0.1:$VM_SRC/"
}
lv_shutdown() {
  lv_owned
  lv shutdown "$VM_NAME"
  local deadline=$((SECONDS+90))
  until [ "$(lv domstate "$VM_NAME")" = 'shut off' ]; do
    (( SECONDS < deadline )) || vm_die 'VM did not shut down cleanly; no forced power-off'
    sleep 2
  done
}
lv_snapshot() {
  lv_owned
  if lv snapshot-info "$VM_NAME" "$1" >/dev/null 2>&1; then vm_die "immutable snapshot '$1' already exists"; fi
  lv_shutdown
  lv snapshot-create-as "$VM_NAME" "$1" --description 'OpenClaw OS acceptance baseline' --atomic
  lv start "$VM_NAME"
  lv_wait
}
lv_reset() {
  lv_owned
  lv snapshot-info "$VM_NAME" "$1" >/dev/null
  lv_shutdown
  lv snapshot-revert "$VM_NAME" "$1"
  lv start "$VM_NAME"
  lv_wait
}
lv_pull() {
  lv_owned
  rsync -az -e "ssh -F /dev/null -i $LV_KEY -p $LV_PORT -o BatchMode=yes -o UserKnownHostsFile=$STATE_DIR/known_hosts" "$VM_USER@127.0.0.1:$1" "$2"
}
