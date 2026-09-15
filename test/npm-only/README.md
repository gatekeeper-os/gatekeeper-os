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
the existing catalog; it does not replace the real fs vendor. The approvals mode adds only catalog-derived
messaging admission for that plugin, with all native denials unchanged.

**Limitations remain:** real filesystem action application is disabled in this beta.
Its `os.approvals.apply` path must refuse and keep the host file unchanged. Successful
apply/reject evidence comes only from the explicitly synthetic driver and does not
establish filesystem writes, real channel transport, or full production readiness.

## beta.5 acceptance target (prepared, not run)

Rebased onto the beta.5 release candidate after core PR #25. Install commands and
registry receipts require exactly @gatekeeper-os/*@0.1.0-beta.5. Beta.5 must be
published with all five consistent listings/tags and verified archives before an
explicitly authorized VM invocation. Preparation did not run acceptance.

The independent approval fixture declares its own exact `contracts.tools`.
After adding it to the existing catalog, fixture config obtains messaging policy
from the **installed CLI's** `mergeFragments()` export. A fail-closed comparator
permits only the derived fixture plugin ID; any changed denial, runtime setting,
profile, unrelated allowance, or removed retained plugin fails. No hand-authored
tool allowance and no product code is transferred. This is catalog-policy preview
coverage; it does not claim the config-apply command ran at this fixture step.

Preserve all prior failed runs. Beta.4 invocation 1 remains a fixture failure;
invocation 2 remains a product hard stop. Neither is reclassified by this rebase.
Any future product behavior failure is an immediate hard stop; harness-only repairs
belong between completed runs. No third beta.4 invocation, beta.5 VM invocation,
community Tier 1 lock regeneration, or acceptance/harness merge is authorized by
this preparation.
