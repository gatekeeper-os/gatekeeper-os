# @gatekeeper-os/gatekeeper-kit

GatekeeperOS is an independent project. It is not affiliated with or endorsed by the OpenClaw Foundation. OpenClaw is a trademark of its owner.

Security-critical helpers for gatekeeper authors. Start with [SKELETON.md](SKELETON.md).

Includes the validated lifecycle builder, two-stage OAuth nonces, encrypted account storage with refresh coalescing,
persistent simulation stores, action sequencing, a resource-session base class, fixed-message error sanitization, and
an offline test queue. Kernel authorization and execution remain kernel-owned; the kit registers exact manifest-declared upstream wrappers under each driver's identity.

Two entry points (since 0.1.0-beta.6). The root `@gatekeeper-os/gatekeeper-kit` entry is driver-safe and never imports
`openclaw`: a gatekeeper's `src/driver.ts` exports `defineGatekeeperDriver({...})`, and the kernel loads that module
directly from `gkos.gatekeeper.driver` in the plugin manifest. `@gatekeeper-os/gatekeeper-kit/plugin` provides
`defineGatekeeper`; the plugin entry `src/index.ts` is `export default defineGatekeeper(driver)`. Build both entries
(`tsup src/index.ts src/driver.ts`). `gatekeeperRuntimeSlot`, `kernelToolRuntimeSlot` and `GatekeeperRuntime` were removed.

Phase 2 acceptance is library-only: `scripts/vm/test.sh phase-2`. No Gateway, external API, or production state is used.
See the skeleton's ordering/recovery section for single-writer ownership, uncertain-action handling and sync approval binding.

### Per-gatekeeper tool ownership

See [pinned registration diagnosis and catalog reconciliation](../../docs/gatekeeper-tool-ownership.md). Each driver
manifest declares its exact tools. The kit owns upstream wrappers; kernel grant
checks still gate every execution. `gkos config apply` adds/removes enabled catalog
plugin IDs in messaging policies (including messaging agents). Native denials,
explicit runtime allowlists, and sandbox settings remain unchanged. Blueprint
application does not install gatekeepers or create grants.

## Distribution

This README ships with `@gatekeeper-os/gatekeeper-kit@0.1.0-beta.6`; `beta` selects the newest beta (no stable release). For cell installation use `npm install --global @gatekeeper-os/cli@beta` on a disposable evaluation machine, then follow the [CLI instructions](../gkos-cli/README.md).
