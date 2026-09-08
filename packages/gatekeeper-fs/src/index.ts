import { defineGatekeeper } from "@clawos/gatekeeper-kit";
import { FsVendor } from "./vendor.js";
import { fsResources } from "./resources.js";
import { fsTools } from "./tools.js";

export default defineGatekeeper({
  vendor: "fs", apiVersion: 1, id: "gatekeeper-fs", name: "Filesystem Gatekeeper",
  description: "Mediates agent access to specific host directories.",
  createVendor: (ctx) => new FsVendor(ctx),
  // The account boundary is implemented; the data plane remains disabled at STOP 2.
  actions: { gk_fs_file_write: { describe() { throw new Error("Filesystem resource unavailable."); } } },
  resources: fsResources,
  tools: fsTools,
});
