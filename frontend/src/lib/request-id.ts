const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{4,128}$/;

export function sanitizeRequestId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return SAFE_REQUEST_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function extractRequestId(
  body: unknown,
  response?: Pick<Response, "headers"> | null,
): string | undefined {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const fromBody = sanitizeRequestId((body as Record<string, unknown>).requestId);
    if (fromBody) return fromBody;
  }
  const fromHeader = sanitizeRequestId(response?.headers?.get?.("X-Request-Id"));
  return fromHeader;
}

export function getErrorRequestId(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  return sanitizeRequestId((error as { requestId?: unknown }).requestId);
}

export function isUnexpectedApiError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") {
    return status === 0 || status >= 500;
  }
  return false;
}
