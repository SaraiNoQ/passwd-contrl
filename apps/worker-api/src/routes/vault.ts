import { Hono } from "hono";
import type { Env } from "../env";
import { D1VaultStore } from "../store";
import { requireSession } from "../middleware/session";
import {
  encryptedItemDeleteRequestSchema,
  encryptedItemUpsertRequestSchema,
  itemLevelSyncCursorSchema,
  itemLevelSyncPlanSchema,
  itemLevelSyncPullResponseSchema,
  itemLevelSyncResponseSchema,
  syncConflictResponseSchema,
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

    const cursor = itemLevelSyncCursorSchema.safeParse(c.req.query("cursor") ?? "0");
    const limit = itemLevelSyncCursorSchema.safeParse(c.req.query("limit") ?? "200");
    if (!cursor.success || !limit.success || limit.data < 1 || limit.data > 500) {
      return c.json({ error: "invalid_sync_cursor" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);
    const result = await store.pullItemLevelSync(session.userId, cursor.data, limit.data);
    return c.json(itemLevelSyncPullResponseSchema.parse(result));
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
        return c.json(syncConflictResponseSchema.parse({
            error: "sync_conflict",
            serverRevision: result.serverRevision,
            applied: result.applied,
            conflicts: result.conflicts
          }), 409);
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

  // ── Encrypted item CRUD ─────────────────────────────────────────────────
  app.get("/vault/items/:id", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const store = new D1VaultStore(c.env.DB);
    const item = await store.getEncryptedItem(session.userId, c.req.param("id"));
    return item ? c.json(item) : c.json({ error: "item_not_found" }, 404);
  });

  app.put("/vault/items/:id", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_item_upsert_request" }, 400);
    }
    const parsed = encryptedItemUpsertRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.item.id !== c.req.param("id")) {
      return c.json({ error: "invalid_item_upsert_request" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);
    const result = await store.pushItemLevelSync(session.userId, {
      protocol: "item_level_v1",
      baseRevision: parsed.data.baseRevision,
      upserts: [parsed.data.item],
      deletes: []
    });
    if (result.conflicts.length > 0) {
      return c.json(syncConflictResponseSchema.parse({
        error: "sync_conflict",
        serverRevision: result.serverRevision,
        applied: result.applied,
        conflicts: result.conflicts
      }), 409);
    }
    return c.json(itemLevelSyncResponseSchema.parse({
      protocol: "item_level_v1",
      serverRevision: result.serverRevision,
      applied: result.applied,
      conflicts: []
    }));
  });

  app.delete("/vault/items/:id", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_item_delete_request" }, 400);
    }
    const parsed = encryptedItemDeleteRequestSchema.safeParse(body);
    if (!parsed.success || parsed.data.deletion.id !== c.req.param("id")) {
      return c.json({ error: "invalid_item_delete_request" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);
    const result = await store.pushItemLevelSync(session.userId, {
      protocol: "item_level_v1",
      baseRevision: parsed.data.baseRevision,
      upserts: [],
      deletes: [parsed.data.deletion]
    });
    if (result.conflicts.length > 0) {
      return c.json(syncConflictResponseSchema.parse({
        error: "sync_conflict",
        serverRevision: result.serverRevision,
        applied: result.applied,
        conflicts: result.conflicts
      }), 409);
    }
    return c.json(itemLevelSyncResponseSchema.parse({
      protocol: "item_level_v1",
      serverRevision: result.serverRevision,
      applied: result.applied,
      conflicts: []
    }));
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
