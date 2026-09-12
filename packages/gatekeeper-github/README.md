# @clawkeepers/gatekeeper-github

Reference driver (Phase 4). Resources `repo`, `issue`, `pull` with the same URL patterns as cloudflare-os. Observer strategy B
(`hasRepoAccess`: 403/404 → false, other errors → throw). Simulation: overlay-at-read for all four actions. Revert: delete
comment / close issue. Auth: GitHub Device Flow preferred (works on loopback-bound gateways); web OAuth via the kernel's
`/os/gatekeeper/github/oauth/*` route; PAT via `clawos gatekeeper connect github --pat-env` for CI only.

Authoring follows `.agents/skills/write-gatekeeper/SKILL.md` — STOP 1 (tool surface review) before implementing `src/*.ts`.
