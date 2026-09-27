/**
 * Error objects from SDKs can carry request configuration, authorization
 * headers, response bodies, and full provider messages. Keep only the
 * diagnostic classification and an HTTP status when one is available.
 */
export function safeErrorLogFields(error: unknown): { kind: string; status?: number } {
  const kind = error instanceof Error
    ? "Error"
    : typeof error === "string"
      ? "ErrorMessage"
      : error !== null && typeof error === "object"
        ? "ErrorObject"
        : "Unknown";

  let status: unknown;
  try {
    if (error !== null && typeof error === "object") {
      const value = error as { status?: unknown; statusCode?: unknown; response?: unknown };
      status = value.status ?? value.statusCode;
      if (status === undefined && value.response !== null && typeof value.response === "object") {
        status = (value.response as { status?: unknown }).status;
      }
    }
  } catch {
    // A provider error may expose throwing getters; omit status in that case.
    status = undefined;
  }

  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
    return { kind, status };
  }
  return { kind };
}