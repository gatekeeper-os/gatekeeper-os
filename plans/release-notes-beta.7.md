Installed-cell filesystem gatekeeper fix; OpenClaw pin 2026.9.9 (Node 24.16+); OpenClaw 2026.10.1 support

**Installed cells can load the filesystem gatekeeper again.** Since beta.6 the kernel imports each gatekeeper's
manifest-declared driver (`dist/driver.js`), but the CLI's plugin staging bundled only `dist/index.js`. Every cell
created by the installer or by `@gatekeeper-os/cli@0.1.0-beta.6` logged `gatekeeper fs unavailable`, on any OpenClaw
version. Staging now bundles the declared driver and fails the build if it is missing. Upgrade existing beta.6 cells
by reinstalling the CLI and re-running `gkos install` (or `gkos cell create` for new cells).

**Kernel `os_*` tools are offered directly.** With Tool Search at its OpenClaw 2026.9.9 default and a 2026.9.9 client,
`os_list_grants` and `os_request_access` were reachable only through the Tool Search catalog, which broke no-grant
narrowing. They are now `catalogMode: "direct-only"`, like the granted `gk_*` wrappers.

**OpenClaw.** The upstream pin moves from 2026.9.2 to 2026.9.9; the declared range stays `>=2026.9.2 <2026.11.0`.
OpenClaw 2026.9.9 requires Node `>=24.16.0 <25 || >=26.1.0`, so the installer now requires Node 24.16+ (or 26.1+).
Package `engines` stay `>=22.22.3` for the 2026.9.2 floor. OpenClaw 2026.10.1 removed the
`openclaw/plugin-sdk/command-auth` subpath; the kernel now imports from `command-auth-native` and loads on every
release from 2026.9.2 through 2026.10.1.

**Kernel declarations.** `@gatekeeper-os/kernel`'s `index.d.ts` now references the public SDK type. beta.6 shipped
inlined upstream-internal types with relative imports that do not exist in the package.

Five release packages and all internal dependency pins move to 0.1.0-beta.7. The kernel schema is unchanged.

Evidence before publication: VM fresh-base `phase-1` 25/25 on the 2026.9.9 pin (`20261010-224746-phase-1`), against
the same nine failures on beta.6 code with either pin; `phase-3 kernel-live` 104/104 on snapshot `installed-2026-9-9`
(`20261010-230617-phase-3`, and `20261011-010033-phase-3` with the 2026.10.1 changes). Hosted conformance matrix: the
15-check live smoke, which includes a stub-model granted tool call, passes on 2026.9.2, 2026.9.9 and 2026.10.1. The
10-turn packed model gate passes on the same three releases. npm-only acceptance of the published beta.7 follows
publication. Real connected-provider and chat-transport acceptance are not established. Installing from the Control
UI Plugins page is not yet supported (the kernel needs the gatekeeper catalog that `gkos` writes); that is planned
for beta.8.
