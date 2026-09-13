# npm-only acceptance fixtures

These files are **test-only**, staged without a repository checkout into
`/home/tester/npm-acceptance`. They import the installed upstream public SDK and
registry packages only. They never bundle a product implementation.

Run through the host VM harness and its `phase-3-npm-only` runner, not directly on a
workstation. The runner creates a real `kernel-test` messaging cell first, installs
exact beta registry versions, exports its canonical cell token in process memory,
and supplies `GKOS_UPSTREAM_PACKAGE_JSON`, `GKOS_SCENARIO_RUN`, and
`GKOS_SCENARIO_REPORT`. Gateway port is 19100; synthetic model port is 19101.
Restart the Gateway after every fixture config mode.

- `config.mjs normal`, `kernel-scenarios.mjs normal`: retained registry kernel/fs,
  live model turns, native messaging denials, grants and read/overlay/reject paths.
- `config.mjs no-hooks`, `kernel-scenarios.mjs no-hooks`: same scenario report;
  capability policy still refuses unknown grants without conversation hooks.
- `conformance.mjs <verdict-path>` checks the exact 38 selected Phase 3 live
  assertions in `selected-checks.json`, with same-run/failed-evidence refusal.
- `config.mjs owner`, `channel-scenarios.mjs`: separate report, fresh audience
  agents, synthetic public-SDK channel dispatch, actual owner/private/group
  authority and denied egress. This is not real Slack transport acceptance.
- `config.mjs approvals`, `approval-scenarios.mjs`: separate report, additional
  synthetic `gkos-gatekeeper-fixture` vendor built on published gatekeeper-kit, actual
  published kernel apply/reject RPC decisions, and fixed local effect receipts.
  The real registry filesystem plugin remains loaded and unchanged.

The config fixture preserves global tools policy, default sandbox, token SecretRef,
install-policy command/config, product plugin paths, and first-party catalog entries.
Fixture agents use the messaging assistant blueprint's `sandbox.mode: off`; global
native fs/runtime/automation/browser denial remains unchanged and is checked on
actual model tool lists. Only the synthetic approvals mode appends a test vendor to
the existing catalog; it does not replace the real fs vendor.

**Limitations remain:** real filesystem action application is disabled in this beta.
Its `os.approvals.apply` path must refuse and keep the host file unchanged. Successful
apply/reject evidence comes only from the explicitly synthetic driver and does not
establish filesystem writes, real channel transport, or full production readiness.
