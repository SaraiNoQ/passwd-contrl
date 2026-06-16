/**
 * Export route tests.
 *
 * Tests authentication enforcement, export creation, listing,
 * and R2 integration for encrypted vault exports.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { exportRoutes } from "./exports";
import { sessionMiddleware } from "../middleware/session";
import { hashToken } from "../utils/crypto";
import { SESSION_COOKIE_NAME } from "../utils/cookies";

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
`;

function runMigration(db: MockD1Database): void {
  db.sqlite.exec(MIGRATION_SQL);
}

// ── R2 Mock ────────────────────────────────────────────────────────────────

interface MockR2Object {
  key: string;
  size: number;
  uploaded: Date;
  customMetadata?: Record<string, string>;
  body: ArrayBuffer;
  arrayBuffer(): Promise<ArrayBuffer>;
}

class MockR2Bucket {
  objects: Map<string, MockR2Object> = new Map();

  async put(
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    }
  ): Promise<void> {
    const body = value;
    this.objects.set(key, {
      key,
      size: value.byteLength,
      uploaded: new Date("2026-06-16T08:00:00.000Z"),
      customMetadata: options?.customMetadata,
      body,
      arrayBuffer: async () => body
    });
  }

  async get(key: string): Promise<MockR2Object | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<{ objects: MockR2Object[] }> {
    const prefix = options?.prefix ?? "";
    const objects = Array.from(this.objects.values()).filter((obj) =>
      obj.key.startsWith(prefix)
    );
    return { objects };
  }
}

// ── Test Helpers ───────────────────────────────────────────────────────────

function createEnv(db: MockD1Database, r2: MockR2Bucket): Env {
  return {
    DB: db as unknown as D1Database,
    R2: r2 as unknown as R2Bucket,
    ENVIRONMENT: "test",
    CORS_ORIGIN: "http://localhost:3000"
  } as unknown as Env;
}

function buildTestApp(db: MockD1Database, r2: MockR2Bucket) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", sessionMiddleware());
  app.route("/", exportRoutes);
  return app;
}

async function createAuthenticatedSession(db: MockD1Database) {
  const userId = crypto.randomUUID();
  const token = "exports-test-session-token";
  const csrfToken = "exports-test-csrf-token";
  const tokenHash = await hashToken(token);

  const now = new Date().toISOString();
  db.sqlite
    .prepare(
      `INSERT INTO users (id, email, opaque_registration_record, public_key_bundle, encrypted_recovery_packet, server_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      userId,
      "exports-test@example.com",
      "rec",
      "pk",
      "recovery-packet",
      now,
      now
    );

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

function authHeaders(token: string): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE_NAME}=${token}`
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Export routes", () => {
  let db: MockD1Database;
  let r2: MockR2Bucket;
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    db = createTestDB();
    r2 = new MockR2Bucket();
    runMigration(db);
    app = buildTestApp(db, r2);
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  describe("authentication", () => {
    it("POST /exports/create returns 401 without session", async () => {
      const res = await app.request(
        "/exports/create",
        {
          method: "POST",
          headers: {
            "x-export-id": crypto.randomUUID(),
            "content-type": "application/octet-stream"
          },
          body: new ArrayBuffer(16)
        },
        createEnv(db, r2)
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("unauthorized");
    });

    it("GET /exports returns 401 without session", async () => {
      const res = await app.request("/exports", undefined, createEnv(db, r2));

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("unauthorized");
    });

    it("GET /exports/:id returns 401 without session", async () => {
      const res = await app.request(
        `/exports/${crypto.randomUUID()}`,
        undefined,
        createEnv(db, r2)
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("unauthorized");
    });

    it("DELETE /exports/:id returns 401 without session", async () => {
      const res = await app.request(
        `/exports/${crypto.randomUUID()}`,
        { method: "DELETE" },
        createEnv(db, r2)
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("unauthorized");
    });
  });

  // ── GET /exports (list) ────────────────────────────────────────────────────

  describe("GET /exports", () => {
    it("returns empty list when no exports exist", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/exports",
        { headers: authHeaders(token) },
        createEnv(db, r2)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.exports).toEqual([]);
    });

    it("lists user exports after creation", async () => {
      const { token } = await createAuthenticatedSession(db);
      const exportId = crypto.randomUUID();

      // Create an export
      await app.request(
        "/exports/create",
        {
          method: "POST",
          headers: {
            ...authHeaders(token),
            "x-export-id": exportId,
            "content-type": "application/octet-stream"
          },
          body: new ArrayBuffer(32)
        },
        createEnv(db, r2)
      );

      // List exports
      const res = await app.request(
        "/exports",
        { headers: authHeaders(token) },
        createEnv(db, r2)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const exports = body.exports as Record<string, unknown>[];
      expect(exports).toHaveLength(1);
      expect(exports[0]!.id).toBe(exportId);
      expect(exports[0]!.size).toBe(32);
      expect(exports[0]!.algorithm).toBe("XCHACHA20_POLY1305");
      expect(Number.isFinite(new Date(exports[0]!.createdAt as string).getTime())).toBe(true);
    });

    it("falls back to the R2 upload timestamp for legacy exports without metadata timestamp", async () => {
      const { token, userId } = await createAuthenticatedSession(db);
      const exportId = crypto.randomUUID();
      const uploaded = new Date("2026-06-16T10:30:00.000Z");
      r2.objects.set(`exports/${userId}/${exportId}`, {
        key: `exports/${userId}/${exportId}`,
        size: 16,
        uploaded,
        customMetadata: { alg: "XCHACHA20_POLY1305" },
        body: new ArrayBuffer(16),
        arrayBuffer: async () => new ArrayBuffer(16)
      });

      const res = await app.request(
        "/exports",
        { headers: authHeaders(token) },
        createEnv(db, r2)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const exports = body.exports as Record<string, unknown>[];
      expect(exports[0]!.createdAt).toBe(uploaded.toISOString());
    });
  });

  // ── POST /exports/create ──────────────────────────────────────────────────

  describe("POST /exports/create", () => {
    it("creates an export with authenticated session", async () => {
      const { token } = await createAuthenticatedSession(db);
      const exportId = crypto.randomUUID();
      const encryptedData = new ArrayBuffer(64);

      const res = await app.request(
        "/exports/create",
        {
          method: "POST",
          headers: {
            ...authHeaders(token),
            "x-export-id": exportId,
            "content-type": "application/octet-stream"
          },
          body: encryptedData
        },
        createEnv(db, r2)
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
      expect(body.size).toBe(64);
      expect(typeof body.key).toBe("string");

      // Verify the export was stored in R2
      expect(r2.objects.size).toBe(1);
    });

    it("returns 400 when x-export-id header is missing", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/exports/create",
        {
          method: "POST",
          headers: {
            ...authHeaders(token),
            "content-type": "application/octet-stream"
          },
          body: new ArrayBuffer(16)
        },
        createEnv(db, r2)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("export_id_required");
    });

    it("returns 400 when body is empty", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/exports/create",
        {
          method: "POST",
          headers: {
            ...authHeaders(token),
            "x-export-id": crypto.randomUUID(),
            "content-type": "application/octet-stream"
          },
          body: new ArrayBuffer(0)
        },
        createEnv(db, r2)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("empty_body");
    });

    it("stores export with custom algorithm metadata", async () => {
      const { token } = await createAuthenticatedSession(db);
      const exportId = crypto.randomUUID();

      const res = await app.request(
        "/exports/create",
        {
          method: "POST",
          headers: {
            ...authHeaders(token),
            "x-export-id": exportId,
            "x-export-algorithm": "AES256_GCM",
            "content-type": "application/octet-stream"
          },
          body: new ArrayBuffer(48)
        },
        createEnv(db, r2)
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);

      // Check the stored object metadata
      const storedEntry = Array.from(r2.objects.values())[0];
      expect(storedEntry!.customMetadata!.alg).toBe("AES256_GCM");
    });
  });

  // ── GET /exports/:id ──────────────────────────────────────────────────────

  describe("GET /exports/:id", () => {
    it("returns 404 for non-existent export", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        `/exports/${crypto.randomUUID()}`,
        { headers: authHeaders(token) },
        createEnv(db, r2)
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("export_not_found");
    });

    it("downloads an existing export", async () => {
      const { token } = await createAuthenticatedSession(db);
      const exportId = crypto.randomUUID();
      const encryptedData = new TextEncoder().encode("encrypted-vault-data").buffer as ArrayBuffer;

      // Create the export
      await app.request(
        "/exports/create",
        {
          method: "POST",
          headers: {
            ...authHeaders(token),
            "x-export-id": exportId,
            "content-type": "application/octet-stream"
          },
          body: encryptedData
        },
        createEnv(db, r2)
      );

      // Download it
      const res = await app.request(
        `/exports/${exportId}`,
        { headers: authHeaders(token) },
        createEnv(db, r2)
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("x-export-algorithm")).toBe("XCHACHA20_POLY1305");
    });
  });

  // ── DELETE /exports/:id ───────────────────────────────────────────────────

  describe("DELETE /exports/:id", () => {
    it("returns 404 for non-existent export", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        `/exports/${crypto.randomUUID()}`,
        { method: "DELETE", headers: authHeaders(token) },
        createEnv(db, r2)
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("export_not_found");
    });

    it("deletes an existing export", async () => {
      const { token } = await createAuthenticatedSession(db);
      const exportId = crypto.randomUUID();

      // Create the export
      await app.request(
        "/exports/create",
        {
          method: "POST",
          headers: {
            ...authHeaders(token),
            "x-export-id": exportId,
            "content-type": "application/octet-stream"
          },
          body: new ArrayBuffer(16)
        },
        createEnv(db, r2)
      );

      // Delete it
      const res = await app.request(
        `/exports/${exportId}`,
        { method: "DELETE", headers: authHeaders(token) },
        createEnv(db, r2)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);

      // Verify it's gone
      expect(r2.objects.size).toBe(0);
    });
  });
});
