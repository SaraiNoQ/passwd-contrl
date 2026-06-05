/**
 * Recovery route tests.
 *
 * Tests GET/POST /vault/recovery-packet for saving, retrieving, and rotating
 * recovery packets. Also verifies authentication enforcement and CSRF validation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { buildRecoveryRoutes } from "./recovery";
import { csrf } from "../middleware/csrf";
import { sessionMiddleware } from "../middleware/session";
import { hashToken } from "../utils/crypto";
import { SESSION_COOKIE_NAME } from "../utils/cookies";
import type { CiphertextEnvelope } from "@zero-vault/shared";

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

  CREATE TABLE IF NOT EXISTS recovery_packets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_recovery_packet TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  const recovery = buildRecoveryRoutes();
  app.route("/", recovery);
  return app;
}

async function createAuthenticatedSession(db: MockD1Database) {
  const userId = crypto.randomUUID();
  const token = "recovery-test-session-token";
  const csrfToken = "recovery-test-csrf-token";
  const tokenHash = await hashToken(token);

  const now = new Date().toISOString();
  db.sqlite
    .prepare(
      `INSERT INTO users (id, email, opaque_registration_record, public_key_bundle, encrypted_recovery_packet, server_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(userId, "recovery-test@example.com", "rec", "pk", JSON.stringify(mockEnvelope), now, now);

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

describe("Recovery routes", () => {
  let db: MockD1Database;
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    db = createTestDB();
    runMigration(db);
    app = buildTestApp(db);
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  describe("authentication", () => {
    it("GET /vault/recovery-packet returns 401 without session", async () => {
      const res = await app.request("/vault/recovery-packet", undefined, createEnv(db));
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("not_authenticated");
    });

    it("POST /vault/recovery-packet returns 401 without session", async () => {
      const res = await app.request(
        "/vault/recovery-packet",
        {
          method: "POST",
          headers: { "content-type": "application/json" }
        },
        createEnv(db)
      );
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("not_authenticated");
    });
  });

  // ── CSRF ───────────────────────────────────────────────────────────────────

  describe("CSRF validation", () => {
    it("POST /vault/recovery-packet returns 403 without CSRF header", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/recovery-packet",
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

    it("GET /vault/recovery-packet does not require CSRF", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/recovery-packet",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      // Should not be 403 (CSRF), may be 404 (no packet) or 200
      expect(res.status).not.toBe(403);
    });
  });

  // ── GET /vault/recovery-packet ─────────────────────────────────────────────

  describe("GET /vault/recovery-packet", () => {
    it("returns initial registration packet when no rotation has been done", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/recovery-packet",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      // The registration stores the initial packet in the users table;
      // getRecoveryPacket falls back to it.
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.encryptedRecoveryPacket).toEqual(mockEnvelope);
    });

    it("returns recovery packet after it has been saved", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      // Save a packet first
      await app.request(
        "/vault/recovery-packet",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ encryptedRecoveryPacket: mockEnvelope })
        },
        createEnv(db)
      );

      // Retrieve it
      const res = await app.request(
        "/vault/recovery-packet",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.encryptedRecoveryPacket).toEqual(mockEnvelope);
    });
  });

  // ── POST /vault/recovery-packet ────────────────────────────────────────────

  describe("POST /vault/recovery-packet", () => {
    it("saves a recovery packet", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/recovery-packet",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ encryptedRecoveryPacket: mockEnvelope })
        },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
    });

    it("rotates an existing recovery packet", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      // Save initial packet
      await app.request(
        "/vault/recovery-packet",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ encryptedRecoveryPacket: mockEnvelope })
        },
        createEnv(db)
      );

      // Rotate with a new packet
      const newEnvelope: CiphertextEnvelope = {
        alg: "AES_256_GCM",
        nonce: "bmV3",
        ciphertext: "bmV3"
      };
      const res = await app.request(
        "/vault/recovery-packet",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ encryptedRecoveryPacket: newEnvelope })
        },
        createEnv(db)
      );

      expect(res.status).toBe(200);

      // Verify the rotated packet
      const getRes = await app.request(
        "/vault/recovery-packet",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );
      const body = (await getRes.json()) as Record<string, unknown>;
      expect((body.encryptedRecoveryPacket as Record<string, unknown>).alg).toBe("AES_256_GCM");
      expect((body.encryptedRecoveryPacket as Record<string, unknown>).nonce).toBe("bmV3");
    });

    it("returns 400 for invalid request body", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/vault/recovery-packet",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ invalid: true })
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("invalid_recovery_packet_request");
    });
  });
});
