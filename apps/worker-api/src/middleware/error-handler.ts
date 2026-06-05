import type { ErrorHandler } from "hono";
import type { Env } from "../env";

/**
 * Safe error handler that never exposes stack traces, OPAQUE messages,
 * session tokens, or ciphertext payloads.
 */
export const errorHandler: ErrorHandler<{ Bindings: Env }> = (err, c) => {
  // Log full error in development, redacted in production
  const isProduction = c.env?.ENVIRONMENT === "production";
  if (isProduction) {
    console.error(`[error] ${err.name}: ${err.message}`);
  } else {
    console.error(`[error]`, err);
  }

  // In production or for any unexpected error, return a generic message
  const status = "status" in err && typeof err.status === "number" ? err.status : 500;

  return c.json(
    {
      error: isProduction || status >= 500 ? "internal_server_error" : err.message,
      // Include stack trace in development for debugging
      ...(isProduction ? {} : { stack: err.stack })
    },
    status as any
  );
};
