# @gatekeeper-os/gatekeeper-kit

GatekeeperOS is an independent project. It is not affiliated with or endorsed by the OpenClaw Foundation. OpenClaw is a trademark of its owner.

Security-critical helpers for gatekeeper authors. Start with [SKELETON.md](SKELETON.md).

Includes the validated lifecycle builder, two-stage OAuth nonces, encrypted account storage with refresh coalescing,
persistent simulation stores, action sequencing, a resource-session base class, fixed-message error sanitization, and
an offline test queue. Kernel authorization and execution remain kernel-owned; the kit registers exact manifest-declared upstream wrappers under each driver's identity.

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

`@gatekeeper-os/gatekeeper-kit@0.1.0-beta.5` is published; `beta` and `latest` select it (no stable release). For cell installation use `npm install --global @gatekeeper-os/cli@beta` on a disposable evaluation machine, then follow the [CLI instructions](../gkos-cli/README.md). The npm package-page README updates on the next publication; this documentation change does not alter the existing archive.
