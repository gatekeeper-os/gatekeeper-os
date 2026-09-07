# @clawos/cli — `clawos`

Host-side orchestrator (plan §3.2, §5.5). Shells out to `openclaw` for anything upstream already does; talks to the kernel
over the Gateway WebSocket (`os.*`) for capability operations; owns host-only concerns.

```
clawos install [--cell <name>] [--yes] [--json]        clawos cell create|list|remove
clawos status [--json]        clawos doctor              clawos config apply [--dry-run] [--json]
clawos update [--to <v>|--channel <c>] [--check] [--dry-run] [--yes]     clawos rollback
clawos backup create|restore  clawos operator add        clawos gatekeeper add|connect|health
clawos grant add|list|revoke  clawos approvals list|apply|reject|revert   clawos audit tail|query
clawos blueprint list|apply|diff|lint                    clawos adopt      clawos uninstall
clawos dev install-plugins --from <tree>   (test helper: installs kernel + gatekeepers from a working tree)
```
Every command accepts `--cell <name>` and `--json`. Commands are idempotent and check their postcondition first.
