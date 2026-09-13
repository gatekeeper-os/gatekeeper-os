import { defineGatekeeper } from "@gatekeeper-os/gatekeeper-kit";
import { GitHubVendor } from "./vendor.js";
import { resources } from "./resources.js";
import { tools } from "./tools.js";

export default defineGatekeeper({
  vendor: "github", apiVersion: 1, id: "gkos-gatekeeper-github", name: "GitHub Gatekeeper",
  description: "Mediates agent access to GitHub repositories, issues, and pull requests.",
  createVendor: (ctx) => new GitHubVendor(ctx),
  resources,
  tools,
  // Existing tool surface only; Phase 4 reviews and implementation remain outstanding.
  actions: Object.fromEntries(tools.filter(tool => tool.kind === "action").map(tool => [tool.name, {
    describe() { throw new Error("GitHub driver is not implemented."); },
  }])),
});
