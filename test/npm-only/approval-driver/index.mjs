// Test-only plugin entry, using the actual registry-published kit. The kernel loads ./driver.mjs itself.
import {defineGatekeeper} from '/home/tester/npm-acceptance-prefix/lib/node_modules/@gatekeeper-os/gatekeeper-kit/dist/plugin.js';
import driver from './driver.mjs';
export default defineGatekeeper(driver);
