# OpenClaw OS

An operating-system layer over upstream [OpenClaw](https://github.com/openclaw/openclaw) — unmodified and pinned — modeled on
[Cloudflare OS](https://github.com/cloudflare/cloudflare-os) and its **gatekeeper** concept.

OpenClaw OS adds to a bare OpenClaw Gateway: a **capability model** (agents start with access to nothing; resources are
*introduced* by URL), **gatekeepers** (drivers that log every read, queue every write for approval, and *simulate* the
effect so the agent keeps working while a human approves later), **cells** (one Gateway per trust boundary),
**blueprints** (versioned agent templates), and a **pinned, verified, roll-back-able update pipeline** for upstream.

This repository is a scaffold generated from the implementation plan in `docs/implementation-plan.md`. Every file with a
`TODO(phase-N)` marker is filled in during that phase. Start with `AGENTS.md`, then `docs/README.md`.

## Layout

| Path | Role (plan §8) |
|---|---|
| `packages/clawos-shared` | contracts: Gatekeeper, ApprovalQueue, Grant (plan §4.3) — kernel bar |
| `packages/clawos-kernel` | the kernel plugin: capability store, policy hooks, approvals, audit, `os.*` RPC, CLI (plan §5) — kernel bar |
| `packages/gatekeeper-kit` | `defineGatekeeper()`, OAuth nonce machine, token store, simulation overlay |
| `packages/gatekeeper-github` | reference driver |
| `packages/gatekeeper-fs` | scoped host-directory driver (first driver built, Phase 3) |
| `packages/gatekeeper-mcp`, `packages/gatekeeper-http` | v1.1 drivers (placeholders) |
| `packages/clawos-cli` | the `clawos` binary: install, cell, update, rollback, backup, config apply, blueprint |
| `packages/clawos-blueprints` | `assistant`, `coder`, `ops`, `researcher` |
| `packages/clawos-conformance` | suite run against a live Gateway; the definition of "compatible" |
| `config/config.d` | config-fragment templates copied to `<stateDir>/os/config.d` at install |
| `installer/` | `install.sh`, `preflight.sh`, systemd drop-in template |
| `scripts/vm` | VM lifecycle wrappers (see `docs/vm-testing.md`) |
| `test/` | per-phase acceptance scripts executed inside the VM |
| `docs/`, `plans/`, `.agents/skills/` | plan, references, progress, agent skills |

## Quick start (development host)

```bash
corepack enable && pnpm install
pnpm build && pnpm test
scripts/vm/up.sh            # create the test VM and snapshot "base"
scripts/vm/test.sh phase-0  # run Phase 0 acceptance inside the VM
```

Upstream pin: see `clawos.lock.json`. Never edit upstream; see `AGENTS.md` INVARIANT 1.
