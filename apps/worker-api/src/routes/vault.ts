import { Hono } from "hono";
import type { Env } from "../env";
import { D1VaultStore } from "../store";
import { requireSession } from "../middleware/session";
import {
  itemLevelSyncPlanSchema,
  itemLevelSyncResponseSchema,
  syncPushRequestSchema,
  vaultSearchRequestSchema,
  vaultSearchResponseSchema
} from "@zero-vault/shared";

export function buildVaultRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // ── GET /vault/sync ──────────────────────────────────────────────────────
  app.get("/vault/sync", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const store = new D1VaultStore(c.env.DB);
    const result = await store.pullVault(session.userId);
    return c.json(result);
  });

  // ── POST /vault/sync ─────────────────────────────────────────────────────
  app.post("/vault/sync", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const body = await c.req.json();
    const parsed = syncPushRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_sync_request" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);
    try {
      const result = await store.pushVault(session.userId, parsed.data);
      if (!result.ok) {
        return c.json(
          {
            error: "sync_conflict",
            serverRevision: result.serverRevision
          },
          409
        );
      }
      return c.json({ serverRevision: result.serverRevision });
    } catch (error) {
      if (error instanceof Error && error.message === "item_owner_mismatch") {
        return c.json({ error: "item_owner_mismatch" }, 403);
      }
      throw error;
    }
  });

  // ── GET /vault/item-sync ─────────────────────────────────────────────────
  app.get("/vault/item-sync", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const store = new D1VaultStore(c.env.DB);
    const result = await store.pullItemLevelSync(session.userId);
    return c.json(result);
  });

  // ── POST /vault/item-sync ────────────────────────────────────────────────
  app.post("/vault/item-sync", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const body = await c.req.json();
    const parsed = itemLevelSyncPlanSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_item_sync_request" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);
    try {
      const result = await store.pushItemLevelSync(session.userId, parsed.data);
      if (result.conflicts.length > 0) {
        return c.json(
          {
            error: "sync_conflict",
            serverRevision: result.serverRevision,
            conflicts: result.conflicts
          },
          409
        );
      }
      const response = itemLevelSyncResponseSchema.parse({
        protocol: "item_level_v1",
        serverRevision: result.serverRevision,
        applied: result.applied,
        conflicts: []
      });
      return c.json(response);
    } catch (error) {
      if (error instanceof Error && error.message === "item_owner_mismatch") {
        return c.json({ error: "item_owner_mismatch" }, 403);
      }
      throw error;
    }
  });

  // ── GET /vault/items/:id/history ─────────────────────────────────────────
  app.get("/vault/items/:id/history", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const itemId = c.req.param("id");
    const store = new D1VaultStore(c.env.DB);
    const versions = await store.getItemHistory(session.userId, itemId);
    return c.json({ itemId, versions });
  });

  // ── POST /vault/search ────────────────────────────────────────────────────
  app.post("/vault/search", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const body = await c.req.json();
    const parsed = vaultSearchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_search_request" }, 400);
    }

    try {
      const store = new D1VaultStore(c.env.DB);
      const itemIds = await store.searchItemsByTokens(session.userId, parsed.data.tokens);
      return c.json({ itemIds });
    } catch (err) {
      console.error("[vault/search]", err);
      return c.json({ error: "search_failed" }, 500);
    }
  });

  return app;
}
