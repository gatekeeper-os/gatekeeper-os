import { defineGatekeeper } from "@clawos/gatekeeper-kit";
import { FsVendor } from "./vendor.js";
import { fsResources } from "./resources.js";
import { describeWrite } from "./directory.js";
import { fsTools } from "./tools.js";

export default defineGatekeeper({
  vendor: "fs", apiVersion: 1, id: "gatekeeper-fs", name: "Filesystem Gatekeeper",
  description: "Mediates agent access to specific host directories.",
  createVendor: (ctx) => new FsVendor(ctx),
  actions: { gk_fs_file_write: { describe: describeWrite } },
  resources: fsResources,
  tools: fsTools,
});
