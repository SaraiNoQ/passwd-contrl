import type { MiddlewareHandler } from "hono";

const MAX_BODY_SIZE = 1_048_576; // 1MB
const MAX_EXPORT_BODY_SIZE = 50 * 1_048_576; // 50MB for encrypted export uploads

/** Paths that accept larger binary bodies (encrypted vault exports). */
const LARGE_BODY_PATHS = ["/exports/create"];

/**
 * Middleware that rejects requests with a body larger than 1MB.
 * Export routes use a 50MB limit to accommodate encrypted vault data.
 * Checks the Content-Length header before the body is read.
 */
export const bodyLimit = (): MiddlewareHandler => {
  return async (c, next) => {
    const contentLength = c.req.header("content-length");

    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (isNaN(size)) {
        await next();
        return;
      }

      const limit = LARGE_BODY_PATHS.some((p) => c.req.path.startsWith(p))
        ? MAX_EXPORT_BODY_SIZE
        : MAX_BODY_SIZE;

      if (size > limit) {
        return c.json({ error: "请求体超过限制" }, 413);
      }
    }

    await next();
  };
};
