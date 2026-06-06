export type ApiTokenRole = "operator" | "viewer";

export function buildApiHeaders(
  token: string | undefined,
  initHeaders?: HeadersInit,
): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...initHeaders,
    ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
  };
}

export function normalizeApiTokenRole(
  value: string | null | undefined,
): ApiTokenRole {
  return value === "viewer" ? "viewer" : "operator";
}

export function canUseOperatorActions(role: ApiTokenRole): boolean {
  return role === "operator";
}

export function formatApiErrorMessage(
  status: number,
  path: string,
  body?: unknown,
): string {
  if (status === 401) {
    return "API token missing or invalid.";
  }

  if (status === 403 && isForbiddenViewerError(body)) {
    return "This token is read-only. Switch to an operator token to continue.";
  }

  return `API ${status}: ${path}`;
}

function isForbiddenViewerError(body: unknown): boolean {
  if (!body || typeof body !== "object") {
    return false;
  }

  const candidate = body as { error?: unknown; role?: unknown };
  return candidate.error === "forbidden" && candidate.role === "viewer";
}
