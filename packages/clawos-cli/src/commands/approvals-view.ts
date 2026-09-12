/** Bounded terminal output for operator-owned action metadata, never transport diagnostics. */
export function approvalView(value: unknown, preview = false): string {
  if (!value || typeof value !== 'object' || !('actions' in value) || !Array.isArray(value.actions)) throw new Error('Invalid approval response');
  const rows = value.actions.slice(0, 100).map((row: Record<string, unknown>) => {
    let d: Record<string, unknown> = {};
    try { const parsed: unknown = JSON.parse(String(row.descriptionJson)); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) d = parsed as Record<string, unknown>; } catch { /* Show unavailable metadata, never execute it. */ }
    const kind = d.actionKind && typeof d.actionKind === 'object' && 'tag' in d.actionKind ? d.actionKind.tag : '-';
    const line = `${clean(row.id, 20).padEnd(8)} ${clean(row.status, 16).padEnd(16)} ${clean(kind, 48).padEnd(30)} ${clean(d.title ?? 'Preview unavailable', 120)}`;
    return preview ? `${line}\n  ${clean(d.description ?? '', 2048)}\n  Revert supported: ${d.implementsRevert === true ? 'yes' : 'no'}\n  Preview: ${clean(JSON.stringify(d.preview ?? null), 4096)}` : line;
  });
  const truncated = 'truncated' in value && value.truncated === true;
  return ['ID       STATUS           KIND                           TITLE', ...rows, rows.length ? '' : 'No actions.', truncated ? 'More than 100 actions: response truncated; do not assume this is the full queue.' : '', preview ? '' : 'Use clawos approvals preview <IDs|all> to inspect actions before deciding.'].filter(Boolean).join('\n');
}
function clean(value: unknown, limit: number): string {
  // Neutralize CSI/OSC, carriage returns, bidi controls and line injection in untrusted titles/previews.
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).slice(0, limit);
}
