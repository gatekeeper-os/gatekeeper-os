/** Emit only a fixed message and a structured numeric HTTP status; never vendor error strings or bodies. */
export function sanitizeError(error: unknown): string {
  let status: unknown;
  try { if (error !== null && typeof error === "object" && "status" in error) status = error.status; } catch { /* hostile getter */ }
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599
    ? `The operation failed. (status ${status})` : "The operation failed.";
}
