import type { MiddlewareHandler } from "hono";
import { bodyLimit as honoBodyLimit } from "hono/body-limit";

const MAX_BODY_SIZE = 1_048_576; // 1MB
const MAX_EXPORT_BODY_SIZE = 50 * 1_048_576; // 50MB for encrypted export uploads

/** Paths that accept larger binary bodies (encrypted vault exports). */
const LARGE_BODY_PATHS = ["/exports/create"];

/**
 * Middleware that rejects requests with a body larger than 1MB.
 * Export routes use a 50MB limit to accommodate encrypted vault data.
 * Content-Length is checked without buffering. Streaming/chunked bodies are
 * read only up to the configured cap by Hono and then rejected.
 */
export const bodyLimit = (): MiddlewareHandler => {
  const limited = (maxSize: number): MiddlewareHandler => honoBodyLimit({
    maxSize,
    onError: (c) => c.json({ error: "请求体超过限制" }, 413)
  });
  const defaultLimit = limited(MAX_BODY_SIZE);
  const exportLimit = limited(MAX_EXPORT_BODY_SIZE);

  return async (c, next) => {
    const middleware = LARGE_BODY_PATHS.some((path) => c.req.path.startsWith(path))
      ? exportLimit
      : defaultLimit;
    return middleware(c, next);
  };
};
