/** Strip URLs, tokens, and vendor bodies from errors before they reach a tool result or a log (plan §4.8, §5.2). */
export function sanitizeError(err: unknown, fallback = "The operation failed."): string {
  const msg = err instanceof Error ? err.message : String(err);
  const code = msg.match(/\b(4\d\d|5\d\d)\b/)?.[1];
  if (/token|secret|authorization|bearer|https?:\/\//i.test(msg)) return code ? `${fallback} (status ${code})` : fallback;
  return msg.length > 200 ? `${fallback}${code ? ` (status ${code})` : ""}` : msg;
}
