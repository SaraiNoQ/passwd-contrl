/**
 * Device trust route tests.
 *
 * Tests device registration, listing, approval, rejection, revocation,
 * vault key sharing, authentication enforcement, and CSRF validation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { buildDeviceRoutes } from "./devices";
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

  CREATE TABLE IF NOT EXISTS trusted_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS device_vault_keys (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    encrypted_blob TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, device_id)
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
  const devices = buildDeviceRoutes();
  app.route("/", devices);
  return app;
}

async function createAuthenticatedSession(db: MockD1Database) {
  const userId = crypto.randomUUID();
  const token = "devices-test-session-token";
  const csrfToken = "devices-test-csrf-token";
  const tokenHash = await hashToken(token);

  const now = new Date().toISOString();
  db.sqlite
    .prepare(
      `INSERT INTO users (id, email, opaque_registration_record, public_key_bundle, encrypted_recovery_packet, server_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      userId,
      "devices-test@example.com",
      "rec",
      "pk",
      JSON.stringify(mockEnvelope),
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

describe("Device routes", () => {
  let db: MockD1Database;
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    db = createTestDB();
    runMigration(db);
    app = buildTestApp(db);
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  describe("authentication", () => {
    it("GET /devices returns 401 without session", async () => {
      const res = await app.request("/devices", undefined, createEnv(db));
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("not_authenticated");
    });

    it("POST /devices returns 401 without session", async () => {
      const res = await app.request(
        "/devices",
        {
          method: "POST",
          headers: { "content-type": "application/json" }
        },
        createEnv(db)
      );
      expect(res.status).toBe(401);
    });

    it("POST /devices/:id/approve returns 401 without session", async () => {
      const res = await app.request(
        "/devices/some-id/approve",
        {
          method: "POST",
          headers: { "content-type": "application/json" }
        },
        createEnv(db)
      );
      expect(res.status).toBe(401);
    });

    it("POST /devices/:id/reject returns 401 without session", async () => {
      const res = await app.request(
        "/devices/some-id/reject",
        {
          method: "POST",
          headers: { "content-type": "application/json" }
        },
        createEnv(db)
      );
      expect(res.status).toBe(401);
    });

    it("POST /devices/:id/revoke returns 401 without session", async () => {
      const res = await app.request(
        "/devices/some-id/revoke",
        {
          method: "POST",
          headers: { "content-type": "application/json" }
        },
        createEnv(db)
      );
      expect(res.status).toBe(401);
    });

    it("POST /devices/:id/share-key returns 401 without session", async () => {
      const res = await app.request(
        "/devices/some-id/share-key",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ encryptedVaultKey: "abc" })
        },
        createEnv(db)
      );
      expect(res.status).toBe(401);
    });
  });

  // ── CSRF ───────────────────────────────────────────────────────────────────

  describe("CSRF validation", () => {
    it("POST /devices returns 403 without CSRF header", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token) // no CSRF
        },
        createEnv(db)
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("csrf_token_required");
    });

    it("GET /devices does not require CSRF", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/devices",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(200);
    });
  });

  // ── POST /devices (register) ───────────────────────────────────────────────

  describe("POST /devices", () => {
    it("registers a new device", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({
            name: "My Laptop",
            publicKey: "dGVzdC1way"
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.name).toBe("My Laptop");
      expect(body.publicKey).toBe("dGVzdC1way");
      expect(body.status).toBe("pending");
      expect(body.id).toBeTruthy();
    });

    it("returns the existing device when the same public key registers again", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const first = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({
            name: "My Laptop",
            publicKey: "dGVzdC1way"
          })
        },
        createEnv(db)
      );
      const firstBody = (await first.json()) as Record<string, unknown>;

      const second = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({
            name: "My Laptop Renamed",
            publicKey: "dGVzdC1way"
          })
        },
        createEnv(db)
      );

      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as Record<string, unknown>;
      expect(secondBody.id).toBe(firstBody.id);
      expect(secondBody.name).toBe("My Laptop Renamed");

      const list = await app.request(
        "/devices",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );
      const listBody = (await list.json()) as Record<string, unknown>;
      expect(listBody.devices).toHaveLength(1);
    });

    it("returns 400 for invalid request body", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ name: "" }) // missing publicKey, empty name
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("invalid_register_device_request");
    });
  });

  // ── GET /devices (list) ────────────────────────────────────────────────────

  describe("GET /devices", () => {
    it("returns empty list when no devices", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/devices",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.devices).toEqual([]);
    });

    it("lists registered devices", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      // Register a device
      await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({
            name: "My Phone",
            publicKey: "dGVzdC1wayQ"
          })
        },
        createEnv(db)
      );

      const res = await app.request(
        "/devices",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.devices).toHaveLength(1);
      expect((body.devices as Record<string, unknown>[])[0]!.name).toBe("My Phone");
      expect((body.devices as Record<string, unknown>[])[0]!.status).toBe("pending");
    });
  });

  // ── POST /devices/:id/approve ──────────────────────────────────────────────

  describe("POST /devices/:id/approve", () => {
    it("approves a pending device", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      // Register
      const regRes = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ name: "Laptop", publicKey: "dGVzdC1way" })
        },
        createEnv(db)
      );
      const { id: deviceId } = (await regRes.json()) as Record<string, unknown>;

      // Approve
      const res = await app.request(
        `/devices/${deviceId}/approve`,
        {
          method: "POST",
          headers: authHeaders(token, csrfToken)
        },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);

      // Verify status changed
      const listRes = await app.request(
        "/devices",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );
      const listBody = (await listRes.json()) as Record<string, unknown>;
      expect((listBody.devices as Record<string, unknown>[])[0]!.status).toBe("approved");
    });

    it("returns 404 for non-existent device", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/devices/nonexistent-id/approve",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken)
        },
        createEnv(db)
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("device_not_found");
    });
  });

  // ── POST /devices/:id/reject ───────────────────────────────────────────────

  describe("POST /devices/:id/reject", () => {
    it("rejects a pending device", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      // Register
      const regRes = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ name: "Laptop", publicKey: "dGVzdC1way" })
        },
        createEnv(db)
      );
      const { id: deviceId } = (await regRes.json()) as Record<string, unknown>;

      // Reject
      const res = await app.request(
        `/devices/${deviceId}/reject`,
        {
          method: "POST",
          headers: authHeaders(token, csrfToken)
        },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);

      // Verify status changed
      const listRes = await app.request(
        "/devices",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );
      const listBody = (await listRes.json()) as Record<string, unknown>;
      expect((listBody.devices as Record<string, unknown>[])[0]!.status).toBe("rejected");
    });

    it("returns 404 for non-existent device", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/devices/nonexistent-id/reject",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken)
        },
        createEnv(db)
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("device_not_found");
    });
  });

  // ── POST /devices/:id/revoke ───────────────────────────────────────────────

  describe("POST /devices/:id/revoke", () => {
    it("revokes an approved device", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      // Register and approve
      const regRes = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ name: "Laptop", publicKey: "dGVzdC1way" })
        },
        createEnv(db)
      );
      const { id: deviceId } = (await regRes.json()) as Record<string, unknown>;

      await app.request(
        `/devices/${deviceId}/approve`,
        {
          method: "POST",
          headers: authHeaders(token, csrfToken)
        },
        createEnv(db)
      );

      // Revoke
      const res = await app.request(
        `/devices/${deviceId}/revoke`,
        {
          method: "POST",
          headers: authHeaders(token, csrfToken)
        },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);

      // Verify status changed
      const listRes = await app.request(
        "/devices",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );
      const listBody = (await listRes.json()) as Record<string, unknown>;
      expect((listBody.devices as Record<string, unknown>[])[0]!.status).toBe("revoked");
    });

    it("returns 404 for non-existent device", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/devices/nonexistent-id/revoke",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken)
        },
        createEnv(db)
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("device_not_found");
    });
  });

  // ── GET /devices/:id/key ──────────────────────────────────────────────────

  describe("GET /devices/:id/key", () => {
    it("returns 401 without session", async () => {
      const res = await app.request("/devices/some-id/key", undefined, createEnv(db));
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("not_authenticated");
    });

    it("returns 404 for non-existent device", async () => {
      const { token } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/devices/nonexistent-id/key",
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("device_not_found");
    });

    it("returns 403 for pending device", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      // Register device (pending)
      const regRes = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ name: "Laptop", publicKey: "dGVzdC1way" })
        },
        createEnv(db)
      );
      const { id: deviceId } = (await regRes.json()) as Record<string, unknown>;

      const res = await app.request(
        `/devices/${deviceId}/key`,
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("device_not_approved");
    });

    it("returns encrypted vault key for approved device with shared key", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      // Register and approve
      const regRes = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ name: "Laptop", publicKey: "dGVzdC1way" })
        },
        createEnv(db)
      );
      const { id: deviceId } = (await regRes.json()) as Record<string, unknown>;

      await app.request(
        `/devices/${deviceId}/approve`,
        {
          method: "POST",
          headers: authHeaders(token, csrfToken)
        },
        createEnv(db)
      );

      // Share key
      await app.request(
        `/devices/${deviceId}/share-key`,
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ encryptedVaultKey: "encrypted-key-blob-123" })
        },
        createEnv(db)
      );

      // Fetch key
      const res = await app.request(
        `/devices/${deviceId}/key`,
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.encryptedVaultKey).toBe("encrypted-key-blob-123");
    });

    it("returns 404 for approved device with no shared key", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      // Register and approve (but do NOT share key)
      const regRes = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ name: "Laptop", publicKey: "dGVzdC1way" })
        },
        createEnv(db)
      );
      const { id: deviceId } = (await regRes.json()) as Record<string, unknown>;

      await app.request(
        `/devices/${deviceId}/approve`,
        {
          method: "POST",
          headers: authHeaders(token, csrfToken)
        },
        createEnv(db)
      );

      const res = await app.request(
        `/devices/${deviceId}/key`,
        { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("key_not_shared");
    });
  });

  // ── POST /devices/:id/share-key ────────────────────────────────────────────

  describe("POST /devices/:id/share-key", () => {
    it("shares encrypted vault key with an approved device", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      // Register and approve a device
      const regRes = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ name: "Laptop", publicKey: "dGVzdC1way" })
        },
        createEnv(db)
      );
      const { id: deviceId } = (await regRes.json()) as Record<string, unknown>;

      await app.request(
        `/devices/${deviceId}/approve`,
        {
          method: "POST",
          headers: authHeaders(token, csrfToken)
        },
        createEnv(db)
      );

      // Share key
      const res = await app.request(
        `/devices/${deviceId}/share-key`,
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ encryptedVaultKey: "encrypted-key-blob" })
        },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
    });

    it("returns 400 when encryptedVaultKey is missing", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const regRes = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ name: "Laptop", publicKey: "dGVzdC1way" })
        },
        createEnv(db)
      );
      const { id: deviceId } = (await regRes.json()) as Record<string, unknown>;

      const res = await app.request(
        `/devices/${deviceId}/share-key`,
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({}) // no encryptedVaultKey
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("encrypted_vault_key_required");
    });

    it("returns 400 when encryptedVaultKey is empty string", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const regRes = await app.request(
        "/devices",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ name: "Laptop", publicKey: "dGVzdC1way" })
        },
        createEnv(db)
      );
      const { id: deviceId } = (await regRes.json()) as Record<string, unknown>;

      const res = await app.request(
        `/devices/${deviceId}/share-key`,
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ encryptedVaultKey: "" })
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("encrypted_vault_key_required");
    });

    it("returns 404 for non-existent device", async () => {
      const { token, csrfToken } = await createAuthenticatedSession(db);

      const res = await app.request(
        "/devices/nonexistent-id/share-key",
        {
          method: "POST",
          headers: authHeaders(token, csrfToken),
          body: JSON.stringify({ encryptedVaultKey: "encrypted-key-blob" })
        },
        createEnv(db)
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("device_not_found");
    });
  });
});
