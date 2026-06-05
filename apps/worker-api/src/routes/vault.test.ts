/**
 * Vault route tests.
 *
 * Tests legacy vault sync (push/pull), item-level sync (push/pull/conflicts),
 * item history, authentication enforcement, and CSRF validation.
 *
 * Uses a real SQLite-backed mock D1 (via better-sqlite3) because the routes
 * use D1VaultStore which calls db.batch(), ON CONFLICT, UPDATE, etc.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { buildVaultRoutes } from "./vault";
import { csrf } from "../middleware/csrf";
import { sessionMiddleware } from "../middleware/session";
import { hashToken } from "../utils/crypto";
import { SESSION_COOKIE_NAME } from "../utils/cookies";
import type { CiphertextEnvelope, VaultItemCiphertext } from "@zero-vault/shared";

// ── D1 Mock (better-sqlite3) ───────────────────────────────────────────────

class MockD1Result {
  success = true;
  meta: { changes?: number };
  constructor(changes = 0) {
    this.meta = { changes };
  }
}

class MockD1PreparedStatement {
  private db: MockD1Database;
  _sql: string;
  _params: unknown[] = [];

  constructor(db: MockD1Database, sql: string) {
    this.db = db;
    this._sql = sql;
  }

  bind(...params: unknown[]): this {
    this._params = params;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    try {
      const stmt = this.db.sqlite.prepare(this._sql);
      const row = stmt.get(...this._params) as T | undefined;
      return row ?? null;
    } catch {
      return null;
    }
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    try {
      const stmt = this.db.sqlite.prepare(this._sql);
      const rows = stmt.all(...this._params) as T[];
      return { results: rows };
    } catch {
      return { results: [] };
    }
  }

  async run(): Promise<MockD1Result> {
    const stmt = this.db.sqlite.prepare(this._sql);
    const info = stmt.run(...this._params);
    return new MockD1Result(info.changes);
  }

  runSync(): MockD1Result {
    const stmt = this.db.sqlite.prepare(this._sql);
    const info = stmt.run(...this._params);
    return new MockD1Result(info.changes);
  }
}

class MockD1Database {
  sqlite: import("better-sqlite3").Database;

  constructor(sqlite: import("better-sqlite3").Database) {
    this.sqlite = sqlite;
  }

  prepare(sql: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(this, sql);
  }

  async batch(stmts: MockD1PreparedStatement[]): Promise<void> {
    this.sqlite.transaction(() => {
      for (const stmt of stmts) {
        stmt.runSync();
      }
    })();
  }
}

function createTestDB(): MockD1Database {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return new MockD1Database(sqlite);
}

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    opaque_registration_record TEXT NOT NULL,
    public_key_bundle TEXT NOT NULL,
    encrypted_recovery_packet TEXT NOT NULL,
    server_revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vault_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    encrypted_item_key TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL,
    encrypted_search_tokens TEXT NOT NULL DEFAULT '[]',
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS vault_item_history (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES vault_items(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function runMigration(db: MockD1Database): void {
  db.sqlite.exec(MIGRATION_SQL);
}

// ── Test Helpers ───────────────────────────────────────────────────────────

const mockEnvelope: CiphertextEnvelope = {
  alg: "XCHACHA20_POLY1305",
  nonce: "dGVzdA",
  ciphertext: "dGVzdA"
};

function makeItem(overrides: Partial<VaultItemCiphertext> = {}): VaultItemCiphertext {
  return {
    id: "a0000000-0000-0000-0000-000000000001",
    ownerUserId: "",
    revision: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    encryptedItemKey: mockEnvelope,
    encryptedPayload: mockEnvelope,
    encryptedSearchTokens: [],
    ...overrides
  };
}

const createEnv = (db: MockD1Database): Env =>
  ({
    DB: db as unknown as D1Database,
    ENVIRONMENT: "test",
    CORS_ORIGIN: "http://localhost:3000"
  }) as unknown as Env;

function buildTestApp(db: MockD1Database) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", sessionMiddleware());
  app.use("*", csrf());
  const vault = buildVaultRoutes();
  app.route("/", vault);
  return app;
}

/**
 * Create an authenticated user and session in the mock DB.
 * Returns the session token, CSRF token, and user ID.
 */
async function createAuthenticatedSession(db: MockD1Database) {
  const userId = crypto.randomUUID();
  const token = "vault-test-session-token";
  const csrfToken = "vault-test-csrf-token";
  const tokenHash = await hashToken(token);

  const now = new Date().toISOString();
  db.sqlite
    .prepare(
      `INSERT INTO users (id, email, opaque_registration_record, public_key_bundle, encrypted_recovery_packet, server_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(userId, "vault-test@example.com", "rec", "pk", JSON.stringify(mockEnvelope), now, now);

  db.sqlite
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      crypto.randomUUID(),
      userId,
      tokenHash,
      csrfToken,
      new Date(Date.now() + 86400000).toISOString(),
      now
    );

  return { userId, token, csrfToken };
}

function authHeaders(token: string, csrfToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    cookie: `${SESSION_COOKIE_NAME}=${token}`,
    "content-type": "application/json"
  };
  if (csrfToken) {
    headers["x-zero-vault-csrf"] = csrfToken;
  }
  return headers;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Vault routes", () => {
  let db: MockD1Database;
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    db = createTestDB();
    runMigration(db);
    app = buildTestApp(db);
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  describe("authentication", () => {
    it("GET /vault/sync returns 401 without session", async () => {
      const res = await app.request("/vault/sync", undefined, createEnv(db));
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("not_authenticated");
    });

    it("POST /vault/sync returns 401 without session", async () => {
      const res = await app.request(
        "/vault/sync",
        { method: "POST", headers: { "content-type": "application/json" } },
        createEnv(db)
      );
      expect(res.status).toBe(401);
    });

    it("GET /vault/item-sync returns 401 without session", async () => {
      const res = await app.request("/vault/item-sync", undefined, createEnv(db));
      expect(res.status).toBe(401);
    });

    it("POST /vault/item-sync returns 401 without session", async () => {
      const res = await app.request(
        "/vault/item-sync",
        { method: "POST", headers: { "content-type": "application/json" } },
        createEnv(db)
      );
      expect(res.status).toBe(401);
    });

    it("GET /vault/items/:id/history returns 401 without session", async () => {
      const res = await app.request(
        "/vault/items/a0000000-0000-0000-0000-000000000001/history",
        undefined,
        createEnv(db)
      );
      expect(res.status).toBe(401);
    });
  });

  // ── CSRF ───────────────────────────────────────────────────────────────────

  describe("CSRF validation", () => {
    it("POST /vault/sync returns 403 without CSRF header", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/sync",
        {
          method: "POST",
          headers: authHeaders(token) // no CSRF token
        },
        createEnv(db)
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("csrf_token_required");
    });

    it("POST /vault/item-sync returns 403 without CSRF header", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/item-sync",
        {
          method: "POST",
          headers: authHeaders(token)
        },
        createEnv(db)
      );

      expect(res.status).toBe(403);
    });

    it("GET /vault/sync does not require CSRF", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/sync",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(200);
    });
  });

  // ── Legacy Vault Sync ─────────────────────────────────────────────────────

  describe("GET /vault/sync (legacy pull)", () => {
    it("returns empty vault for new user", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/sync",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.serverRevision).toBe(0);
      expect(body.items).toEqual([]);
      expect(body.deletedItemIds).toEqual([]);
    });
  });

  describe("POST /vault/sync (legacy push)", () => {
    it("pushes items and returns new revision", async () => {
      const { token, csrfToken, userId } = await createAuthenticatedSession(db);

      const item = makeItem({ ownerUserId: userId });
      const res = await app.request(
        "/vault/sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({
            baseRevision: 0,
            upserts: [item],
            deletes: []
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.serverRevision).toBe(1);
    });

    it("returns 409 on revision conflict", async () => {
      const { token, csrfToken, userId } = await createAuthenticatedSession(db);

      const item = makeItem({ ownerUserId: userId });
      // First push succeeds
      await app.request(
        "/vault/sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ baseRevision: 0, upserts: [item], deletes: [] })
        },
        createEnv(db)
      );

      // Second push with stale revision
      const res = await app.request(
        "/vault/sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ baseRevision: 0, upserts: [item], deletes: [] })
        },
        createEnv(db)
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("sync_conflict");
      expect(body.serverRevision).toBe(1);
    });

    it("returns 400 for invalid request body", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ invalid: true })
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("invalid_sync_request");
    });

    it("push then pull round-trips items", async () => {
      const { token, csrfToken, userId } = await createAuthenticatedSession(db);
      const item = makeItem({ ownerUserId: userId });

      // Push
      await app.request(
        "/vault/sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ baseRevision: 0, upserts: [item], deletes: [] })
        },
        createEnv(db)
      );

      // Pull
      const res = await app.request(
        "/vault/sync",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.serverRevision).toBe(1);
      expect(body.items).toHaveLength(1);
      expect((body.items as Record<string, unknown>[])[0]!.id).toBe(item.id);
    });
  });

  // ── Item-Level Sync ────────────────────────────────────────────────────────

  describe("GET /vault/item-sync", () => {
    it("returns empty vault for new user", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/item-sync",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.serverRevision).toBe(0);
      expect(body.items).toEqual([]);
      expect(body.deletedItemIds).toEqual([]);
    });
  });

  describe("POST /vault/item-sync", () => {
    it("pushes items and returns applied ids", async () => {
      const { token, csrfToken, userId } = await createAuthenticatedSession(db);
      const item = makeItem({ ownerUserId: userId });

      const res = await app.request(
        "/vault/item-sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({
            protocol: "item_level_v1",
            baseRevision: 0,
            upserts: [item],
            deletes: []
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.protocol).toBe("item_level_v1");
      expect(body.serverRevision).toBe(1);
      expect((body.applied as Record<string, unknown>).upsertedItemIds).toContain(item.id);
      expect((body.applied as Record<string, unknown>).deletedItemIds).toEqual([]);
      expect(body.conflicts).toEqual([]);
    });

    it("returns 409 with conflicts on server revision mismatch", async () => {
      const { token, csrfToken, userId } = await createAuthenticatedSession(db);
      const item = makeItem({ ownerUserId: userId });

      // First push advances revision to 1
      await app.request(
        "/vault/item-sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({
            protocol: "item_level_v1",
            baseRevision: 0,
            upserts: [item],
            deletes: []
          })
        },
        createEnv(db)
      );

      // Second push with stale baseRevision
      const res = await app.request(
        "/vault/item-sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({
            protocol: "item_level_v1",
            baseRevision: 0,
            upserts: [item],
            deletes: []
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("sync_conflict");
      expect(body.conflicts).toHaveLength(1);
      expect((body.conflicts as Record<string, unknown>[])[0]!.reason).toBe("server_revision_advanced");
    });

    it("returns 400 for invalid request body", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/item-sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ invalid: true })
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("invalid_item_sync_request");
    });

    it("deletes items via item-level sync", async () => {
      const { token, csrfToken, userId } = await createAuthenticatedSession(db);
      const item = makeItem({ ownerUserId: userId });

      // Push item first
      await app.request(
        "/vault/item-sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({
            protocol: "item_level_v1",
            baseRevision: 0,
            upserts: [item],
            deletes: []
          })
        },
        createEnv(db)
      );

      // Delete item
      const res = await app.request(
        "/vault/item-sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({
            protocol: "item_level_v1",
            baseRevision: 1,
            upserts: [],
            deletes: [
              {
                id: item.id,
                ownerUserId: userId,
                deletedAt: "2025-06-01T00:00:00.000Z"
              }
            ]
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.applied as Record<string, unknown>).deletedItemIds).toContain(item.id);

      // Pull should show deleted
      const pullRes = await app.request(
        "/vault/item-sync",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );
      const pullBody = (await pullRes.json()) as Record<string, unknown>;
      expect(pullBody.items).toHaveLength(0);
      expect(pullBody.deletedItemIds).toContain(item.id);
    });
  });

  // ── Item History ───────────────────────────────────────────────────────────

  describe("GET /vault/items/:id/history", () => {
    it("returns empty history for unknown item", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/items/a0000000-0000-0000-0000-000000000001/history",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.versions).toEqual([]);
    });

    it("returns history after pushing items", async () => {
      const { token, csrfToken, userId } = await createAuthenticatedSession(db);
      const itemId = "a0000000-0000-0000-0000-000000000001";
      const item = makeItem({ id: itemId, ownerUserId: userId });

      // Push v1
      await app.request(
        "/vault/sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ baseRevision: 0, upserts: [item], deletes: [] })
        },
        createEnv(db)
      );

      // Push v2
      const updatedItem = makeItem({
        id: itemId,
        ownerUserId: userId,
        updatedAt: "2025-06-01T00:00:00.000Z"
      });
      await app.request(
        "/vault/sync",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ baseRevision: 1, upserts: [updatedItem], deletes: [] })
        },
        createEnv(db)
      );

      const res = await app.request(
        `/vault/items/${itemId}/history`,
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.itemId).toBe(itemId);
      expect(body.versions).toHaveLength(2);
      expect((body.versions as Record<string, unknown>[])[0]!.revision).toBe(2);
      expect((body.versions as Record<string, unknown>[])[1]!.revision).toBe(1);
    });
  });
});
