export function allowsOfflineSessionFallback(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  const normalized = typeof code === "string" ? code.toLowerCase() : error.message.toLowerCase();
  return normalized === "network_error" || normalized === "request_timeout";
}
