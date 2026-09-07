# @clawos/gatekeeper-kit

Owns the order of operations a gatekeeper author is most likely to get subtly wrong (cloudflare-os `plans/gatekeeper-kit.md`):
OAuth nonce lifecycle, token refresh coalescing, action id sequencing, the simulation overlay, observer admission, and error
sanitization. `defineGatekeeper()` turns a definition into an OpenClaw plugin entry — and refuses definitions that would break
the security model (plan §9 Phase 2 acceptance). Start a new gatekeeper from `SKELETON.md`.
