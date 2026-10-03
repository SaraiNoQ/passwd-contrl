import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  buildRecoveryFinishTranscript,
  encodeCanonicalBase64Url,
  type CiphertextEnvelope,
  type DeviceVaultKeyPacket,
  type RecoveryPacketV2
} from "@zero-vault/shared";
import type { Env } from "../env";
import { csrf } from "../middleware/csrf";
import { sessionMiddleware } from "../middleware/session";
import { hashToken } from "../utils/crypto";
import { SESSION_COOKIE_NAME } from "../utils/cookies";
import { buildRecoveryRoutes } from "./recovery";

vi.mock("../opaque-loader", () => ({
  getOpaqueServer: vi.fn(async () => ({
    createSetup: () => "test-server-setup",
    createRegistrationResponse: () => ({ registrationResponse: "AA" }),
    startLogin: () => ({ loginResponse: "AA", serverLoginState: "AA" }),
    finishLogin: () => undefined,
    getPublicKey: () => "AA"
  }))
}));

class MockD1Result {
  success = true;
  meta: { changes?: number };

  constructor(changes = 0) {
    this.meta = { changes };
  }
}

class MockD1PreparedStatement {
  _params: unknown[] = [];

  constructor(
    private readonly db: MockD1Database,
    readonly _sql: string
  ) {}

  bind(...params: unknown[]): this {
    this._params = params;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.sqlite.prepare(this._sql).get(...this._params) as T | undefined;
    return row ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rows = this.db.sqlite.prepare(this._sql).all(...this._params) as T[];
    return { results: rows };
  }

  async run(): Promise<MockD1Result> {
    return this.runSync();
  }

  runSync(): MockD1Result {
    const info = this.db.sqlite.prepare(this._sql).run(...this._params);
    return new MockD1Result(info.changes);
  }
}

class MockD1Database {
  constructor(readonly sqlite: import("better-sqlite3").Database) {}

  prepare(sql: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(this, sql);
  }

  async batch(stmts: MockD1PreparedStatement[]): Promise<MockD1Result[]> {
    return this.sqlite.transaction(() => stmts.map((stmt) => stmt.runSync()))();
  }
}

const MIGRATION_SQL = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    opaque_registration_record TEXT NOT NULL,
    public_key_bundle TEXT NOT NULL,
    encrypted_recovery_packet TEXT NOT NULL,
    server_revision INTEGER NOT NULL DEFAULT 0,
    auth_epoch INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE registration_sessions (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    registration_response TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE login_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_login_state TEXT NOT NULL,
    auth_epoch INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    csrf_token TEXT NOT NULL,
    device_id TEXT,
    auth_epoch INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE trusted_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    fingerprint TEXT,
    public_key TEXT NOT NULL,
    status TEXT NOT NULL,
    credential_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_seen_ip TEXT,
    last_seen_location TEXT
  );
  CREATE UNIQUE INDEX device_public_key_active
    ON trusted_devices(user_id, public_key)
    WHERE status IN ('pending', 'approved');
  CREATE UNIQUE INDEX device_fingerprint_active
    ON trusted_devices(user_id, fingerprint)
    WHERE fingerprint IS NOT NULL AND status IN ('pending', 'approved');
  CREATE TABLE device_vault_keys (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    encrypted_blob TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, device_id)
  );
  CREATE TABLE recovery_packets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_recovery_packet TEXT NOT NULL,
    protocol_version INTEGER NOT NULL DEFAULT 1,
    signing_public_key TEXT,
    generation INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE recovery_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    auth_epoch INTEGER,
    recovery_generation INTEGER,
    nonce TEXT NOT NULL,
    registration_session_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (
      (user_id IS NULL AND auth_epoch IS NULL AND recovery_generation IS NULL) OR
      (user_id IS NOT NULL AND auth_epoch IS NOT NULL AND recovery_generation IS NOT NULL)
    )
  );
  CREATE TABLE recovery_claims (
    challenge_id TEXT PRIMARY KEY NOT NULL REFERENCES recovery_challenges(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    claimed_at TEXT NOT NULL
  );
  CREATE TABLE rate_limits (
    key TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    PRIMARY KEY (key, timestamp)
  );
  CREATE TABLE vault_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL
  );
`;

const fixedBase64Url = (length: number, start = 0): string =>
  encodeCanonicalBase64Url(
    Uint8Array.from({ length }, (_, index) => (start + index) & 0xff)
  );

const recoveryPacket = (start = 0): RecoveryPacketV2 => ({
  version: 2,
  alg: "XCHACHA20_POLY1305",
  kdf: {
    alg: "ARGON2ID_V13",
    salt: fixedBase64Url(16, start + 16),
    memoryKib: 65_536,
    iterations: 3,
    parallelism: 4
  },
  nonce: fixedBase64Url(24, start + 32),
  ciphertext: fixedBase64Url(81, start + 64)
});

const legacyRecoveryPacket: CiphertextEnvelope = {
  alg: "XCHACHA20_POLY1305",
  nonce: fixedBase64Url(24, 8),
  ciphertext: fixedBase64Url(32, 48)
};

const devicePacket = (deviceId: string, publicKey: string): DeviceVaultKeyPacket => ({
  version: 1,
  recipientDeviceId: deviceId,
  recipientPublicKey: publicKey,
  ephemeralPublicKey: fixedBase64Url(32, 80),
  encryptedVaultKey: {
    alg: "XCHACHA20_POLY1305",
    nonce: fixedBase64Url(24, 112),
    ciphertext: fixedBase64Url(48, 144)
  }
});

const createTestDB = (): MockD1Database => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(MIGRATION_SQL);
  return new MockD1Database(sqlite);
};

const createEnv = (db: MockD1Database): Env => ({
  DB: db as unknown as D1Database,
  ENVIRONMENT: "test",
  CORS_ORIGIN: "http://localhost:3000",
  OPAQUE_SERVER_SETUP: "test-server-setup"
}) as unknown as Env;

const buildTestApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", sessionMiddleware());
  app.use("*", csrf());
  app.route("/", buildRecoveryRoutes());
  return app;
};

type UserOptions = {
  email?: string;
  protocolVersion?: 1 | 2;
  signingPublicKey?: string;
  generation?: number;
};

const createUser = (db: MockD1Database, options: UserOptions = {}): string => {
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const protocolVersion = options.protocolVersion ?? 1;
  const packet = protocolVersion === 2 ? recoveryPacket() : legacyRecoveryPacket;
  db.sqlite.prepare(
    `INSERT INTO users
       (id, email, opaque_registration_record, public_key_bundle,
        encrypted_recovery_packet, server_revision, auth_epoch, created_at, updated_at)
     VALUES (?, ?, 'AA', 'AA', ?, 0, 0, ?, ?)`
  ).run(
    userId,
    options.email ?? `user-${userId}@example.com`,
    JSON.stringify(packet),
    now,
    now
  );
  if (protocolVersion === 2) {
    db.sqlite.prepare(
      `INSERT INTO recovery_packets
         (user_id, encrypted_recovery_packet, protocol_version,
          signing_public_key, generation, created_at, updated_at)
       VALUES (?, ?, 2, ?, ?, ?, ?)`
    ).run(
      userId,
      JSON.stringify(packet),
      options.signingPublicKey ?? fixedBase64Url(32, 192),
      options.generation ?? 0,
      now,
      now
    );
  }
  return userId;
};

const createSession = async (db: MockD1Database, userId: string) => {
  const token = fixedBase64Url(32, 210);
  const csrfToken = fixedBase64Url(32, 16);
  const now = new Date().toISOString();
  db.sqlite.prepare(
    `INSERT INTO sessions
       (id, user_id, token_hash, csrf_token, device_id, auth_epoch, expires_at, created_at)
     VALUES (?, ?, ?, ?, NULL, 0, ?, ?)`
  ).run(
    crypto.randomUUID(),
    userId,
    await hashToken(token),
    csrfToken,
    new Date(Date.now() + 86_400_000).toISOString(),
    now
  );
  return { token, csrfToken };
};

const authHeaders = (token: string, csrfToken?: string): Record<string, string> => ({
  cookie: `${SESSION_COOKIE_NAME}=${token}`,
  "content-type": "application/json",
  ...(csrfToken ? { "x-zero-vault-csrf": csrfToken } : {})
});

const startRecovery = (
  app: ReturnType<typeof buildTestApp>,
  db: MockD1Database,
  email: string
) => app.request(
  "/auth/recovery/start",
  {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.8" },
    body: JSON.stringify({ email, registrationRequest: "AA" })
  },
  createEnv(db)
);

describe("Recovery v2 routes", () => {
  let db: MockD1Database;
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    db = createTestDB();
    app = buildTestApp();
  });

  it("returns equal-shape and equal-length starts for v2, v1, and unknown accounts", async () => {
    const v2Email = "known-v2@example.com";
    const v1Email = "known-v1@example.com";
    createUser(db, { email: v2Email, protocolVersion: 2 });
    createUser(db, { email: v1Email });

    const responses = await Promise.all([
      startRecovery(app, db, v2Email),
      startRecovery(app, db, v1Email),
      startRecovery(app, db, "unknown@example.com")
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    const texts = await Promise.all(responses.map((response) => response.text()));
    expect(new Set(texts.map((text) => text.length))).toEqual(new Set([texts[0]!.length]));
    for (const text of texts) {
      expect(Object.keys(JSON.parse(text) as Record<string, unknown>)).toEqual([
        "recoveryAttemptId",
        "challenge",
        "registrationSessionId",
        "registrationResponse",
        "encryptedRecoveryPacket",
        "recoverySigningPublicKey"
      ]);
    }
  });

  it("derives stable per-email fake material and still performs the derivation for known v2", async () => {
    const v1Email = "stable-legacy@example.com";
    const knownEmail = "stable-known@example.com";
    createUser(db, { email: v1Email });
    const knownSigningKey = fixedBase64Url(32, 192);
    createUser(db, {
      email: knownEmail,
      protocolVersion: 2,
      signingPublicKey: knownSigningKey
    });
    type StartMaterial = {
      encryptedRecoveryPacket: RecoveryPacketV2;
      recoverySigningPublicKey: string;
    };
    const read = async (email: string): Promise<StartMaterial> => {
      const response = await startRecovery(app, db, email);
      expect(response.status).toBe(200);
      const body = await response.json() as StartMaterial;
      return {
        encryptedRecoveryPacket: body.encryptedRecoveryPacket,
        recoverySigningPublicKey: body.recoverySigningPublicKey
      };
    };

    const sign = vi.spyOn(crypto.subtle, "sign");
    try {
      const unknownFirst = await read("stable-unknown@example.com");
      const unknownSecond = await read("stable-unknown@example.com");
      const unknownOther = await read("different-unknown@example.com");
      const legacyFirst = await read(v1Email);
      const legacySecond = await read(v1Email);
      const known = await read(knownEmail);

      expect(unknownSecond).toEqual(unknownFirst);
      expect(legacySecond).toEqual(legacyFirst);
      expect(unknownOther.encryptedRecoveryPacket).not.toEqual(
        unknownFirst.encryptedRecoveryPacket
      );
      expect(unknownOther.recoverySigningPublicKey).not.toBe(
        unknownFirst.recoverySigningPublicKey
      );
      expect(known).toEqual({
        encryptedRecoveryPacket: recoveryPacket(),
        recoverySigningPublicKey: knownSigningKey
      });
      // Five SHA-256 HMAC blocks produce 153 bytes for every request,
      // including the known-v2 request whose fake material is discarded.
      expect(sign).toHaveBeenCalledTimes(6 * 5);
    } finally {
      sign.mockRestore();
    }
  });

  it("performs Ed25519 verification work before the unified v1/unknown denial", async () => {
    const v1Email = "legacy@example.com";
    createUser(db, { email: v1Email });
    const [legacyStart, unknownStart] = await Promise.all([
      startRecovery(app, db, v1Email),
      startRecovery(app, db, "absent@example.com")
    ]);
    const starts = await Promise.all([legacyStart.json(), unknownStart.json()]) as Array<{
      recoveryAttemptId: string;
      challenge: string;
      registrationSessionId: string;
      encryptedRecoveryPacket: RecoveryPacketV2;
    }>;

    const importKey = vi.spyOn(crypto.subtle, "importKey")
      .mockResolvedValue({} as CryptoKey);
    const verify = vi.spyOn(crypto.subtle, "verify").mockResolvedValue(false);
    try {
      for (const [index, start] of starts.entries()) {
        const deviceId = crypto.randomUUID();
        const publicKey = fixedBase64Url(32, 32 + index);
        const response = await app.request(
          "/auth/recovery/finish",
          {
            method: "POST",
            headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.8" },
            body: JSON.stringify({
              recoveryAttemptId: start.recoveryAttemptId,
              email: index === 0 ? v1Email : "absent@example.com",
              registrationSessionId: start.registrationSessionId,
              registrationRecord: "AA",
              newEncryptedRecoveryPacket: recoveryPacket(10 + index),
              newRecoverySigningPublicKey: fixedBase64Url(32, 128 + index),
              device: {
                id: deviceId,
                name: "Pixel",
                fingerprint: `recovery-device-${index}`,
                publicKey,
                credential: fixedBase64Url(32, 64 + index),
                encryptedVaultKeyPacket: devicePacket(deviceId, publicKey)
              },
              signature: fixedBase64Url(64, index)
            })
          },
          createEnv(db)
        );
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "invalid_recovery_authorization" });
      }
      expect(importKey).toHaveBeenCalledTimes(2);
      expect(verify).toHaveBeenCalledTimes(2);
    } finally {
      importKey.mockRestore();
      verify.mockRestore();
    }
  });

  it("migrates v1 once, then requires the authenticated v2 rotation route", async () => {
    const userId = createUser(db, { email: "migration@example.com" });
    const { token, csrfToken } = await createSession(db, userId);
    const before = await app.request(
      "/vault/recovery-packet",
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
      createEnv(db)
    );
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ encryptedRecoveryPacket: legacyRecoveryPacket });

    const packet = recoveryPacket(24);
    const signingPublicKey = fixedBase64Url(32, 176);
    const migrated = await app.request(
      "/vault/recovery-packet",
      {
        method: "POST",
        headers: authHeaders(token, csrfToken),
        body: JSON.stringify({
          encryptedRecoveryPacket: packet,
          recoverySigningPublicKey: signingPublicKey
        })
      },
      createEnv(db)
    );
    expect(migrated.status).toBe(200);
    expect(await migrated.json()).toEqual({ ok: true });
    expect(db.sqlite.prepare(
      "SELECT protocol_version, signing_public_key, generation FROM recovery_packets WHERE user_id = ?"
    ).get(userId)).toMatchObject({
      protocol_version: 2,
      signing_public_key: signingPublicKey,
      generation: 1
    });

    const repeated = await app.request(
      "/vault/recovery-packet",
      {
        method: "POST",
        headers: authHeaders(token, csrfToken),
        body: JSON.stringify({
          encryptedRecoveryPacket: recoveryPacket(25),
          recoverySigningPublicKey: fixedBase64Url(32, 177)
        })
      },
      createEnv(db)
    );
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toEqual({ error: "recovery_v2_rotation_required" });
  });

  it("rotates v2 atomically without changing auth epoch or live sessions", async () => {
    const userId = createUser(db, {
      email: "rotate@example.com",
      protocolVersion: 2,
      generation: 3
    });
    const { token, csrfToken } = await createSession(db, userId);
    const packet = recoveryPacket(56);
    const signingPublicKey = fixedBase64Url(32, 200);
    const response = await app.request(
      "/vault/recovery/rotate",
      {
        method: "POST",
        headers: authHeaders(token, csrfToken),
        body: JSON.stringify({
          encryptedRecoveryPacket: packet,
          recoverySigningPublicKey: signingPublicKey
        })
      },
      createEnv(db)
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(db.sqlite.prepare(
      `SELECT r.generation, r.signing_public_key, u.auth_epoch,
              u.encrypted_recovery_packet AS user_packet,
              r.encrypted_recovery_packet AS recovery_packet
       FROM recovery_packets r JOIN users u ON u.id = r.user_id
       WHERE r.user_id = ?`
    ).get(userId)).toMatchObject({
      generation: 4,
      signing_public_key: signingPublicKey,
      auth_epoch: 0,
      user_packet: JSON.stringify(packet),
      recovery_packet: JSON.stringify(packet)
    });
    expect(db.sqlite.prepare("SELECT count(*) AS count FROM sessions WHERE user_id = ?")
      .get(userId)).toEqual({ count: 1 });
  });

  it("commits a signed recovery as one claim-first account transition", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"]
    ) as CryptoKeyPair;
    const rawPublicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    if (!(rawPublicKey instanceof ArrayBuffer)) throw new Error("expected raw public key bytes");
    const signingPublicKey = encodeCanonicalBase64Url(
      new Uint8Array(rawPublicKey)
    );
    const email = "recover@example.com";
    const userId = createUser(db, {
      email,
      protocolVersion: 2,
      signingPublicKey,
      generation: 7
    });
    const { token } = await createSession(db, userId);
    const now = new Date().toISOString();
    db.sqlite.prepare(
      `INSERT INTO login_sessions
         (id, user_id, server_login_state, auth_epoch, expires_at, created_at)
       VALUES (?, ?, 'AA', 0, ?, ?)`
    ).run(crypto.randomUUID(), userId, new Date(Date.now() + 86_400_000).toISOString(), now);
    const oldDeviceId = crypto.randomUUID();
    db.sqlite.prepare(
      `INSERT INTO trusted_devices
         (id, user_id, name, fingerprint, public_key, status, credential_hash,
          created_at, updated_at, last_seen_ip, last_seen_location)
       VALUES (?, ?, 'Old Android', 'old-device-fingerprint', ?, 'approved', 'old-hash', ?, ?, NULL, NULL)`
    ).run(oldDeviceId, userId, fixedBase64Url(32, 5), now, now);
    db.sqlite.prepare(
      "INSERT INTO vault_items (id, user_id, encrypted_payload) VALUES (?, ?, 'ciphertext')"
    ).run(crypto.randomUUID(), userId);

    const startResponse = await startRecovery(app, db, email);
    expect(startResponse.status).toBe(200);
    const start = await startResponse.json() as {
      recoveryAttemptId: string;
      challenge: string;
      registrationSessionId: string;
    };
    const deviceId = crypto.randomUUID();
    const publicKey = fixedBase64Url(32, 40);
    const unsigned = {
      recoveryAttemptId: start.recoveryAttemptId,
      email,
      registrationSessionId: start.registrationSessionId,
      registrationRecord: "AA",
      newEncryptedRecoveryPacket: recoveryPacket(88),
      newRecoverySigningPublicKey: signingPublicKey,
      device: {
        id: deviceId,
        name: "Recovery Pixel",
        fingerprint: "recovered-device-fingerprint",
        publicKey,
        credential: fixedBase64Url(32, 72),
        encryptedVaultKeyPacket: devicePacket(deviceId, publicKey)
      }
    };
    const transcript = buildRecoveryFinishTranscript({ ...unsigned, challenge: start.challenge });
    const signature = encodeCanonicalBase64Url(new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, transcript)
    ));
    const finish = await app.request(
      "/auth/recovery/finish",
      {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.8" },
        body: JSON.stringify({ ...unsigned, signature })
      },
      createEnv(db)
    );
    expect(finish.status).toBe(200);
    expect(await finish.json()).toEqual({ ok: true });

    expect(db.sqlite.prepare("SELECT auth_epoch FROM users WHERE id = ?").get(userId))
      .toEqual({ auth_epoch: 1 });
    expect(db.sqlite.prepare(
      "SELECT generation, signing_public_key FROM recovery_packets WHERE user_id = ?"
    ).get(userId)).toEqual({ generation: 8, signing_public_key: signingPublicKey });
    expect(db.sqlite.prepare("SELECT count(*) AS count FROM sessions WHERE user_id = ?")
      .get(userId)).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT count(*) AS count FROM login_sessions WHERE user_id = ?")
      .get(userId)).toEqual({ count: 0 });
    expect(db.sqlite.prepare(
      "SELECT status, credential_hash FROM trusted_devices WHERE id = ?"
    ).get(oldDeviceId)).toEqual({ status: "revoked", credential_hash: null });
    expect(db.sqlite.prepare(
      "SELECT status FROM trusted_devices WHERE id = ? AND user_id = ?"
    ).get(deviceId, userId)).toEqual({ status: "approved" });
    expect(db.sqlite.prepare("SELECT count(*) AS count FROM recovery_claims WHERE challenge_id = ?")
      .get(start.recoveryAttemptId)).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT count(*) AS count FROM vault_items WHERE user_id = ?")
      .get(userId)).toEqual({ count: 1 });

    const oldSession = await app.request(
      "/vault/recovery-packet",
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
      createEnv(db)
    );
    expect(oldSession.status).toBe(401);
  });

  it("removes the unauthenticated legacy packet lookup and rejects extra DTO fields", async () => {
    const removed = await app.request(
      "/auth/recovery/packet",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" })
      },
      createEnv(db)
    );
    expect(removed.status).toBe(404);

    const strict = await app.request(
      "/auth/recovery/start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          registrationRequest: "AA",
          recoveryCode: "must-stay-local"
        })
      },
      createEnv(db)
    );
    expect(strict.status).toBe(400);
    expect(await strict.json()).toEqual({ error: "invalid_recovery_start_request" });
  });
});
