# REVIEW.md — review priority, highest first

1. **The kernel bar** (`packages/gkos-kernel`, `packages/gkos-shared`): read every line; reject undocumented exports,
   parallel mechanisms where an upstream one exists, and `as unknown as` across boundaries.
2. **Capability-security invariants**: any new path that resolves a grant, opens a gatekeeper session, registers a `gk_*`
   tool, or introduces a resource must go through `Kernel.resolveGrant()` / the registry. Flag any tool registration that bypasses the kit wrapper, or any wrapper that does not delegate to the kernel runtime.
   Flag any gatekeeper that asserts ambience. Check that gate hooks fail closed and finish well under 15 s.
3. **Secret leakage** through logs, audit records, tool results, error strings, artifacts. `pnpm check:secrets` must pass;
   vendor errors go through `sanitizeError()`.
4. **Upstream-coupling creep**: every new SDK subpath, config key, CLI flag, hook name, or env var must appear in
   `docs/upstream-reference.md` with a VERIFIED source, and SDK imports must stay inside `src/upstream/`.
5. Everything else (style, naming, performance).

Client-supplied identity values are diagnostic labels only — never inputs to a decision.
