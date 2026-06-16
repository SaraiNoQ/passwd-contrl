/**
 * Export routes — manage encrypted vault exports in R2.
 *
 * POST /exports/create   — Upload encrypted export to R2
 * GET  /exports/:id      — Download encrypted export
 * GET  /exports          — List user's exports
 * DELETE /exports/:id    — Delete an export
 *
 * Security:
 * - All data stored in R2 is already encrypted (ciphertext envelopes)
 * - Object keys use UUIDs, never plaintext vault content
 * - Metadata is limited to algorithm, timestamp, size
 */

import { Hono } from "hono";
import type { Env } from "../env";
import { R2Storage } from "../storage/r2-helpers";
import {
  exportVaultToR2,
  importVaultFromR2
} from "../storage/r2-integration";

export const exportRoutes = new Hono<{ Bindings: Env }>();

/**
 * Helper: extract userId from context via session middleware.
 * Uses the same c.get("session")?.userId pattern as vault routes.
 */
function getUserId(c: { get(key: "session"): { userId: string } | undefined }): string | null {
  return c.get("session")?.userId ?? null;
}

/**
 * Helper: get R2Storage instance from the environment.
 */
function getStorage(c: { env: { R2: R2Bucket } }): R2Storage {
  return new R2Storage(c.env.R2);
}

function getExportCreatedAt(obj: R2Object): string {
  const metadataTimestamp = obj.customMetadata?.ts;
  if (metadataTimestamp && Number.isFinite(new Date(metadataTimestamp).getTime())) {
    return metadataTimestamp;
  }

  return obj.uploaded.toISOString();
}

// ── POST /exports/create ─────────────────────────────────────────────────────

/**
 * Upload an encrypted vault export to R2.
 *
 * Expects a binary body (application/octet-stream) containing the
 * already-encrypted vault data. Metadata is passed via headers:
 * - X-Export-Id: UUID for this export
 * - X-Export-Algorithm: encryption algorithm used
 */
exportRoutes.post("/exports/create", async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ error: "unauthorized" }, 401);
  }

  if (!c.env.R2) {
    return c.json({ error: "r2_not_configured" }, 503);
  }

  const exportId = c.req.header("x-export-id");
  if (!exportId) {
    return c.json({ error: "export_id_required" }, 400);
  }

  const algorithm = c.req.header("x-export-algorithm") ?? "XCHACHA20_POLY1305";

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) {
    return c.json({ error: "empty_body" }, 400);
  }

  const storage = getStorage(c);
  const result = await exportVaultToR2(
    storage,
    userId,
    exportId,
    body,
    algorithm
  );

  return c.json({ ok: true, key: result.key, size: result.size }, 201);
});

// ── GET /exports/:id ─────────────────────────────────────────────────────────

/**
 * Download an encrypted vault export from R2.
 *
 * Returns the raw encrypted ciphertext as application/octet-stream.
 */
exportRoutes.get("/exports/:id", async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ error: "unauthorized" }, 401);
  }

  if (!c.env.R2) {
    return c.json({ error: "r2_not_configured" }, 503);
  }

  const exportId = c.req.param("id");
  const storage = getStorage(c);
  const result = await importVaultFromR2(storage, userId, exportId);

  if (!result) {
    return c.json({ error: "export_not_found" }, 404);
  }

  // Return the encrypted data as a binary response
  return new Response(result.data, {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Export-Algorithm": result.metadata.alg ?? "unknown",
      "X-Export-Timestamp": result.metadata.ts ?? "unknown"
    }
  });
});

// ── GET /exports ─────────────────────────────────────────────────────────────

/**
 * List user's exports. Returns metadata only — no ciphertext.
 */
exportRoutes.get("/exports", async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ error: "unauthorized" }, 401);
  }

  if (!c.env.R2) {
    return c.json({ error: "r2_not_configured" }, 503);
  }

  const storage = getStorage(c);
  const exports = await storage.listExports(userId);

  const items = exports.map((obj) => {
    // Extract exportId from key: exports/{userId}/{exportId}
    const segments = obj.key.split("/");
    return {
      id: segments[2],
      size: obj.size,
      algorithm: obj.customMetadata?.alg ?? "unknown",
      createdAt: getExportCreatedAt(obj)
    };
  });

  return c.json({ exports: items });
});

// ── DELETE /exports/:id ──────────────────────────────────────────────────────

/**
 * Delete an encrypted vault export from R2.
 */
exportRoutes.delete("/exports/:id", async (c) => {
  const userId = getUserId(c);
  if (!userId) {
    return c.json({ error: "unauthorized" }, 401);
  }

  if (!c.env.R2) {
    return c.json({ error: "r2_not_configured" }, 503);
  }

  const exportId = c.req.param("id");
  const storage = getStorage(c);
  const deleted = await storage.deleteExport(userId, exportId);

  if (!deleted) {
    return c.json({ error: "export_not_found" }, 404);
  }

  return c.json({ ok: true });
});
