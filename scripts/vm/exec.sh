#!/usr/bin/env bash
# Usage: scripts/vm/exec.sh 'bash -lc "…"'   — runs as $VM_USER inside the VM.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
vm_call exec "${1:?command}"
