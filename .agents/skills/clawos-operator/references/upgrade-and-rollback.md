# Upgrade and rollback

Read `docs/updating.md` for the implemented command contract and evidence limits.

1. Run `clawos update --check --cell <name>`; review the exact target and every plugin range.
2. Full live conformance is mandatory: `clawos update --to <version> --conformance
   /absolute/reviewed-live-runner.mjs --cell <name> --yes`. Do not pass a smoke probe or
   construct a passing JSON fixture. No fully accepted stock adapter exists yet.
3. Verify the nine recorded steps and `clawos kernel status`. The shell-global OpenClaw
   version is not the cell runtime: immutable per-cell runtimes are selected by a drop-in.
4. On interrupted activation use `clawos rollback --cell <name> --yes`; preserve the journal,
   archives and failed state if recovery is refused. Never reset the pin manually.
5. Do not remove maintenance or force an archive over newer config/revoked grants. Never
   run an older binary against candidate-migrated live state before restoration.

Run phase acceptance only through `scripts/vm/test.sh`; `phase-7 installed runtime-checkpoint`
is reduced runtime evidence, not the connected full-conformance release gate. No phase tag,
merge, release, schema bump, automatic cron delivery or upstream patch is authorized by this runbook.
