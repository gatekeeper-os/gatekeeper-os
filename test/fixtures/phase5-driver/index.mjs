// VM-only synthetic plugin entry; declares its own fs tool contract. The kernel loads ./driver.mjs itself.
import { defineGatekeeper } from '../../../packages/gatekeeper-kit/dist/plugin.js';
import driver from './driver.mjs';
export default defineGatekeeper(driver);
