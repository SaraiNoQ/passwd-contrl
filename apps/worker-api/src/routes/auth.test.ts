/**
 * Auth route tests.
 *
 * Tests the full registration/login flow, session management,
 * CSRF validation, and rate limiting.
 *
 * Uses a mock D1 database since the test environment (miniflare)
 * doesn't provide a real D1 binding by default.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { buildAuthRoutes, resetGeneratedOpaqueServerSetupForTest, resolveOpaqueServerSetup } from "./auth";
import { csrf } from "../middleware/csrf";
import { sessionMiddleware } from "../middleware/session";
import { hashToken } from "../utils/crypto";
import { SESSION_COOKIE_NAME } from "../utils/cookies";

// ── Mock D1 Database ───────────────────────────────────────────────────────

interface MockRow {
  [key: string]: unknown;
}

/**
 * Minimal in-memory D1 mock for testing.
 * Supports SELECT (including JOIN), INSERT, DELETE with parameterized queries.
 */
function createMockD1() {
  const tables: Record<string, MockRow[]> = {
    users: [],
    sessions: [],
    registration_sessions: [],
    login_sessions: [],
    rate_limits: []
  };

  function findRows(sql: string, bindings: unknown[]): MockRow[] {
    const upper = sql.toUpperCase();

    // Handle JOIN queries (sessions JOIN users)
    if (upper.includes("JOIN")) {
      return handleJoin(sql, bindings);
    }

    // Single table query
    const table = detectTable(sql);
    if (!table || !tables[table]) return [];

    const whereFn = parseWhereClause(sql, bindings);
    if (whereFn) {
      return tables[table].filter(whereFn);
    }
    return tables[table];
  }

  function handleJoin(sql: string, bindings: unknown[]): MockRow[] {
    const upper = sql.toUpperCase();

    // Sessions JOIN users pattern
    if (upper.includes("FROM SESSIONS") && upper.includes("JOIN USERS")) {
      const sessionsRows = tables.sessions ?? [];
      const usersRows = tables.users ?? [];

      // Parse WHERE to filter on sessions table
      const whereFn = parseWhereClause(sql, bindings);

      const results: MockRow[] = [];
      for (const session of sessionsRows) {
        // Find matching user
        const user = usersRows.find((u) => u.id === session.user_id);
        if (!user) continue;

        // Merge session and user data
        const merged: MockRow = {
          ...session,
          ...user,
          // Preserve session fields with alias if needed
          user_id: session.user_id,
          csrf_token: session.csrf_token,
          expires_at: session.expires_at,
          uid: user.id,
          email: user.email,
          server_revision: user.server_revision,
          opaque_registration_record: user.opaque_registration_record,
          public_key_bundle: user.public_key_bundle
        };

        // Apply WHERE filter on the merged row
        if (!whereFn || whereFn(merged)) {
          results.push(merged);
        }
      }
      return results;
    }

    return [];
  }

  const db = {
    prepare: (sql: string) => {
      const stmt = {
        _sql: sql,
        _bindings: [] as unknown[],

        bind(...params: unknown[]) {
          stmt._bindings = params;
          return stmt;
        },

        async first<T>(): Promise<T | null> {
          const upper = stmt._sql.toUpperCase();

          // Handle COUNT(*) queries
          if (upper.includes("COUNT(*)")) {
            const rows = findRows(stmt._sql, stmt._bindings);
            return { cnt: rows.length } as T;
          }

          const rows = findRows(stmt._sql, stmt._bindings);
          return (rows[0] as T) ?? null;
        },

        async run() {
          const upper = stmt._sql.toUpperCase();
          const table = detectTable(stmt._sql);
          if (!table) return { success: true };

          if (upper.startsWith("INSERT")) {
            const row = buildRowFromInsert(stmt._sql, stmt._bindings);
            if (row && tables[table]) {
              tables[table].push(row);
            }
          } else if (upper.startsWith("DELETE")) {
            const whereFn = parseWhereClause(stmt._sql, stmt._bindings);
            if (whereFn && tables[table]) {
              tables[table] = tables[table].filter((row) => !whereFn(row));
            }
          }

          return { success: true };
        }
      };

      return stmt;
    },

    // Expose tables for test assertions
    _tables: tables
  };

  return db as typeof db & { _tables: typeof tables };
}

function detectTable(sql: string): string | null {
  const upper = sql.toUpperCase();

  // For INSERT and DELETE, look for the table name after INTO / FROM / DELETE FROM
  if (upper.includes("INTO USERS") || upper.startsWith("DELETE FROM USERS")) return "users";
  if (upper.includes("INTO SESSIONS") || upper.startsWith("DELETE FROM SESSIONS")) return "sessions";
  if (upper.includes("INTO REGISTRATION_SESSIONS") || upper.startsWith("DELETE FROM REGISTRATION_SESSIONS"))
    return "registration_sessions";
  if (upper.includes("INTO LOGIN_SESSIONS") || upper.startsWith("DELETE FROM LOGIN_SESSIONS"))
    return "login_sessions";
  if (upper.includes("INTO RATE_LIMITS") || upper.startsWith("DELETE FROM RATE_LIMITS"))
    return "rate_limits";

  // For SELECT, look for FROM clause
  if (upper.includes("FROM USERS")) return "users";
  if (upper.includes("FROM SESSIONS")) return "sessions";
  if (upper.includes("FROM REGISTRATION_SESSIONS")) return "registration_sessions";
  if (upper.includes("FROM LOGIN_SESSIONS")) return "login_sessions";
  if (upper.includes("FROM RATE_LIMITS")) return "rate_limits";

  return null;
}

function parseWhereClause(sql: string, params: unknown[]): ((row: MockRow) => boolean) | null {
  const upper = sql.toUpperCase();
  const whereIdx = upper.indexOf("WHERE");
  if (whereIdx === -1) return null;

  const whereClause = sql.slice(whereIdx + 5).trim();

  // Match patterns like "column = ?", "column > ?", "column <= ?", etc.
  const conditions: Array<{ column: string; op: string; value: unknown }> = [];
  const regex = /(?:\w+\.)?(\w+)\s*(=|>|<|>=|<=)\s*\?/gi;
  let match;
  let paramIdx = 0;

  while ((match = regex.exec(whereClause)) !== null) {
    const column = match[1]!.toLowerCase();
    const op = match[2]!;
    conditions.push({ column, op, value: params[paramIdx] });
    paramIdx++;
  }

  if (conditions.length === 0) return null;

  return (row: MockRow) =>
    conditions.every(({ column, op, value }) => {
      const rowVal = row[column];
      switch (op) {
        case "=": return rowVal === value;
        case ">": return (rowVal as number) > (value as number);
        case "<": return (rowVal as number) < (value as number);
        case ">=": return (rowVal as number) >= (value as number);
        case "<=": return (rowVal as number) <= (value as number);
        default: return false;
      }
    });
}

function buildRowFromInsert(sql: string, params: unknown[]): MockRow | null {
  const colMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
  if (!colMatch?.[1]) return null;

  const columns = colMatch[1].split(",").map((c) => c.trim().toLowerCase());
  const row: MockRow = {};

  columns.forEach((col, i) => {
    if (i < params.length) {
      row[col] = params[i];
    }
  });

  return row;
}

// ── Test Helpers ───────────────────────────────────────────────────────────

const createEnv = (db: ReturnType<typeof createMockD1>): Env =>
  ({
    DB: db as unknown as D1Database,
    ENVIRONMENT: "test",
    CORS_ORIGIN: "http://localhost:3000",
    OPAQUE_SERVER_SETUP: undefined
  }) as unknown as Env;

/**
 * Build a test app that mirrors the production app structure:
 * session middleware on all routes, then CSRF, then auth routes.
 */
function buildTestApp(db: ReturnType<typeof createMockD1>) {
  const app = new Hono<{ Bindings: Env }>();

  // Session middleware on all routes (reads cookie, attaches context)
  app.use("*", sessionMiddleware());

  // CSRF middleware on all routes (skips for unauthenticated requests)
  app.use("*", csrf());

  // Mount auth routes
  const auth = buildAuthRoutes();
  app.route("/", auth);

  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Auth routes", () => {
  let db: ReturnType<typeof createMockD1>;
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    db = createMockD1();
    app = buildTestApp(db);
  });

  describe("POST /auth/register/start", () => {
    it("returns 400 for invalid request body", async () => {
      const res = await app.request(
        "/auth/register/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "not-an-email" })
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("invalid_register_start_request");
    });

    it("returns 400 for malformed JSON", async () => {
      const res = await app.request(
        "/auth/register/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "not json{{"
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("invalid_register_start_request");
    });
  });

  describe("POST /auth/register/finish", () => {
    it("returns 400 for invalid registration session", async () => {
      const res = await app.request(
        "/auth/register/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            registrationSessionId: crypto.randomUUID(),
            email: "test@example.com",
            registrationRecord: "dGVzdA",
            publicKeyBundle: "dGVzdA",
            encryptedRecoveryPacket: {
              alg: "XCHACHA20_POLY1305",
              nonce: "dGVzdA",
              ciphertext: "dGVzdA"
            }
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("invalid_registration_session");
    });

    it("returns 409 if user already exists during finish", async () => {
      // Pre-create a user
      db._tables.users!.push({
        id: crypto.randomUUID(),
        email: "existing@example.com",
        opaque_registration_record: "existing-record",
        public_key_bundle: "existing-bundle",
        encrypted_recovery_packet: JSON.stringify({
          alg: "XCHACHA20_POLY1305",
          nonce: "dGVzdA",
          ciphertext: "dGVzdA"
        }),
        server_revision: 0
      });

      // Create a registration session for the same email
      const regSessionId = crypto.randomUUID();
      db._tables.registration_sessions!.push({
        id: regSessionId,
        email: "existing@example.com",
        expires_at: new Date(Date.now() + 600000).toISOString()
      });

      const res = await app.request(
        "/auth/register/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            registrationSessionId: regSessionId,
            email: "existing@example.com",
            registrationRecord: "dGVzdA",
            publicKeyBundle: "dGVzdA",
            encryptedRecoveryPacket: {
              alg: "XCHACHA20_POLY1305",
              nonce: "dGVzdA",
              ciphertext: "dGVzdA"
            }
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("user_exists");
    });
  });

  describe("POST /auth/login/start", () => {
    it("returns 404 for non-existent user", async () => {
      const res = await app.request(
        "/auth/login/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "nobody@example.com",
            startLoginRequest: "dGVzdA"
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("user_not_found");
    });

    it("returns 400 for invalid request body", async () => {
      const res = await app.request(
        "/auth/login/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: 123 })
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("invalid_login_start_request");
    });
  });

  describe("POST /auth/login/finish", () => {
    it("returns 400 for invalid login session", async () => {
      const res = await app.request(
        "/auth/login/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            loginSessionId: crypto.randomUUID(),
            finishLoginRequest: "dGVzdA"
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("invalid_login_session");
    });

    it("returns 400 for expired login session", async () => {
      const loginSessionId = crypto.randomUUID();
      const userId = crypto.randomUUID();

      db._tables.users!.push({
        id: userId,
        email: "test@example.com",
        opaque_registration_record: "dGVzdA",
        server_revision: 0
      });

      // Expired session
      db._tables.login_sessions!.push({
        id: loginSessionId,
        user_id: userId,
        server_login_state: "dGVzdA",
        expires_at: new Date(Date.now() - 60000).toISOString() // 1 minute ago
      });

      const res = await app.request(
        "/auth/login/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            loginSessionId,
            finishLoginRequest: "dGVzdA"
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("invalid_login_session");
    });
  });

  describe("GET /auth/session", () => {
    it("returns 401 when not authenticated", async () => {
      const res = await app.request("/auth/session", undefined, createEnv(db));

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("not_authenticated");
    });

    it("returns user info when authenticated", async () => {
      // Create a user and session in the mock DB
      const userId = crypto.randomUUID();
      const token = "test-session-token";
      const csrfToken = "test-csrf-token";
      const tokenHash = await hashToken(token);

      db._tables.users!.push({
        id: userId,
        email: "test@example.com",
        server_revision: 5,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA"
      });

      db._tables.sessions!.push({
        user_id: userId,
        token_hash: tokenHash,
        csrf_token: csrfToken,
        expires_at: new Date(Date.now() + 86400000).toISOString() // 24 hours
      });

      const res = await app.request(
        "/auth/session",
        {
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${token}`
          }
        },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const user = body.user as Record<string, unknown>;
      expect(user.id).toBe(userId);
      expect(user.email).toBe("test@example.com");
      expect(user.serverRevision).toBe(5);
      expect(body.csrfToken).toBe(csrfToken);
    });

    it("returns 401 for expired session", async () => {
      const userId = crypto.randomUUID();
      const token = "expired-token";
      const tokenHash = await hashToken(token);

      db._tables.users!.push({
        id: userId,
        email: "test@example.com",
        server_revision: 0,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA"
      });

      db._tables.sessions!.push({
        user_id: userId,
        token_hash: tokenHash,
        csrf_token: "csrf",
        expires_at: new Date(Date.now() - 86400000).toISOString() // 24 hours ago
      });

      const res = await app.request(
        "/auth/session",
        {
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${token}`
          }
        },
        createEnv(db)
      );

      expect(res.status).toBe(401);
    });
  });

  describe("POST /auth/logout", () => {
    it("returns 401 when not authenticated", async () => {
      const res = await app.request(
        "/auth/logout",
        {
          method: "POST",
          headers: { "content-type": "application/json" }
        },
        createEnv(db)
      );

      expect(res.status).toBe(401);
    });

    it("returns 403 when CSRF token is missing", async () => {
      const userId = crypto.randomUUID();
      const token = "valid-session-token";
      const csrfToken = "valid-csrf-token";
      const tokenHash = await hashToken(token);

      db._tables.users!.push({
        id: userId,
        email: "test@example.com",
        server_revision: 0,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA"
      });

      db._tables.sessions!.push({
        user_id: userId,
        token_hash: tokenHash,
        csrf_token: csrfToken,
        expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      // No CSRF header
      const res = await app.request(
        "/auth/logout",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `${SESSION_COOKIE_NAME}=${token}`
          }
        },
        createEnv(db)
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("csrf_token_required");
    });

    it("returns 403 when CSRF token is invalid", async () => {
      const userId = crypto.randomUUID();
      const token = "valid-session-token";
      const csrfToken = "valid-csrf-token";
      const tokenHash = await hashToken(token);

      db._tables.users!.push({
        id: userId,
        email: "test@example.com",
        server_revision: 0,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA"
      });

      db._tables.sessions!.push({
        user_id: userId,
        token_hash: tokenHash,
        csrf_token: csrfToken,
        expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const res = await app.request(
        "/auth/logout",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `${SESSION_COOKIE_NAME}=${token}`,
            "x-zero-vault-csrf": "wrong-csrf-token"
          }
        },
        createEnv(db)
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("csrf_token_required");
    });

    it("deletes session and clears cookie on success", async () => {
      const userId = crypto.randomUUID();
      const token = "valid-session-token";
      const csrfToken = "valid-csrf-token";
      const tokenHash = await hashToken(token);

      db._tables.users!.push({
        id: userId,
        email: "test@example.com",
        server_revision: 0,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA"
      });

      db._tables.sessions!.push({
        user_id: userId,
        token_hash: tokenHash,
        csrf_token: csrfToken,
        expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const res = await app.request(
        "/auth/logout",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `${SESSION_COOKIE_NAME}=${token}`,
            "x-zero-vault-csrf": csrfToken
          }
        },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);

      // Session should be deleted
      expect(db._tables.sessions).toHaveLength(0);

      // Set-Cookie header should clear the session cookie
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain(SESSION_COOKIE_NAME);
      expect(setCookie).toContain("Max-Age=0");
    });
  });

  describe("CSRF validation", () => {
    it("allows POST without CSRF token for unauthenticated requests", async () => {
      // Auth endpoints don't have a session, so CSRF should be skipped
      const res = await app.request(
        "/auth/login/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "test@example.com",
            startLoginRequest: "dGVzdA"
          })
        },
        createEnv(db)
      );

      // Should NOT be 403 (CSRF) — should be 404 (user not found) or 400 (validation)
      expect(res.status).not.toBe(403);
    });

    it("allows GET without CSRF token", async () => {
      const res = await app.request("/auth/session", undefined, createEnv(db));

      // Should NOT be 403 (CSRF) — GET is a safe method
      expect(res.status).toBe(401); // Not authenticated, but not CSRF error
    });
  });

  describe("Rate limiting", () => {
    it("returns 429 after exceeding rate limit on register/start", async () => {
      // Use a unique IP to avoid interference from the shared rate limit store
      const testIp = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

      // register/start has rateLimit({ max: 8 })
      const maxRequests = 8;

      // Send max + 1 requests sequentially (same IP) to trigger rate limit
      let rateLimited = false;
      for (let i = 0; i <= maxRequests; i++) {
        const res = await app.request(
          "/auth/register/start",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "cf-connecting-ip": testIp
            },
            body: JSON.stringify({
              email: `test${i}-${Date.now()}@example.com`,
              registrationRequest: "dGVzdA"
            })
          },
          createEnv(db)
        );

        if (res.status === 429) {
          rateLimited = true;
          const body = (await res.json()) as Record<string, unknown>;
          expect(body.error).toBe("请求过于频繁，请稍后再试");
          expect(res.headers.get("x-ratelimit-limit")).toBe(String(maxRequests));
          expect(res.headers.get("retry-after")).toBeTruthy();
          break;
        }
      }

      expect(rateLimited).toBe(true);
    });
  });
});

describe("resolveOpaqueServerSetup", () => {
  beforeEach(() => {
    resetGeneratedOpaqueServerSetupForTest();
  });

  it("uses the configured OPAQUE setup when present", () => {
    const createSetup = vi.fn(() => "generated-setup");
    const setup = resolveOpaqueServerSetup(
      { OPAQUE_SERVER_SETUP: "configured-setup" } as Env,
      { createSetup }
    );

    expect(setup).toBe("configured-setup");
    expect(createSetup).not.toHaveBeenCalled();
  });

  it("reuses one generated setup for local development", () => {
    const createSetup = vi
      .fn()
      .mockReturnValueOnce("generated-setup-1")
      .mockReturnValueOnce("generated-setup-2");

    const first = resolveOpaqueServerSetup({} as Env, { createSetup });
    const second = resolveOpaqueServerSetup({} as Env, { createSetup });

    expect(first).toBe(second);
    expect(first).toBe("generated-setup-1");
    expect(createSetup).toHaveBeenCalledTimes(1);
  });
});
