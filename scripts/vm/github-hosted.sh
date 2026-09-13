# Fresh GitHub-hosted macOS VM adapter. A new Actions job is the base reset; never reuse it.
ghvm_guard() {
  [ "${GITHUB_ACTIONS:-}" = true ] && [ "${RUNNER_ENVIRONMENT:-}" = github-hosted ] \
    && [ "$(uname -s)" = Darwin ] && [ "${GITHUB_WORKSPACE:-}" = "$REPO_ROOT" ] \
    && [ -n "${RUNNER_TEMP:-}" ] || vm_die 'github-hosted driver requires a fresh GitHub macOS runner'
}
ghvm_reset() {
  ghvm_guard
  [ "$1" = base ] || vm_die 'hosted runner supports only the fresh base image'
  [ ! -e "$RUNNER_TEMP/gkos-acceptance-used" ] && [ ! -e "$HOME/.openclaw" ] \
    && [ ! -e "$HOME/.openclaw-firma" ] || vm_die 'runner is not a fresh cell-free base'
  touch "$RUNNER_TEMP/gkos-acceptance-used"
  vm_log "fresh hosted image: ${ImageOS:-macOS} ${ImageVersion:-unknown}"
}
ghvm_sync() { ghvm_guard; [ "$VM_SRC" = "$REPO_ROOT" ] || vm_die 'hosted source must be the checkout'; }
ghvm_exec() { ghvm_guard; bash -c "$1"; }
ghvm_pull() {
  ghvm_guard
  [ "$1" = /home/tester/phase-1-evidence/ ] || vm_die 'unexpected hosted artifact source'
  rsync -a "$HOME/phase-1-evidence/" "$2/"
}
ghvm_snapshot() { vm_die 'hosted VMs are disposed after each job; no reusable snapshot'; }
