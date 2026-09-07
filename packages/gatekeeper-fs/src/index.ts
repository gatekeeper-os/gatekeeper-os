import { defineGatekeeper } from "@clawos/gatekeeper-kit";
import { Type } from "typebox";
import { FsVendor } from "./vendor.js";

export default defineGatekeeper({
  vendor: "fs", apiVersion: 1, id: "gatekeeper-fs", name: "Filesystem Gatekeeper",
  description: "Mediates agent access to specific host directories.",
  createVendor: (ctx) => new FsVendor(ctx),
  // Metadata-only placeholder: Phase 3 must implement the reviewed descriptor before use.
  actions: { gk_fs_file_write: { describe() { throw new Error("Filesystem driver is not implemented."); } } },
  resources: [
    { type: "dir", urlPattern: "file:///:path+", title: "Directory", description: "Read and write files inside one directory tree.",
      grantable: true, observerStrategy: "low-stakes", tools: ["gk_fs_dir_list", "gk_fs_file_read", "gk_fs_file_write"] },
  ],
  tools: [
    { name: "gk_fs_dir_list", resourceType: "dir", kind: "observation", description: "List files and folders in the directory.",
      parameters: Type.Object({ grant: Type.String(), subpath: Type.Optional(Type.String()) }) },
    { name: "gk_fs_file_read", resourceType: "dir", kind: "observation", description: "Read a text file inside the directory.",
      parameters: Type.Object({ grant: Type.String(), path: Type.String() }) },
    { name: "gk_fs_file_write", resourceType: "dir", kind: "action", description: "Write a text file inside the directory.",
      parameters: Type.Object({ grant: Type.String(), path: Type.String(), content: Type.String() }) },
  ],
});
