# Contributing

OpenClaw OS is licensed under the [MIT License](LICENSE). Contributions are
welcome under the same license.

## Development

Use the Node version in `.node-version` and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm check:catalog
pnpm check:secrets
```

Read [the architecture and implementation plan](docs/implementation-plan.md)
and [agent operating rules](docs/agent-operating-rules.md) before changing
capability boundaries. Work on a branch or isolated Git worktree. Keep changes
focused and include meaningful regression coverage.

Runtime acceptance must use the disposable-machine harness described in
[VM testing](docs/vm-testing.md). Do not run the installer or update/rollback
acceptance against your everyday Gateway. Every development OpenClaw invocation
must explicitly select isolated state and config paths.

## Pull requests

Explain the user-visible change, affected security boundaries, and commands you
ran. Include acceptance artifact references for runtime changes; distinguish
passing, failing, skipped, and unrun checks. Never commit tokens, private keys,
VM images, production configuration, or raw conversation data.

Import upstream integrations only through documented `openclaw/plugin-sdk/*`
exports. Do not patch, vendor, fork, or inspect upstream databases to implement
an integration. Add verified SDK/API contracts to `docs/upstream-reference.md`.

For a vulnerability, follow [SECURITY.md](SECURITY.md), not a public issue.
