// OpenClaw plugin entry builder. Import from `@gatekeeper-os/gatekeeper-kit/plugin` in a gatekeeper's plugin entry
// only; driver code imports the root entry, which never loads `openclaw`.
export { defineGatekeeper, GATEKEEPER_TOOL_PLACEHOLDER } from "./define-gatekeeper.js";
