// Driver-safe surface: nothing reachable from this entry imports `openclaw`, so the kernel can load driver modules
// directly. The OpenClaw plugin entry builder lives at `@gatekeeper-os/gatekeeper-kit/plugin`.
export { defineGatekeeperDriver, startGatekeeperDriver, type GatekeeperDefinition, type VendorContext, type LiveGatekeeper } from "./driver.js";
export { KitGatekeeper, type ActionImpl, type ObservationImpl } from "./kit-gatekeeper.js";
export { OAuthNonceMachine } from "./oauth-nonce.js";
export { TokenStore } from "./token-store.js";
export { OverlayStore, type OverlayEntry } from "./overlay-store.js";
export { CacheMutationStore } from "./cache-mutation-store.js";
export { ActionSequencer } from "./action-sequencer.js";
export { sanitizeError } from "./sanitize.js";
export { TestApprovalQueue } from "./testing.js";

export { validateGatekeeperManifest, gatekeeperDriverPath } from "./tool-contracts.js";
