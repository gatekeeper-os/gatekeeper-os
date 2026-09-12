# Update and rollback

Phase 7 implementation is under review. **This is not beta acceptance.** The full live
conformance adapter depends on outstanding acceptance work; compatibility smoke is insufficient.

## Check availability

```sh
clawos update --check --cell default
clawos update --check --json --channel beta
```

This reads the selected cell's pin and installed plugin metadata, resolves one npm release,
and reports compatibility. It does not stop a service or mutate state. Unsupported plugins
produce nonzero status. The command never widens ranges or changes the repository lock.
Schedule this read-only command with scheduler-owned delivery to an operator-selected target;
no automatic outbound destination is configured by this implementation.

## Update

```sh
clawos update --to <exact-version> --conformance /absolute/reviewed-live-runner.mjs --yes
```

Linux/systemd only. The adapter runs with explicit fresh `OPENCLAW_STATE_DIR` and
`OPENCLAW_CONFIG_PATH`. It receives `CLAWOS_UPDATE_BINARY`, `CLAWOS_UPDATE_TARGET`,
`CLAWOS_UPDATE_RUN_ID`, and `CLAWOS_UPDATE_VERDICT`. It must construct an isolated test
configuration, run actual required suites against that exact binary, and write a run-bound
`live-conformance` report with `fullConformance:true`. Missing, skipped, stale, synthetic or
smoke-only evidence blocks activation. Treat this adapter as trusted operator code, not an
agent-provided executable. No stock passing adapter is supplied while full gates are open.

The nine steps and recovery semantics are in implementation-plan §6.4. Updates stage
private per-cell runtimes; the original global installation is unchanged. CLI cell operations
use the lock's verified `runtimeBinary`; shell `openclaw --version` may still show the original
global runtime. Use `clawos kernel status` and the cell lock/journal, not the shell global version.
Do not run the original upstream command directly against a newer cell's state.

## Recovery

```sh
clawos rollback --yes --cell default
clawos kernel status --cell default
```

The journal survives process termination and state restoration. The retained old runtime
verifies/extracts the backup against an empty scratch state before live state is moved.
Failed state is retained with a `.failed-update-*` suffix. Recovery restores the OS drop-in
and the previous pin, verifies grants and schema, then removes maintenance. If recovery fails,
maintenance stays closed and the journal says `recovery-required`—do not delete the archives.

Rollback refuses changed schema, changed operator config, and post-commit grant changes.
This prevents a stale archive from reactivating revoked capabilities. Use a reviewed recovery
procedure when current state has diverged; no force flag disables these checks.

## Evidence limits

The disposable `runtime-checkpoint` starts from `installed`, creates an actual local filesystem
grant without credentials, and tests real runtime staging/activation/rollback. It deliberately
substitutes a narrow real-Gateway probe at step five **in the test harness only**. The probe
reports `fullConformance:false`, is rejected by production CLI conformance validation, and
cannot close Phase 7 acceptance. The ordinary full phase command fails closed pending full
conformance. No personal-credential or `connected` snapshot is created.

The nightly workflow also runs transaction/evidence-contract regression tests in a separate
job. They are unit tests, not version-specific full conformance. The full nightly update
matrix remains pending; current compatibility smoke keeps its original scope label.

A source-installer rerun on a per-cell updated runtime is refused, avoiding accidental
reversion to the source bundle's old pin. A successfully committed but paused cell may be
resumed by an authenticated administrator with `clawos kernel maintenance off`, after
reviewing the committed journal and healthy exact runtime. This does not bypass conformance.
