#!/usr/bin/env bash
# Usage: scripts/vm/reset.sh <snapshot>    (base | installed | connected)
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
snap="${1:?snapshot name}"
vm_call reset "$snap"
echo "$snap" > "$STATE_DIR/last-reset"
vm_log "restored '$snap'"
