import { Hono } from "hono";
import type { Env } from "../env";

export const healthRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /health — basic liveness check
 */
healthRoutes.get("/health", (c) => {
  return c.json({ ok: true });
});

/**
 * GET /ready — readiness check (verifies store availability)
 */
healthRoutes.get("/ready", async (c) => {
  try {
    // When D1 is bound, perform a lightweight query to verify connectivity
    if (c.env.DB) {
      await c.env.DB.prepare("SELECT 1").first();
    }
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, error: "store_unavailable" }, 503);
  }
});
