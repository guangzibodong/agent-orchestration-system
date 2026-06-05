export function buildApiHeaders(
  token: string | undefined,
  initHeaders?: HeadersInit
): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...initHeaders,
    ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {})
  };
}
