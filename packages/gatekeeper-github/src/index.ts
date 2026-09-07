import { defineGatekeeper } from "@clawos/gatekeeper-kit";
import { GitHubVendor } from "./vendor.js";
import { resources } from "./resources.js";
import { tools } from "./tools.js";

export default defineGatekeeper({
  vendor: "github", apiVersion: 1, id: "gatekeeper-github", name: "GitHub Gatekeeper",
  description: "Mediates agent access to GitHub repositories, issues, and pull requests.",
  createVendor: (ctx) => new GitHubVendor(ctx),
  resources,
  tools,
});
