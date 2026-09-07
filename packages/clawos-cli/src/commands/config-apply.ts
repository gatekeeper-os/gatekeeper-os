/**
 * `clawos config apply` — plan §6.2 reconciliation:
 * 1 merge os/config.d/*.json5 in name order (arrays replace, later wins) → os/config.generated.json
 * 2 diff vs previous generated → print
 * 3 `openclaw config patch --file … --dry-run` → abort on validation error
 * 4 real patch with --expect-current-json on OS-owned paths; --merge on agents.entries / plugins.entries
 * 5 `openclaw doctor --lint --json` (exit 2 → revert)
 * 6 fingerprint → lockfile; restart if gateway.port/bind/auth/tls changed, else rely on hybrid reload
 */
export async function configApply(_args: string[]): Promise<number> { console.log("TODO(phase-1)"); return 1; }
