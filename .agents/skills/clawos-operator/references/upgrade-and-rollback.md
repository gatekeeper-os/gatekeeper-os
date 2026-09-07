# Upgrade and rollback

The nine-step pipeline (`docs/implementation-plan.md` §6.4): resolve target → compat preflight → record rollback point (backup +
`os/` tar) → stage into `os/staging/npm-prefix` → conformance on a throwaway cell → maintenance window → activate + `clawos config
apply` + `doctor --fix` + restart → verify (`/readyz`, plugins, `os.status`, security audit delta, smoke observation) → commit or
`clawos rollback`. Rollback is refused only if the kernel schema advanced — which cannot happen before step 9 commits the pin.
TODO(phase-7): fill with the real command transcripts from test/phase-7.sh.
