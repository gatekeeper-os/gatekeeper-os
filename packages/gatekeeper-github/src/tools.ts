import { Type } from "typebox";
import type { GatekeeperToolDef } from "@clawkeepers/shared";

// STOP 1: this surface is presented for operator review before src/{repo,issue,pull}.ts are implemented.
const G = Type.String();
export const tools: GatekeeperToolDef[] = [
  { name: "gk_github_repo_get", resourceType: "repo", kind: "observation", description: "Get repository metadata (name, description, default branch, visibility).", parameters: Type.Object({ grant: G }) },
  { name: "gk_github_repo_list_issues", resourceType: "repo", kind: "observation", description: "List issues in the repository.", parameters: Type.Object({ grant: G, state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])), labels: Type.Optional(Type.Array(Type.String())), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }) },
  { name: "gk_github_repo_list_pulls", resourceType: "repo", kind: "observation", description: "List pull requests in the repository.", parameters: Type.Object({ grant: G, state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }) },
  { name: "gk_github_repo_read_file", resourceType: "repo", kind: "observation", description: "Read a file from the repository at a ref (default branch if omitted).", parameters: Type.Object({ grant: G, path: Type.String(), ref: Type.Optional(Type.String()) }) },
  { name: "gk_github_issue_create", resourceType: "repo", kind: "action", description: "Create a new issue in the repository.", parameters: Type.Object({ grant: G, title: Type.String(), body: Type.Optional(Type.String()), labels: Type.Optional(Type.Array(Type.String())) }) },
  { name: "gk_github_issue_get", resourceType: "issue", kind: "observation", description: "Get the issue with its comments.", parameters: Type.Object({ grant: G }) },
  { name: "gk_github_issue_comment", resourceType: "issue", kind: "action", description: "Add a comment to the issue.", parameters: Type.Object({ grant: G, body: Type.String() }) },
  { name: "gk_github_pull_get", resourceType: "pull", kind: "observation", description: "Get the pull request with its review comments.", parameters: Type.Object({ grant: G }) },
  { name: "gk_github_pull_diff", resourceType: "pull", kind: "observation", description: "Get the unified diff of the pull request.", parameters: Type.Object({ grant: G }) },
  { name: "gk_github_pull_comment", resourceType: "pull", kind: "action", description: "Add a comment to the pull request conversation.", parameters: Type.Object({ grant: G, body: Type.String() }) },
  { name: "gk_github_pull_review", resourceType: "pull", kind: "action", description: "Submit a review on the pull request.", parameters: Type.Object({ grant: G, event: Type.Union([Type.Literal("COMMENT"), Type.Literal("APPROVE"), Type.Literal("REQUEST_CHANGES")]), body: Type.String() }) },
];
