/** Emit only a fixed message and a structured numeric HTTP status; never vendor error strings or bodies. */
export function sanitizeError(error: unknown): string {
  let status: unknown;
  try { if (error !== null && typeof error === "object" && "status" in error) status = error.status; } catch { /* hostile getter */ }
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599
    ? `The operation failed. (status ${status})` : "The operation failed.";
}

/** Safe response provenance, never inferred from a local error/status/message. */
export function providerResponseStatus(error: unknown): number | undefined {
  try {
    if (error !== null && typeof error === "object" && "providerResponseStatus" in error) {
      const value = error.providerResponseStatus;
      if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) return value;
    }
  } catch { /* hostile getter */ }
  return undefined;
}
/** Discard the original exception and cause; preserve only bounded numeric provenance. */
export function sanitizedFailure(error: unknown): Error & { providerResponseStatus?: number } {
  const safe: Error & { providerResponseStatus?: number } = new Error(sanitizeError(error));
  const value = providerResponseStatus(error);
  if (value !== undefined) safe.providerResponseStatus = value;
  return safe;
}
