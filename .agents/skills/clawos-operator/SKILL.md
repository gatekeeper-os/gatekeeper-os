---
name: clawos-operator
description: Runbook for installing, operating, updating, and rolling back OpenClaw OS cells. Load when asked to install, upgrade, roll back, troubleshoot, or check the health of an OpenClaw OS deployment.
---

# Operating OpenClaw OS

Full reference: `docs/implementation-plan.md` §10–11. Details in `references/upgrade-and-rollback.md` and `references/troubleshooting.md`.

## Install
`curl -fsSL …/installer/install.sh | bash` (or `./installer/install.sh` from a clone) → `openclaw onboard` → channel login and
pairing → `clawos operator add` → `clawos blueprint apply <bp> --agent <id>` → `clawos gatekeeper add|connect <vendor>` →
introduce resources by pasting URLs in chat or `clawos grant add`.

## Daily
`clawos status` · `clawos approvals list` (or `/approvals` in chat) → apply/reject · `clawos audit tail --since 24h`.

## Update
`clawos update --check` → `clawos update --to <version>` → `clawos status` → `openclaw security audit`. On trouble: `clawos rollback`.
Never `openclaw update` directly on an OS-managed cell (the OS pins the version and runs conformance first).

## Troubleshoot
`clawos doctor` first. Plugin not loading → `openclaw plugins inspect clawos-kernel --runtime --json` → `openclaw gateway restart`.
Config rejected (`config reload skipped (invalid config)`) → `openclaw doctor --fix` → `clawos config apply`. Gate hook timeouts →
`clawos gatekeeper health <vendor>`.
