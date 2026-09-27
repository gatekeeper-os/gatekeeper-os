// OpenClaw plugin entry: declares this gatekeeper's tools. The kernel loads ./driver.js itself.
import { defineGatekeeper } from "@gatekeeper-os/gatekeeper-kit/plugin";
import driver from "./driver.js";

export default defineGatekeeper(driver);
