# @gatekeeper-os/gatekeeper-kit

GatekeeperOS is an independent project. It is not affiliated with or endorsed by the OpenClaw Foundation. OpenClaw is a trademark of its owner.

Security-critical helpers for gatekeeper authors. Start with [SKELETON.md](SKELETON.md).

Includes the validated lifecycle builder, two-stage OAuth nonces, encrypted account storage with refresh coalescing,
persistent simulation stores, action sequencing, a resource-session base class, fixed-message error sanitization, and
an offline test queue. Kernel authorization and tool registration remain exclusively the kernel's responsibility.

Phase 2 acceptance is library-only: `scripts/vm/test.sh phase-2`. No Gateway, external API, or production state is used.
See the skeleton's ordering/recovery section for single-writer ownership, uncertain-action handling and sync approval binding.
