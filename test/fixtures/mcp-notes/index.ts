// Disposable-VM-only synthetic plugin entry. Never packaged with gkos-gatekeeper-mcp. The kernel loads ./driver.js.
import { defineGatekeeper } from "@gatekeeper-os/gatekeeper-kit/plugin";
import driver from "./driver.js";
export default defineGatekeeper(driver);
