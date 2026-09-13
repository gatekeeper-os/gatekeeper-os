// Excerpt from plan Appendix B — the shape every action follows. TODO(phase-4): complete after STOP 1 approval.
import { KitGatekeeper, OverlayStore } from "@gatekeeper-os/gatekeeper-kit";
import type { ObserverVerifier, SupportedResource } from "@gatekeeper-os/shared";
import { resources } from "./resources.js";

export class IssueGatekeeper extends KitGatekeeper {
  resource: SupportedResource = resources[1]!;
  protected overlay = new OverlayStore();
  constructor(private owner: string, private repo: string, private number: number) { super(); }
  override actions = {
    gk_github_issue_comment: {
      describe: (p: { body: string }) => ({ title: `Comment on issue #${this.number}`, description: `> ${p.body}`,
        actionKind: { tag: "github.issue.comment", label: "Comment on issue" }, autoApprovable: !/@/.test(p.body), implementsRevert: true }),
      simulate: (p: { body: string }, overlay: OverlayStore, actionId: number) => overlay.add({ actionId, kind: "comment", payload: { id: overlay.nextTempId(), body: p.body, author: "you", pending: true } }),
      apply: async (_p: { body: string }) => { throw new Error("TODO(phase-4): api.createComment"); },
      revert: async () => { throw new Error("TODO(phase-4): api.deleteComment"); },
    },
  };
  override async addObserver(_id: string, _verifier: ObserverVerifier): Promise<void> {
    // Strategy B: throw unless GitHubVerifier.from(verifier).hasRepoAccess(owner, repo). 403/404 → false; other errors rethrow.
    throw new Error("TODO(phase-4)");
  }
}
