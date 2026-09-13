# Operator approvals

`gkos approvals list` shows at most 100 pending actions as an escaped terminal
table. `gkos approvals preview 12,13` (or `all`) explicitly displays descriptions,
revert support and previews. `--json` preserves the machine-readable operator
response. Preview bodies are operator output, never notification or audit content.
A truncated response is explicitly labeled; an absent requested ID is an error.

Use `gkos approvals apply|reject|revert IDs|all` to decide. Previewing does not
claim, authorize or execute an action. Reversion is supported only by drivers that
implement it. Existing uncertain effects stay nonretryable.

In an authorized **private** operator conversation, `/approvals`, `/approvals
preview IDs`, `/approvals apply IDs`, `/reject IDs`, and `/grant URL` use claimed upstream
dispatch before model execution. The operator identity comes from upstream owner
resolution and the configured operator allowlist, not message text. Shared or
unauthorized command attempts produce no action and no command reply.

Auto-approval requires BOTH `autoApprovable: true` from the driver description and
a matching tag in kernel config `autoApprove`. Missing either stops ordered draining
at that action. A manual decision resumes the eligible tail; a 30-second timer also
checks delayed actions. Maintenance supplies no auto-approval rules.

Digest notifications contain only counts and fixed instructions. They are claimed
once per run, not per action; a send failure records unconfirmed delivery and is not
silently retried. A local synthetic channel receipt is not proof of external delivery.

The current CLI is line-oriented, not a full-screen TUI. Full Phase 5 acceptance
still requires the accepted GitHub/secrecy flow and a real operator-channel receipt.
