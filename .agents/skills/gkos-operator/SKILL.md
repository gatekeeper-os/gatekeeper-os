---
name: gkos-operator
description: Runbook for installing, operating, updating, and rolling back GatekeeperOS cells. Load when asked to install, upgrade, roll back, troubleshoot, or check the health of an GatekeeperOS deployment.
---

# Operating GatekeeperOS

Full reference: `docs/implementation-plan.md` §10–11. Details in `references/upgrade-and-rollback.md` and `references/troubleshooting.md`.

## Install
`curl -fsSL …/installer/install.sh | bash` (or `./installer/install.sh` from a clone) → `openclaw onboard` → channel login and
pairing → `gkos operator add` → `gkos blueprint apply <bp> --agent <id>` → `gkos gatekeeper add|connect <vendor>` →
introduce resources by pasting URLs in chat or `gkos grant add`.

## Daily
`gkos status` · `gkos approvals list` (or `/approvals` in chat) → apply/reject · `gkos audit tail --since 24h`.

## Update
`gkos update --check` → `gkos update --to <version>` → `gkos status` → `openclaw security audit`. On trouble: `gkos rollback`.
Never `openclaw update` directly on an OS-managed cell (the OS pins the version and runs conformance first).

## Troubleshoot
`gkos doctor` first. Plugin not loading → `openclaw plugins inspect gkos-kernel --runtime --json` → `openclaw gateway restart`.
Config rejected (`config reload skipped (invalid config)`) → `openclaw doctor --fix` → `gkos config apply`. Gate hook timeouts →
`gkos gatekeeper health <vendor>`.
