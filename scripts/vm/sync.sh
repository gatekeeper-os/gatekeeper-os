#!/usr/bin/env bash
# rsync the working tree into the VM at $VM_SRC (excluding node_modules, .git, dist, vm-artifacts, secrets).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
vm_call sync
vm_log "synced to $VM_SRC"
