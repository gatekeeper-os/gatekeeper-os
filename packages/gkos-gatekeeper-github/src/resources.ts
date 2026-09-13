import type { SupportedResource } from "@gatekeeper-os/shared";

/** URL patterns exactly as cloudflare-os gkos-gatekeeper-github (plan §9 Phase 4). */
export const resources: SupportedResource[] = [
  { type: "repo", urlPattern: "https://github.com/:owner/:repo", title: "GitHub Repository",
    description: "Read files, issues, and pull requests; create issues and comments.", grantable: true, observerStrategy: "acl-check",
    tools: ["gk_github_repo_get", "gk_github_repo_list_issues", "gk_github_repo_list_pulls", "gk_github_repo_read_file", "gk_github_issue_create"] },
  { type: "issue", urlPattern: "https://github.com/:owner/:repo/issues/:number", title: "GitHub Issue",
    description: "Read and comment on one issue.", grantable: true, observerStrategy: "acl-check",
    tools: ["gk_github_issue_get", "gk_github_issue_comment"] },
  { type: "pull", urlPattern: "https://github.com/:owner/:repo/pull/:number", title: "GitHub Pull Request",
    description: "Read, diff, comment on, and review one pull request.", grantable: true, observerStrategy: "acl-check",
    tools: ["gk_github_pull_get", "gk_github_pull_diff", "gk_github_pull_comment", "gk_github_pull_review"] },
];
