/** Proposed resource metadata; matching is only a candidate, never authorization. */
import type { SupportedResource } from "@clawos/shared";

/** A directory at or below an explicit operator root; empty roots allow nothing. */
export const fsResources: SupportedResource[] = [{
  type: "dir", urlPattern: "file:///:path+", title: "Directory",
  description: "Read and write text files inside one directory tree.",
  grantable: true, observerStrategy: "low-stakes",
  tools: ["gk_fs_dir_list", "gk_fs_file_read", "gk_fs_file_write"],
}];
