import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_HEADER = "x-zero-vault-csrf";

/**
 * CSRF protection middleware.
 * For non-safe methods, requires a valid X-CSRF-Token header
 * that matches the session's CSRF token.
 *
 * This middleware assumes a `csrfToken` variable has been set on the
 * Hono context via `c.set("csrfToken", token)` by an auth middleware.
 */
export const csrf = (): MiddlewareHandler => {
  return async (c, next) => {
    // Safe methods never need CSRF protection
    if (SAFE_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    // If no session exists (unauthenticated request), skip CSRF check entirely.
    // CSRF only protects authenticated sessions from cross-site request forgery.
    // Auth endpoints (register/login) are protected by OPAQUE protocol + rate limiting.
    const expectedToken = c.get("csrfToken");
    if (!expectedToken) {
      await next();
      return;
    }

    // Session exists — CSRF token is required
    const submittedToken = c.req.header(CSRF_HEADER);
    if (!submittedToken || submittedToken !== expectedToken) {
      return c.json({ error: "csrf_token_required" }, 403);
    }

    await next();
  };
};
