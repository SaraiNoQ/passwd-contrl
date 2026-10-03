/**
 * Auth route tests.
 *
 * Tests the full registration/login flow, session management,
 * CSRF validation, and rate limiting.
 *
 * Uses a mock D1 database since the test environment (miniflare)
 * doesn't provide a real D1 binding by default.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { buildAuthRoutes, resetGeneratedOpaqueServerSetupForTest, resolveOpaqueServerSetup } from "./auth";
import { csrf } from "../middleware/csrf";
import { sessionMiddleware } from "../middleware/session";
import { hashToken } from "../utils/crypto";
import { SESSION_COOKIE_NAME } from "../utils/cookies";
import { getOpaqueServer } from "../opaque-loader";
import { decodeCanonicalBase64Url } from '@zero-vault/shared';

const TEST_DEVICE_PUBLIC_KEY = "D".repeat(43);
const TEST_DEVICE_CREDENTIAL = "C".repeat(43);
const TEST_XCHACHA_NONCE = "N".repeat(32);
const TEST_AEAD_CIPHERTEXT = "A".repeat(64);
const TEST_RECOVERY_PACKET_V2 = {
  version: 2 as const,
  alg: "XCHACHA20_POLY1305" as const,
  kdf: {
    alg: "ARGON2ID_V13" as const,
    salt: Buffer.alloc(16, 1).toString("base64url"),
    memoryKib: 65_536 as const,
    iterations: 3 as const,
    parallelism: 4 as const
  },
  nonce: Buffer.alloc(24, 2).toString("base64url"),
  ciphertext: Buffer.alloc(81, 3).toString("base64url")
};
const TEST_RECOVERY_SIGNING_PUBLIC_KEY = Buffer.alloc(32, 4).toString("base64url");

afterEach(() => vi.restoreAllMocks());

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
    fake_login_sessions: [],
    rate_limits: [],
    trusted_devices: [],
    device_vault_keys: [],
    recovery_packets: []
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
    const sourceRows = table === "users"
      ? tables[table].map((row) => ({ ...row, auth_epoch: row.auth_epoch ?? 0 }))
      : tables[table];
    if (whereFn) {
      return sourceRows.filter(whereFn);
    }
    return sourceRows;
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
        const device = tables.trusted_devices?.find((d) => d.id === session.device_id);

        // Merge session and user data
        const merged: MockRow = {
          ...session,
          ...user,
          // Preserve session fields with alias if needed
          user_id: session.user_id,
          session_id: session.id,
          s_id: session.id,
          csrf_token: session.csrf_token,
          device_id: session.device_id ?? null,
          device_status: device?.status ?? null,
          auth_epoch: session.auth_epoch ?? 0,
          user_auth_epoch: user.auth_epoch ?? 0,
          u_auth_epoch: user.auth_epoch ?? 0,
          expires_at: session.expires_at,
          session_created_at: session.created_at,
          s_expires_at: session.expires_at,
          uid: user.id,
          u_id: user.id,
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
          if (!table) return { success: true, meta: { changes: 0 } };

          let changes = 0;

          if (upper.startsWith("INSERT")) {
            const row = buildRowFromInsert(stmt._sql, stmt._bindings);
            if (row && tables[table]) {
              tables[table].push(row);
              changes = 1;
            }
          } else if (upper.startsWith("DELETE")) {
            if (
              table === "sessions" &&
              upper.includes("ID != ?") &&
              upper.includes("FROM SESSIONS REPLACEMENT")
            ) {
              const [userId, deviceId, replacementId] = stmt._bindings;
              const sessions = tables.sessions;
              if (!sessions) throw new Error("sessions table missing from test fixture");
              const replacement = sessions.some((row) =>
                row.id === replacementId && row.user_id === userId && row.device_id === deviceId
              );
              if (replacement) {
                const before = sessions.length;
                const retainedSessions = sessions.filter((row) => !(
                  row.user_id === userId && row.device_id === deviceId && row.id !== replacementId
                ));
                tables.sessions = retainedSessions;
                changes = before - retainedSessions.length;
              }
              return { success: true, meta: { changes } };
            }
            const whereFn = parseWhereClause(stmt._sql, stmt._bindings);
            if (whereFn && tables[table]) {
              const deletedUserIds = table === "users"
                ? new Set(tables.users?.filter(whereFn).map((row) => row.id) ?? [])
                : null;
              const before = tables[table].length;
              tables[table] = tables[table].filter((row) => !whereFn(row));
              changes = before - tables[table].length;
              if (deletedUserIds?.size) {
                for (const child of ["sessions", "trusted_devices", "device_vault_keys", "recovery_packets"]) {
                  const rows = tables[child];
                  if (rows) tables[child] = rows.filter((row) => !deletedUserIds.has(row.user_id));
                }
              }
            }
          }

          return { success: true, meta: { changes } };
        }
      };

      return stmt;
    },

    async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
      for (const stmt of stmts) await stmt.run();
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
  if (upper.includes("INTO FAKE_LOGIN_SESSIONS") || upper.startsWith("DELETE FROM FAKE_LOGIN_SESSIONS"))
    return "fake_login_sessions";
  if (upper.includes("INTO RATE_LIMITS") || upper.startsWith("DELETE FROM RATE_LIMITS"))
    return "rate_limits";
  if (upper.includes("INTO TRUSTED_DEVICES") || upper.startsWith("DELETE FROM TRUSTED_DEVICES"))
    return "trusted_devices";
  if (upper.includes("INTO DEVICE_VAULT_KEYS") || upper.startsWith("DELETE FROM DEVICE_VAULT_KEYS"))
    return "device_vault_keys";
  if (upper.includes("INTO RECOVERY_PACKETS") || upper.startsWith("DELETE FROM RECOVERY_PACKETS"))
    return "recovery_packets";

  // For SELECT, look for FROM clause
  if (upper.includes("FROM USERS")) return "users";
  if (upper.includes("FROM SESSIONS")) return "sessions";
  if (upper.includes("FROM REGISTRATION_SESSIONS")) return "registration_sessions";
  if (upper.includes("FROM LOGIN_SESSIONS")) return "login_sessions";
  if (upper.includes("FROM FAKE_LOGIN_SESSIONS")) return "fake_login_sessions";
  if (upper.includes("FROM RATE_LIMITS")) return "rate_limits";
  if (upper.includes("FROM TRUSTED_DEVICES")) return "trusted_devices";
  if (upper.includes("FROM DEVICE_VAULT_KEYS")) return "device_vault_keys";
  if (upper.includes("FROM RECOVERY_PACKETS")) return "recovery_packets";

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
  const upper = sql.toUpperCase();
  if (upper.includes("INTO LOGIN_SESSIONS") && upper.includes("SELECT")) {
    return {
      id: params[0],
      user_id: params[5],
      server_login_state: params[1],
      auth_epoch: params[2],
      expires_at: params[3],
      created_at: params[4]
    };
  }
  if (upper.includes("INTO SESSIONS") && upper.includes("JOIN TRUSTED_DEVICES")) {
    return {
      id: params[0],
      user_id: params[7],
      token_hash: params[1],
      csrf_token: params[2],
      device_id: params[6],
      auth_epoch: params[3],
      expires_at: params[4],
      created_at: params[5]
    };
  }
  if (upper.includes("INTO SESSIONS") && upper.includes("SELECT")) {
    return {
      id: params[0],
      user_id: params[7],
      token_hash: params[1],
      csrf_token: params[2],
      device_id: params[3],
      auth_epoch: params[4],
      expires_at: params[5],
      created_at: params[6]
    };
  }
  if (upper.includes("INTO TRUSTED_DEVICES") && upper.includes("SELECT")) {
    return {
      id: params[0],
      user_id: params[10],
      name: params[1],
      fingerprint: params[2],
      public_key: params[3],
      status: params[4],
      credential_hash: params[5],
      created_at: params[6],
      updated_at: params[7],
      last_seen_ip: params[8],
      last_seen_location: params[9]
    };
  }
  if (upper.includes("INTO SESSIONS") && upper.includes("VALUES") && params.length === 7) {
    return {
      id: params[0],
      user_id: params[1],
      token_hash: params[2],
      csrf_token: params[3],
      device_id: params[4],
      auth_epoch: 0,
      expires_at: params[5],
      created_at: params[6]
    };
  }
  if (upper.includes("INTO RECOVERY_PACKETS") && upper.includes("VALUES") && params.length === 5) {
    return {
      user_id: params[0],
      encrypted_recovery_packet: params[1],
      protocol_version: 2,
      signing_public_key: params[2],
      generation: 0,
      created_at: params[3],
      updated_at: params[4]
    };
  }
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

function createMockR2() {
  const objects = new Map<string, ArrayBuffer>();
  return {
    objects,
    failDeletes: false,
    async list(options: { prefix?: string }) {
      return {
        objects: [...objects.entries()]
          .filter(([key]) => key.startsWith(options.prefix ?? ""))
          .map(([key, body]) => ({ key, size: body.byteLength, uploaded: new Date() })),
        truncated: false,
      };
    },
    async delete(key: string) {
      if (this.failDeletes) throw new Error("r2_unavailable");
      objects.delete(key);
    },
  };
}

const createEnv = (
  db: ReturnType<typeof createMockD1>,
  r2 = createMockR2(),
): Env =>
  ({
    DB: db as unknown as D1Database,
    R2: r2 as unknown as R2Bucket,
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
              nonce: TEST_XCHACHA_NONCE,
              ciphertext: TEST_AEAD_CIPHERTEXT
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
          nonce: TEST_XCHACHA_NONCE,
          ciphertext: TEST_AEAD_CIPHERTEXT
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
              nonce: TEST_XCHACHA_NONCE,
              ciphertext: TEST_AEAD_CIPHERTEXT
            }
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("user_exists");
    });

    it("atomically bootstraps exactly one approved first mobile device", async () => {
      const registrationSessionId = crypto.randomUUID();
      const deviceId = "77777777-7777-4777-8777-777777777777";
      db._tables.registration_sessions!.push({
        id: registrationSessionId,
        email: "first-mobile@example.com",
        registration_response: "dGVzdA",
        expires_at: new Date(Date.now() + 600000).toISOString()
      });
      const request = {
        registrationSessionId,
        email: "first-mobile@example.com",
        registrationRecord: "dGVzdA",
        publicKeyBundle: "dGVzdA",
        encryptedRecoveryPacket: TEST_RECOVERY_PACKET_V2,
        recoverySigningPublicKey: TEST_RECOVERY_SIGNING_PUBLIC_KEY,
        device: {
          id: deviceId,
          name: "First Android",
          fingerprint: "android-first-install",
          publicKey: TEST_DEVICE_PUBLIC_KEY,
          credential: TEST_DEVICE_CREDENTIAL,
          encryptedVaultKeyPacket: {
            version: 1,
            recipientDeviceId: deviceId,
            recipientPublicKey: TEST_DEVICE_PUBLIC_KEY,
            ephemeralPublicKey: "E".repeat(43),
            encryptedVaultKey: {
              alg: "XCHACHA20_POLY1305",
              nonce: TEST_XCHACHA_NONCE,
              ciphertext: TEST_AEAD_CIPHERTEXT
            }
          }
        }
      };

      const response = await app.request(
        "/auth/mobile/register/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request)
        },
        createEnv(db)
      );
      expect(response.status).toBe(201);
      const responseBody = await response.json() as Record<string, unknown>;
      expect(responseBody).toMatchObject({
        user: { email: "first-mobile@example.com", serverRevision: 0 },
        device: { id: deviceId, status: "approved" },
        sessionToken: expect.any(String)
      });
      expect(responseBody).not.toHaveProperty("deviceCredential");
      expect(db._tables.users).toHaveLength(1);
      expect(db._tables.trusted_devices).toMatchObject([{ id: deviceId, status: "approved" }]);
      expect(db._tables.device_vault_keys).toHaveLength(1);
      expect(db._tables.sessions).toMatchObject([{ device_id: deviceId }]);
      expect(db._tables.recovery_packets).toMatchObject([{
        protocol_version: 2,
        signing_public_key: TEST_RECOVERY_SIGNING_PUBLIC_KEY,
        generation: 0
      }]);

      const replay = await app.request(
        "/auth/mobile/register/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request)
        },
        createEnv(db)
      );
      expect(replay.status).toBe(400);
      expect(await replay.json()).toEqual({ error: "invalid_registration_session" });
      expect(db._tables.trusted_devices).toHaveLength(1);
    });

    it("fails closed when the mobile registration session has expired", async () => {
      const registrationSessionId = crypto.randomUUID();
      const deviceId = "88888888-8888-4888-8888-888888888888";
      db._tables.registration_sessions!.push({
        id: registrationSessionId,
        email: "expired-mobile@example.com",
        registration_response: "dGVzdA",
        expires_at: new Date(Date.now() - 1_000).toISOString()
      });

      const response = await app.request(
        "/auth/mobile/register/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            registrationSessionId,
            email: "expired-mobile@example.com",
            registrationRecord: "dGVzdA",
            publicKeyBundle: "dGVzdA",
            encryptedRecoveryPacket: TEST_RECOVERY_PACKET_V2,
            recoverySigningPublicKey: TEST_RECOVERY_SIGNING_PUBLIC_KEY,
            device: {
              id: deviceId,
              name: "Expired Android",
              fingerprint: "expired-android-device",
              publicKey: TEST_DEVICE_PUBLIC_KEY,
              credential: TEST_DEVICE_CREDENTIAL,
              encryptedVaultKeyPacket: {
                version: 1,
                recipientDeviceId: deviceId,
                recipientPublicKey: TEST_DEVICE_PUBLIC_KEY,
                ephemeralPublicKey: "E".repeat(43),
                encryptedVaultKey: {
                  alg: "XCHACHA20_POLY1305",
                  nonce: TEST_XCHACHA_NONCE,
                  ciphertext: TEST_AEAD_CIPHERTEXT
                }
              }
            }
          })
        },
        createEnv(db)
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_registration_session" });
      expect(db._tables.users).toHaveLength(0);
      expect(db._tables.trusted_devices).toHaveLength(0);
      expect(db._tables.sessions).toHaveLength(0);
    });
  });

  describe("POST /auth/login/start", () => {
    it("returns the same OPAQUE response shape for known and unknown accounts", async () => {
      db._tables.users!.push({
        id: crypto.randomUUID(),
        email: "known@example.com",
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA",
        encrypted_recovery_packet: "{}",
        server_revision: 0,
        auth_epoch: 0
      });
      const opaque = await getOpaqueServer();
      const startLogin = vi.spyOn(opaque, "startLogin");
      const start = (email: string) => app.request(
        "/auth/login/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, startLoginRequest: "dGVzdA" })
        },
        createEnv(db)
      );

      const [knownResponse, firstUnknownResponse, secondUnknownResponse] = await Promise.all([
        start("known@example.com"),
        start("nobody@example.com"),
        start("nobody@example.com")
      ]);
      expect([knownResponse.status, firstUnknownResponse.status, secondUnknownResponse.status])
        .toEqual([200, 200, 200]);

      const known = await knownResponse.json() as Record<string, unknown>;
      const firstUnknown = await firstUnknownResponse.json() as Record<string, unknown>;
      const secondUnknown = await secondUnknownResponse.json() as Record<string, unknown>;
      expect(Object.keys(firstUnknown).sort()).toEqual(Object.keys(known).sort());
      expect(JSON.stringify(firstUnknown)).toHaveLength(JSON.stringify(known).length);
      expect(firstUnknown.loginSessionId).not.toBe(secondUnknown.loginSessionId);
      expect(db._tables.login_sessions).toHaveLength(1);
      expect(db._tables.fake_login_sessions).toHaveLength(2);
      expect(startLogin).toHaveBeenCalledTimes(3);
      const records = startLogin.mock.calls.map(([params]) => params.registrationRecord);
      expect(records.filter((record) => record === null)).toHaveLength(2);
      expect(records.filter((record) => record === "dGVzdA")).toHaveLength(1);
    });

    it("creates an unknown-account OPAQUE state that finishes once and never authenticates", async () => {
      const startResponse = await app.request(
        "/auth/login/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "missing@example.com",
            startLoginRequest: "dGVzdA"
          })
        },
        createEnv(db)
      );
      const { loginSessionId } = await startResponse.json() as { loginSessionId: string };
      const opaque = await getOpaqueServer();
      const finishLogin = vi.spyOn(opaque, "finishLogin");
      const finish = () => app.request(
        "/auth/login/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ loginSessionId, finishLoginRequest: "dGVzdA" })
        },
        createEnv(db)
      );

      const first = await finish();
      expect(first.status).toBe(401);
      expect(await first.json()).toEqual({ error: "invalid_credentials" });
      expect(finishLogin).toHaveBeenCalledTimes(1);
      expect(finishLogin).toHaveBeenCalledWith(expect.objectContaining({
        identifiers: { client: "missing@example.com", server: "zero-vault" }
      }));

      const replay = await finish();
      expect(replay.status).toBe(400);
      expect(await replay.json()).toEqual({ error: "invalid_login_session" });
      expect(finishLogin).toHaveBeenCalledTimes(1);
      expect(db._tables.fake_login_sessions).toHaveLength(0);
      expect(db._tables.sessions).toHaveLength(0);
    });

    it("rejects and consumes an expired unknown-account OPAQUE state", async () => {
      const startResponse = await app.request(
        "/auth/login/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "expired-missing@example.com",
            startLoginRequest: "dGVzdA"
          })
        },
        createEnv(db)
      );
      const { loginSessionId } = await startResponse.json() as { loginSessionId: string };
      db._tables.fake_login_sessions![0]!.expires_at = new Date(Date.now() - 1).toISOString();

      const finishResponse = await app.request(
        "/auth/login/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ loginSessionId, finishLoginRequest: "dGVzdA" })
        },
        createEnv(db)
      );
      expect(finishResponse.status).toBe(400);
      expect(await finishResponse.json()).toEqual({ error: "invalid_login_session" });
      expect(db._tables.fake_login_sessions).toHaveLength(0);
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
            finishLoginRequest: "dGVzdA",
            device: {
              id: "77777777-7777-4777-8777-777777777777",
              name: "Android",
              fingerprint: "android-install-test",
              publicKey: TEST_DEVICE_PUBLIC_KEY,
              credential: TEST_DEVICE_CREDENTIAL
            }
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("invalid_login_session");
    });

    it("uses the same validation for the mobile bearer finish route", async () => {
      const res = await app.request(
        "/auth/mobile/login/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            loginSessionId: crypto.randomUUID(),
            finishLoginRequest: "dGVzdA",
            device: {
              id: "77777777-7777-4777-8777-777777777776",
              name: "Android",
              fingerprint: "android-install-test",
              publicKey: TEST_DEVICE_PUBLIC_KEY,
              credential: TEST_DEVICE_CREDENTIAL
            }
          })
        },
        createEnv(db)
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_login_session" });
      expect(res.headers.get("set-cookie")).toBeNull();
    });

    it("keeps the existing HttpOnly cookie flow for a real web login", async () => {
      const userId = crypto.randomUUID();
      const loginSessionId = crypto.randomUUID();
      db._tables.users!.push({
        id: userId,
        email: "web-login@example.com",
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA",
        encrypted_recovery_packet: "{}",
        server_revision: 0,
        auth_epoch: 0
      });
      db._tables.login_sessions!.push({
        id: loginSessionId,
        user_id: userId,
        server_login_state: "dGVzdA",
        auth_epoch: 0,
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });

      const response = await app.request(
        "/auth/login/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ loginSessionId, finishLoginRequest: "dGVzdA" })
        },
        createEnv(db)
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(await response.json()).not.toHaveProperty("sessionToken");
      expect(db._tables.sessions).toHaveLength(1);
    });

    it.each(["mobile", "web", "extension", "extension-forged"])("binds a %s login to its device with the appropriate session transport", async (transport) => {
      const loginSessionId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const deviceId = "77777777-7777-4777-8777-777777777778";
      db._tables.users!.push({
        id: userId,
        email: "android@example.com",
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA",
        encrypted_recovery_packet: "{}",
        server_revision: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      db._tables.login_sessions!.push({
        id: loginSessionId,
        user_id: userId,
        server_login_state: "dGVzdA",
        expires_at: new Date(Date.now() + 60000).toISOString()
      });

      const extension = transport.startsWith('extension');
      const publicKey = extension ? 'A'.repeat(42) + 'E' : TEST_DEVICE_PUBLIC_KEY;
      const digest = extension ? new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(decodeCanonicalBase64Url(publicKey)))) : new Uint8Array();
      const fingerprint = extension ? Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') : 'android-install-test';
      const res = await app.request(
        `/auth/${extension ? 'extension' : transport}/login/finish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            loginSessionId,
            finishLoginRequest: "dGVzdA",
            device: {
              id: deviceId,
              name: "Android",
              fingerprint: transport === 'extension-forged' ? '0'.repeat(64) : fingerprint,
              publicKey,
              credential: TEST_DEVICE_CREDENTIAL
            }
          })
        },
        createEnv(db)
      );

      if (transport === 'extension-forged') {
        expect(res.status).toBe(400); expect(await res.json()).toEqual({ error: 'invalid_device_fingerprint' });
        expect(db._tables.sessions ?? []).toHaveLength(0); return;
      }
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toMatchObject({
        user: { id: userId, email: "android@example.com", serverRevision: 2 },
        csrfToken: expect.any(String),
        device: { id: deviceId, status: "pending" }
      });
      expect(body).not.toHaveProperty("deviceCredential");
      if (transport !== "web") {
        expect(body.sessionToken).toEqual(expect.any(String));
        expect(res.headers.get("set-cookie")).toBeNull();
        const headers = { authorization: `Bearer ${String(body.sessionToken)}` };
        expect((await app.request("/auth/me", { headers }, createEnv(db))).status).toBe(200);
        expect((await app.request("/vault/item-sync?cursor=0", { headers }, createEnv(db))).status).toBe(403);
        db._tables.trusted_devices![0]!.status = "revoked";
        expect((await app.request("/auth/me", { headers }, createEnv(db))).status).toBe(401);
      } else {
        expect(body).not.toHaveProperty("sessionToken");
        const cookie = res.headers.get("set-cookie")!;
        expect(cookie).toContain("HttpOnly");
        const me = await app.request("/auth/me", { headers: { cookie } }, createEnv(db));
        expect(me.status).toBe(200);
        const forbidden = await app.request("/vault/item-sync?cursor=0", { headers: { cookie } }, createEnv(db));
        expect(forbidden.status).toBe(403);
        expect(await forbidden.json()).toMatchObject({ error: "device_approval_required" });
        db._tables.trusted_devices![0]!.status = "revoked";
        expect((await app.request("/auth/me", { headers: { cookie } }, createEnv(db))).status).toBe(401);
      }
      expect(db._tables.sessions).toHaveLength(1);
    });

    it("replays a native-persisted device credential and atomically rotates its bearer session", async () => {
      const userId = crypto.randomUUID();
      const deviceId = "77777777-7777-4777-8777-777777777779";
      db._tables.users!.push({
        id: userId,
        email: "rotating-android@example.com",
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA",
        encrypted_recovery_packet: "{}",
        server_revision: 0
      });

      const finish = async (credential: string) => {
        const loginSessionId = crypto.randomUUID();
        db._tables.login_sessions!.push({
          id: loginSessionId,
          user_id: userId,
          server_login_state: "dGVzdA",
          expires_at: new Date(Date.now() + 60_000).toISOString()
        });
        return app.request(
          "/auth/mobile/login/finish",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              loginSessionId,
              finishLoginRequest: "dGVzdA",
              device: {
                id: deviceId,
                name: "Android",
                fingerprint: "android-rotation-test",
                publicKey: TEST_DEVICE_PUBLIC_KEY,
                credential
              }
            })
          },
          createEnv(db)
        );
      };

      const first = await finish(TEST_DEVICE_CREDENTIAL);
      expect(first.status).toBe(200);
      const firstBody = await first.json() as { sessionToken: string; device: { id: string } };
      expect(firstBody.device.id).toBe(deviceId);
      expect(db._tables.sessions).toHaveLength(1);

      // This is the response-loss recovery path: the caller repeats OPAQUE
      // with the id+credential it persisted before the first request.
      const second = await finish(TEST_DEVICE_CREDENTIAL);
      expect(second.status).toBe(200);
      const secondBody = await second.json() as { sessionToken: string; device: { id: string } };
      expect(secondBody.device.id).toBe(deviceId);
      expect(secondBody.sessionToken).not.toBe(firstBody.sessionToken);
      expect(db._tables.sessions).toHaveLength(1);
      expect(db._tables.sessions![0]!.token_hash).toBe(await hashToken(secondBody.sessionToken));

      const wrong = await finish("W".repeat(43));
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).toEqual({ error: "invalid_device_credential" });
      expect(db._tables.sessions).toHaveLength(1);
    });

    it("does not let a mobile login claim a device id owned by another account", async () => {
      const userId = crypto.randomUUID();
      const otherUserId = crypto.randomUUID();
      const deviceId = "77777777-7777-4777-8777-777777777780";
      db._tables.users!.push({
        id: userId,
        email: "device-id-conflict@example.com",
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA",
        encrypted_recovery_packet: "{}",
        server_revision: 0
      });
      db._tables.trusted_devices!.push({
        id: deviceId,
        user_id: otherUserId,
        name: "Other account device",
        fingerprint: "other-account-install",
        public_key: TEST_DEVICE_PUBLIC_KEY,
        credential_hash: await hashToken(TEST_DEVICE_CREDENTIAL),
        status: "approved"
      });
      const loginSessionId = crypto.randomUUID();
      db._tables.login_sessions!.push({
        id: loginSessionId,
        user_id: userId,
        server_login_state: "dGVzdA",
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });

      const response = await app.request(
        "/auth/mobile/login/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            loginSessionId,
            finishLoginRequest: "dGVzdA",
            device: {
              id: deviceId,
              name: "Android",
              fingerprint: "android-new-account",
              publicKey: "E".repeat(43),
              credential: TEST_DEVICE_CREDENTIAL
            }
          })
        },
        createEnv(db)
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid_device_credential" });
      expect(db._tables.sessions).toHaveLength(0);
      expect(db._tables.trusted_devices).toHaveLength(1);
    });

    it("atomically consumes one OPAQUE login session only once", async () => {
      const userId = crypto.randomUUID();
      const loginSessionId = crypto.randomUUID();
      db._tables.users!.push({
        id: userId,
        email: "single-use-login@example.com",
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA",
        encrypted_recovery_packet: "{}",
        server_revision: 0
      });
      db._tables.login_sessions!.push({
        id: loginSessionId,
        user_id: userId,
        server_login_state: "dGVzdA",
        expires_at: new Date(Date.now() + 60_000).toISOString()
      });
      const request = () => app.request(
        "/auth/mobile/login/finish",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            loginSessionId,
            finishLoginRequest: "dGVzdA",
            device: {
              id: "77777777-7777-4777-8777-777777777781",
              name: "Android",
              fingerprint: "single-use-login-device",
              publicKey: TEST_DEVICE_PUBLIC_KEY,
              credential: TEST_DEVICE_CREDENTIAL
            }
          })
        },
        createEnv(db)
      );

      const responses = await Promise.all([request(), request()]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
      expect(db._tables.sessions).toHaveLength(1);
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

  describe("POST /auth/login/direct", () => {
    it("is unavailable unless the insecure development flag is explicit", async () => {
      const res = await app.request(
        "/auth/login/direct",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "test@example.com",
            password: "any-non-empty-password",
          }),
        },
        createEnv(db),
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
      expect(db._tables.sessions).toHaveLength(0);
    });

    it("stays unavailable in production even if the insecure flag is misconfigured", async () => {
      const env = {
        ...createEnv(db),
        ENVIRONMENT: "production",
        ALLOW_INSECURE_DIRECT_LOGIN: "true"
      } as Env;
      const res = await app.request(
        "/auth/login/direct",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "test@example.com", password: "password" })
        },
        env
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
      expect(db._tables.users).toHaveLength(0);
      expect(db._tables.sessions).toHaveLength(0);
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

    it("accepts an Android bearer session without setting a cookie", async () => {
      const userId = crypto.randomUUID();
      const token = "A".repeat(43);
      const csrfToken = "android-csrf-token";
      const tokenHash = await hashToken(token);

      db._tables.users!.push({
        id: userId,
        email: "android@example.com",
        server_revision: 3,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA"
      });
      db._tables.sessions!.push({
        id: crypto.randomUUID(),
        user_id: userId,
        token_hash: tokenHash,
        csrf_token: csrfToken,
        device_id: "77777777-7777-4777-8777-777777777777",
        expires_at: new Date(Date.now() + 86400000).toISOString()
      });
      db._tables.trusted_devices!.push({
        id: "77777777-7777-4777-8777-777777777777",
        user_id: userId,
        name: "Android",
        public_key: TEST_DEVICE_PUBLIC_KEY,
        status: "approved"
      });

      const res = await app.request(
        "/auth/session",
        { headers: { authorization: `Bearer ${token}` } },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        user: { id: userId, email: "android@example.com", serverRevision: 3 },
        csrfToken
      });
      expect(res.headers.get("set-cookie")).toBeNull();
    });

    it("does not fall back to a cookie when Authorization is malformed", async () => {
      const userId = crypto.randomUUID();
      const token = "a".repeat(43);
      db._tables.users!.push({
        id: userId,
        email: "test@example.com",
        server_revision: 0,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA"
      });
      db._tables.sessions!.push({
        user_id: userId,
        token_hash: await hashToken(token),
        csrf_token: "csrf",
        expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const res = await app.request(
        "/auth/session",
        { headers: {
          authorization: "Basic malformed",
          cookie: `${SESSION_COOKIE_NAME}=${token}`
        } },
        createEnv(db)
      );

      expect(res.status).toBe(401);
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

    it("revokes an Android bearer session when its CSRF token is present", async () => {
      const userId = crypto.randomUUID();
      const token = "B".repeat(43);
      const csrfToken = "android-csrf-token";
      db._tables.users!.push({
        id: userId,
        email: "android@example.com",
        server_revision: 0,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA"
      });
      db._tables.sessions!.push({
        id: crypto.randomUUID(),
        user_id: userId,
        token_hash: await hashToken(token),
        csrf_token: csrfToken,
        device_id: "88888888-8888-4888-8888-888888888888",
        expires_at: new Date(Date.now() + 86400000).toISOString()
      });
      db._tables.trusted_devices!.push({
        id: "88888888-8888-4888-8888-888888888888",
        user_id: userId,
        name: "Android",
        public_key: TEST_DEVICE_PUBLIC_KEY,
        status: "approved"
      });

      const res = await app.request(
        "/auth/logout",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "x-zero-vault-csrf": csrfToken
          }
        },
        createEnv(db)
      );

      expect(res.status).toBe(200);
      expect(db._tables.sessions).toHaveLength(0);
    });
  });

  describe("DELETE /auth/account", () => {
    it("requires matching CSRF and deletes an Android account", async () => {
      const userId = crypto.randomUUID();
      const token = "A".repeat(43);
      const csrfToken = "android-delete-csrf";
      const deviceId = "99999999-9999-4999-8999-999999999999";
      const r2 = createMockR2();
      r2.objects.set(`exports/${userId}/99999999-9999-4999-8999-999999999998`, new ArrayBuffer(32));
      db._tables.users!.push({
        id: userId,
        email: "delete-android@example.com",
        server_revision: 0,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA"
      });
      db._tables.sessions!.push({
        id: crypto.randomUUID(),
        user_id: userId,
        token_hash: await hashToken(token),
        csrf_token: csrfToken,
        device_id: deviceId,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString()
      });
      db._tables.trusted_devices!.push({
        id: deviceId,
        user_id: userId,
        name: "Android",
        public_key: TEST_DEVICE_PUBLIC_KEY,
        status: "approved"
      });

      const rejected = await app.request(
        "/auth/account",
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}`, "x-zero-vault-csrf": "wrong" }
        },
        createEnv(db, r2)
      );
      expect(rejected.status).toBe(403);
      expect(db._tables.users).toHaveLength(1);

      const deleted = await app.request(
        "/auth/account",
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}`, "x-zero-vault-csrf": csrfToken }
        },
        createEnv(db, r2)
      );
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toEqual({ ok: true });
      expect(db._tables.users).toHaveLength(0);
      expect(db._tables.sessions).toHaveLength(0);
      expect(db._tables.trusted_devices).toHaveLength(0);
      expect(r2.objects.size).toBe(0);
    });

    it("deletes a Web account only from a recently authenticated cookie session", async () => {
      const userId = crypto.randomUUID();
      const token = "W".repeat(43);
      const csrfToken = "web-delete-csrf";
      const r2 = createMockR2();
      db._tables.users!.push({
        id: userId,
        email: "delete-web@example.com",
        server_revision: 0,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA",
      });
      db._tables.sessions!.push({
        id: crypto.randomUUID(),
        user_id: userId,
        token_hash: await hashToken(token),
        csrf_token: csrfToken,
        device_id: null,
        created_at: new Date(Date.now() - 60 * 1000).toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });

      const response = await app.request(
        "/auth/account",
        {
          method: "DELETE",
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${token}`,
            "x-zero-vault-csrf": csrfToken,
          },
        },
        createEnv(db, r2),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(db._tables.users).toHaveLength(0);
    });

    it("rejects a stale Web cookie session without deleting D1 or R2 data", async () => {
      const userId = crypto.randomUUID();
      const token = "X".repeat(43);
      const csrfToken = "stale-web-delete-csrf";
      const r2 = createMockR2();
      const exportKey = `exports/${userId}/99999999-9999-4999-8999-999999999993`;
      r2.objects.set(exportKey, new ArrayBuffer(32));
      db._tables.users!.push({
        id: userId,
        email: "stale-web-delete@example.com",
        server_revision: 0,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA",
      });
      db._tables.sessions!.push({
        id: crypto.randomUUID(),
        user_id: userId,
        token_hash: await hashToken(token),
        csrf_token: csrfToken,
        device_id: null,
        created_at: new Date(Date.now() - 5 * 60 * 1000 - 1).toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });

      const response = await app.request(
        "/auth/account",
        {
          method: "DELETE",
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${token}`,
            "x-zero-vault-csrf": csrfToken,
          },
        },
        createEnv(db, r2),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "recent_authentication_required" });
      expect(db._tables.users).toHaveLength(1);
      expect(db._tables.sessions).toHaveLength(1);
      expect(r2.objects.has(exportKey)).toBe(true);
    });

    it("rejects an approved device session older than five minutes without deleting data", async () => {
      const userId = crypto.randomUUID();
      const token = "B".repeat(43);
      const csrfToken = "stale-delete-csrf";
      const deviceId = "99999999-9999-4999-8999-999999999997";
      const r2 = createMockR2();
      const exportKey = `exports/${userId}/99999999-9999-4999-8999-999999999996`;
      r2.objects.set(exportKey, new ArrayBuffer(32));
      db._tables.users!.push({
        id: userId,
        email: "stale-delete@example.com",
        server_revision: 0,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA",
      });
      db._tables.sessions!.push({
        id: crypto.randomUUID(),
        user_id: userId,
        token_hash: await hashToken(token),
        csrf_token: csrfToken,
        device_id: deviceId,
        created_at: new Date(Date.now() - 5 * 60 * 1000 - 1).toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
      db._tables.trusted_devices!.push({
        id: deviceId,
        user_id: userId,
        name: "Android",
        public_key: TEST_DEVICE_PUBLIC_KEY,
        status: "approved",
      });

      const response = await app.request(
        "/auth/account",
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}`, "x-zero-vault-csrf": csrfToken },
        },
        createEnv(db, r2),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "recent_authentication_required" });
      expect(db._tables.users).toHaveLength(1);
      expect(r2.objects.has(exportKey)).toBe(true);
    });

    it("keeps the account retryable when R2 cleanup fails", async () => {
      const userId = crypto.randomUUID();
      const token = "C".repeat(43);
      const csrfToken = "r2-failure-delete-csrf";
      const deviceId = "99999999-9999-4999-8999-999999999995";
      const r2 = createMockR2();
      const exportKey = `exports/${userId}/99999999-9999-4999-8999-999999999994`;
      r2.objects.set(exportKey, new ArrayBuffer(32));
      r2.failDeletes = true;
      db._tables.users!.push({
        id: userId,
        email: "r2-failure@example.com",
        server_revision: 0,
        opaque_registration_record: "dGVzdA",
        public_key_bundle: "dGVzdA",
      });
      db._tables.sessions!.push({
        id: crypto.randomUUID(), user_id: userId, token_hash: await hashToken(token),
        csrf_token: csrfToken, device_id: deviceId, created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });
      db._tables.trusted_devices!.push({
        id: deviceId, user_id: userId, name: "Android",
        public_key: TEST_DEVICE_PUBLIC_KEY, status: "approved",
      });

      const response = await app.request(
        "/auth/account",
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}`, "x-zero-vault-csrf": csrfToken },
        },
        createEnv(db, r2),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "account_deletion_incomplete" });
      expect(db._tables.users).toHaveLength(1);
      expect(db._tables.sessions).toHaveLength(1);
      expect(r2.objects.has(exportKey)).toBe(true);
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

      // register/start has rateLimit({ max: 60 })
      const maxRequests = 60;

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

  it.each(["production", "staging"])(
    "fails closed without a configured setup in %s",
    (environment) => {
      const createSetup = vi.fn(() => "must-not-be-generated");
      expect(() => resolveOpaqueServerSetup(
        { ENVIRONMENT: environment } as Env,
        { createSetup }
      )).toThrow("opaque_server_setup_required");
      expect(createSetup).not.toHaveBeenCalled();
    }
  );

  it("never logs a generated local setup value", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const setup = resolveOpaqueServerSetup(
        { ENVIRONMENT: "development" } as Env,
        { createSetup: () => "local-secret-setup" }
      );
      expect(setup).toBe("local-secret-setup");
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });
});
