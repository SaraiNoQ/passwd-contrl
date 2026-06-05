import { Hono } from "hono";
import type { Env } from "../env";
import { D1VaultStore } from "../store";

export function buildMaintenanceRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // ── POST /maintenance/cleanup-expired-sessions ───────────────────────────
  app.post("/maintenance/cleanup-expired-sessions", async (c) => {
    const token = c.req.header("x-zero-vault-maintenance-token");
    const expected = c.env.MAINTENANCE_TOKEN;
    if (!expected || token !== expected) {
      return c.json({ error: "not_found" }, 404);
    }

    const store = new D1VaultStore(c.env.DB);
    const result = await store.cleanupExpiredSessions();
    return c.json(result);
  });

  return app;
}
