// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { D1VaultStore } from "./d1-store";
import type {
  CiphertextEnvelope,
  ItemLevelEncryptedUpsert,
  ItemLevelSyncPlan,
  SyncPushRequest,
  TrustedDevice
} from "@zero-vault/shared";

// ── D1 Mock ──────────────────────────────────────────────────────────────────

class MockD1Result {
  success = true;
  meta: { changes?: number; last_row_id?: number; served_by?: string; duration?: number };
  constructor(changes = 0) {
    this.meta = { changes, duration: 0, served_by: "mock" };
  }
}

class MockD1PreparedStatement {
  private db: MockD1Database;
  // Exposed for batch execution
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

  // Synchronous run for use inside transactions
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

function runMigration(db: MockD1Database): void {
  const migration = `
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
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS registration_sessions (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      registration_response TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reg_sessions_email ON registration_sessions(email);
    CREATE INDEX IF NOT EXISTS idx_reg_sessions_expires ON registration_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS login_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      server_login_state TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_login_sessions_expires ON login_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      csrf_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

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
    CREATE INDEX IF NOT EXISTS idx_vault_items_user ON vault_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_vault_items_user_rev ON vault_items(user_id, revision);

    CREATE TABLE IF NOT EXISTS vault_item_history (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES vault_items(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_history_item ON vault_item_history(item_id);
    CREATE INDEX IF NOT EXISTS idx_history_user_item ON vault_item_history(user_id, item_id);

    CREATE TABLE IF NOT EXISTS recovery_packets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      encrypted_recovery_packet TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trusted_devices (
      id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    fingerprint TEXT,
    public_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_ip TEXT,
    last_seen_location TEXT
  );
    CREATE INDEX IF NOT EXISTS idx_devices_user ON trusted_devices(user_id);

    CREATE TABLE IF NOT EXISTS device_vault_keys (
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      encrypted_blob TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, device_id)
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (key, timestamp)
    );
    CREATE INDEX IF NOT EXISTS idx_rate_limits_key_ts ON rate_limits (key, timestamp);
  `;

  db.sqlite.exec(migration);
}

function createStore(): D1VaultStore {
  const db = createTestDB();
  runMigration(db);
  return new D1VaultStore(db as unknown as D1Database);
}

// ── Test Fixtures ────────────────────────────────────────────────────────────

const mockEnvelope: CiphertextEnvelope = {
  alg: "XCHACHA20_POLY1305",
  nonce: "dGVzdA",
  ciphertext: "dGVzdA"
};

function makeItem(overrides: Partial<ItemLevelEncryptedUpsert> = {}): ItemLevelEncryptedUpsert {
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("D1VaultStore", () => {
  let store: D1VaultStore;

  beforeEach(() => {
    store = createStore();
  });

  // ── User CRUD ──────────────────────────────────────────────────────────────

  describe("user CRUD", () => {
    it("creates a user and finds by email", async () => {
      const user = await store.createUser({
        email: "alice@example.com",
        opaqueRegistrationRecord: "rec",
        publicKeyBundle: "pk",
        encryptedRecoveryPacket: mockEnvelope
      });
      expect(user.email).toBe("alice@example.com");
      expect(user.serverRevision).toBe(0);
      expect(user.id).toBeTruthy();

      const found = await store.findUserByEmail("alice@example.com");
      expect(found).not.toBeNull();
      expect(found!.id).toBe(user.id);
    });

    it("finds user by id", async () => {
      const user = await store.createUser({
        email: "bob@example.com",
        opaqueRegistrationRecord: "rec",
        publicKeyBundle: "pk",
        encryptedRecoveryPacket: mockEnvelope
      });
      const found = await store.findUserById(user.id);
      expect(found).not.toBeNull();
      expect(found!.email).toBe("bob@example.com");
    });

    it("returns null for unknown email", async () => {
      expect(await store.findUserByEmail("nobody@example.com")).toBeNull();
    });

    it("returns null for unknown id", async () => {
      expect(await store.findUserById("nonexistent")).toBeNull();
    });

    it("throws user_exists on duplicate email", async () => {
      await store.createUser({
        email: "dup@example.com",
        opaqueRegistrationRecord: "rec",
        publicKeyBundle: "pk",
        encryptedRecoveryPacket: mockEnvelope
      });
      await expect(
        store.createUser({
          email: "dup@example.com",
          opaqueRegistrationRecord: "rec2",
          publicKeyBundle: "pk2",
          encryptedRecoveryPacket: mockEnvelope
        })
      ).rejects.toThrow("user_exists");
    });
  });

  // ── Registration Sessions ──────────────────────────────────────────────────

  describe("registration sessions", () => {
    it("creates and consumes a session", async () => {
      const session = await store.createRegistrationSession({
        email: "test@example.com",
        registrationResponse: "resp",
        expiresAt: new Date(Date.now() + 60_000)
      });
      expect(session.id).toBeTruthy();
      expect(session.email).toBe("test@example.com");

      const consumed = await store.consumeRegistrationSession(session.id);
      expect(consumed).not.toBeNull();
      expect(consumed!.email).toBe("test@example.com");

      // Second consume returns null (already consumed)
      expect(await store.consumeRegistrationSession(session.id)).toBeNull();
    });

    it("returns null for expired session", async () => {
      const session = await store.createRegistrationSession({
        email: "expired@example.com",
        registrationResponse: "resp",
        expiresAt: new Date(Date.now() - 1000)
      });
      const consumed = await store.consumeRegistrationSession(session.id);
      expect(consumed).toBeNull();
    });

    it("returns null for unknown session", async () => {
      expect(await store.consumeRegistrationSession("nonexistent")).toBeNull();
    });
  });

  // ── Login Sessions ─────────────────────────────────────────────────────────

  describe("login sessions", () => {
    let userId: string;

    beforeEach(async () => {
      const user = await store.createUser({
        email: "login@example.com",
        opaqueRegistrationRecord: "rec",
        publicKeyBundle: "pk",
        encryptedRecoveryPacket: mockEnvelope
      });
      userId = user.id;
    });

    it("creates and consumes a session", async () => {
      const session = await store.createLoginSession({
        userId,
        serverLoginState: "state",
        expiresAt: new Date(Date.now() + 60_000)
      });
      expect(session.userId).toBe(userId);

      const consumed = await store.consumeLoginSession(session.id);
      expect(consumed).not.toBeNull();
      expect(consumed!.serverLoginState).toBe("state");

      // Already consumed
      expect(await store.consumeLoginSession(session.id)).toBeNull();
    });

    it("returns null for expired session", async () => {
      const session = await store.createLoginSession({
        userId,
        serverLoginState: "state",
        expiresAt: new Date(Date.now() - 1000)
      });
      expect(await store.consumeLoginSession(session.id)).toBeNull();
    });
  });

  // ── Auth Sessions ──────────────────────────────────────────────────────────

  describe("auth sessions", () => {
    let userId: string;

    beforeEach(async () => {
      const user = await store.createUser({
        email: "auth@example.com",
        opaqueRegistrationRecord: "rec",
        publicKeyBundle: "pk",
        encryptedRecoveryPacket: mockEnvelope
      });
      userId = user.id;
    });

    it("creates, finds with user join, and deletes", async () => {
      await store.createSession({
        userId,
        tokenHash: "hash1",
        csrfToken: "csrf1",
        expiresAt: new Date(Date.now() + 60_000)
      });

      const found = await store.findSessionByTokenHash("hash1");
      expect(found).not.toBeNull();
      expect(found!.user.id).toBe(userId);
      expect(found!.user.email).toBe("auth@example.com");
      expect(found!.csrfToken).toBe("csrf1");

      await store.deleteSession("hash1");
      expect(await store.findSessionByTokenHash("hash1")).toBeNull();
    });

    it("returns null for expired session", async () => {
      await store.createSession({
        userId,
        tokenHash: "expired-hash",
        csrfToken: "csrf",
        expiresAt: new Date(Date.now() - 1000)
      });
      expect(await store.findSessionByTokenHash("expired-hash")).toBeNull();
    });

    it("cleans up expired sessions", async () => {
      await store.createSession({
        userId,
        tokenHash: "expired1",
        csrfToken: "csrf",
        expiresAt: new Date(Date.now() - 1000)
      });
      await store.createSession({
        userId,
        tokenHash: "valid1",
        csrfToken: "csrf",
        expiresAt: new Date(Date.now() + 60_000)
      });
      await store.createLoginSession({
        userId,
        serverLoginState: "state",
        expiresAt: new Date(Date.now() - 1000)
      });
      await store.createRegistrationSession({
        email: "expired-reg@example.com",
        registrationResponse: "resp",
        expiresAt: new Date(Date.now() - 1000)
      });

      const result = await store.cleanupExpiredSessions();
      expect(result.sessions).toBe(1);
      expect(result.loginSessions).toBe(1);
      expect(result.registrationSessions).toBe(1);

      // Valid session still exists
      expect(await store.findSessionByTokenHash("valid1")).not.toBeNull();
    });
  });

  // ── Vault Sync ─────────────────────────────────────────────────────────────

  describe("vault sync", () => {
    let userId: string;

    beforeEach(async () => {
      const user = await store.createUser({
        email: "vault@example.com",
        opaqueRegistrationRecord: "rec",
        publicKeyBundle: "pk",
        encryptedRecoveryPacket: mockEnvelope
      });
      userId = user.id;
    });

    it("pulls empty vault", async () => {
      const result = await store.pullVault(userId);
      expect(result.serverRevision).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.deletedItemIds).toEqual([]);
    });

    it("pushes and pulls items", async () => {
      const item = makeItem({ ownerUserId: userId });
      const pushReq: SyncPushRequest = {
        baseRevision: 0,
        upserts: [item],
        deletes: []
      };

      const pushResult = await store.pushVault(userId, pushReq);
      expect(pushResult.ok).toBe(true);
      if (pushResult.ok) {
        expect(pushResult.serverRevision).toBe(1);
      }

      const pullResult = await store.pullVault(userId);
      expect(pullResult.serverRevision).toBe(1);
      expect(pullResult.items).toHaveLength(1);
      expect(pullResult.items[0]!.id).toBe(item.id);
      expect(pullResult.items[0]!.revision).toBe(1);
    });

    it("returns sync_conflict on revision mismatch", async () => {
      const item = makeItem({ ownerUserId: userId });
      await store.pushVault(userId, { baseRevision: 0, upserts: [item], deletes: [] });

      const conflict = await store.pushVault(userId, {
        baseRevision: 0,
        upserts: [item],
        deletes: []
      });
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) {
        expect(conflict.error).toBe("sync_conflict");
        expect(conflict.serverRevision).toBe(1);
      }
    });

    it("deletes items and tracks deleted ids", async () => {
      const item = makeItem({ ownerUserId: userId });
      await store.pushVault(userId, { baseRevision: 0, upserts: [item], deletes: [] });

      const deleteResult = await store.pushVault(userId, {
        baseRevision: 1,
        upserts: [],
        deletes: [item.id]
      });
      expect(deleteResult.ok).toBe(true);

      const pull = await store.pullVault(userId);
      expect(pull.items).toHaveLength(0);
      expect(pull.deletedItemIds).toContain(item.id);
    });

    it("maintains item history", async () => {
      const item = makeItem({ ownerUserId: userId });
      await store.pushVault(userId, { baseRevision: 0, upserts: [item], deletes: [] });

      const updated = makeItem({
        id: item.id,
        ownerUserId: userId,
        updatedAt: "2025-02-01T00:00:00.000Z"
      });
      await store.pushVault(userId, { baseRevision: 1, upserts: [updated], deletes: [] });

      const history = await store.getItemHistory(userId, item.id);
      expect(history).toHaveLength(2);
      expect(history[0]!.revision).toBe(2);
      expect(history[1]!.revision).toBe(1);
    });
  });

  // ── Item-Level Sync ────────────────────────────────────────────────────────

  describe("item-level sync", () => {
    let userId: string;

    beforeEach(async () => {
      const user = await store.createUser({
        email: "itemlevel@example.com",
        opaqueRegistrationRecord: "rec",
        publicKeyBundle: "pk",
        encryptedRecoveryPacket: mockEnvelope
      });
      userId = user.id;
    });

    it("pushes and pulls items with item-level sync", async () => {
      const item = makeItem({ ownerUserId: userId });
      const plan: ItemLevelSyncPlan = {
        protocol: "item_level_v1",
        baseRevision: 0,
        upserts: [item],
        deletes: []
      };

      const result = await store.pushItemLevelSync(userId, plan);
      expect(result.serverRevision).toBe(1);
      expect(result.applied.upsertedItemIds).toContain(item.id);
      expect(result.conflicts).toHaveLength(0);

      const pull = await store.pullItemLevelSync(userId);
      expect(pull.serverRevision).toBe(1);
      expect(pull.items).toHaveLength(1);
      expect(pull.deletedItemIds).toHaveLength(0);
    });

    it("returns server_revision_advanced on server revision mismatch", async () => {
      const item = makeItem({ ownerUserId: userId });
      await store.pushItemLevelSync(userId, {
        protocol: "item_level_v1",
        baseRevision: 0,
        upserts: [item],
        deletes: []
      });

      const plan: ItemLevelSyncPlan = {
        protocol: "item_level_v1",
        baseRevision: 0,
        upserts: [item],
        deletes: []
      };
      const result = await store.pushItemLevelSync(userId, plan);
      expect(result.serverRevision).toBe(1);
      expect(result.applied.upsertedItemIds).toHaveLength(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.reason).toBe("server_revision_advanced");
      expect(result.conflicts[0]!.operation).toBe("upsert");
    });

    it("returns item_revision_advanced when item has been updated", async () => {
      const item = makeItem({ ownerUserId: userId });
      await store.pushItemLevelSync(userId, {
        protocol: "item_level_v1",
        baseRevision: 0,
        upserts: [item],
        deletes: []
      });

      // Try to update with stale baseItemRevision
      const staleUpdate = makeItem({
        ownerUserId: userId,
        baseItemRevision: 0,
        updatedAt: "2025-06-01T00:00:00.000Z"
      });
      const result = await store.pushItemLevelSync(userId, {
        protocol: "item_level_v1",
        baseRevision: 1,
        upserts: [staleUpdate],
        deletes: []
      });

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.reason).toBe("item_revision_advanced");
      expect(result.conflicts[0]!.serverItemRevision).toBe(1);
    });

    it("conditionally advances server revision only on successful operations", async () => {
      const item = makeItem({ ownerUserId: userId });
      await store.pushItemLevelSync(userId, {
        protocol: "item_level_v1",
        baseRevision: 0,
        upserts: [item],
        deletes: []
      });

      // All conflicts, no successful ops
      const result = await store.pushItemLevelSync(userId, {
        protocol: "item_level_v1",
        baseRevision: 0,
        upserts: [item],
        deletes: []
      });

      expect(result.serverRevision).toBe(1); // unchanged
      expect(result.applied.upsertedItemIds).toHaveLength(0);
    });

    it("deletes items with item-level sync", async () => {
      const item = makeItem({ ownerUserId: userId });
      await store.pushItemLevelSync(userId, {
        protocol: "item_level_v1",
        baseRevision: 0,
        upserts: [item],
        deletes: []
      });

      const result = await store.pushItemLevelSync(userId, {
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
      });

      expect(result.applied.deletedItemIds).toContain(item.id);
      expect(result.conflicts).toHaveLength(0);

      const pull = await store.pullItemLevelSync(userId);
      expect(pull.items).toHaveLength(0);
      expect(pull.deletedItemIds).toContain(item.id);
    });

    it("mixes upserts and deletes", async () => {
      const item1 = makeItem({
        id: "b0000000-0000-0000-0000-000000000001",
        ownerUserId: userId
      });
      const item2 = makeItem({
        id: "b0000000-0000-0000-0000-000000000002",
        ownerUserId: userId
      });

      await store.pushItemLevelSync(userId, {
        protocol: "item_level_v1",
        baseRevision: 0,
        upserts: [item1, item2],
        deletes: []
      });

      // Update item1, delete item2
      const updated1 = makeItem({
        id: item1.id,
        ownerUserId: userId,
        updatedAt: "2025-06-01T00:00:00.000Z"
      });
      const result = await store.pushItemLevelSync(userId, {
        protocol: "item_level_v1",
        baseRevision: 1,
        upserts: [updated1],
        deletes: [
          { id: item2.id, ownerUserId: userId, deletedAt: "2025-06-01T00:00:00.000Z" }
        ]
      });

      expect(result.applied.upsertedItemIds).toContain(item1.id);
      expect(result.applied.deletedItemIds).toContain(item2.id);
      expect(result.serverRevision).toBe(2);
    });
  });

  // ── Recovery Packets ───────────────────────────────────────────────────────

  describe("recovery packets", () => {
    let userId: string;

    beforeEach(async () => {
      const user = await store.createUser({
        email: "recovery@example.com",
        opaqueRegistrationRecord: "rec",
        publicKeyBundle: "pk",
        encryptedRecoveryPacket: mockEnvelope
      });
      userId = user.id;
    });

    it("returns initial registration packet when no rotation has been done", async () => {
      // createUser stores the initial packet in the users table.
      // getRecoveryPacket falls back to it when recovery_packets has no row.
      const packet = await store.getRecoveryPacket(userId);
      expect(packet).toEqual(mockEnvelope);
    });

    it("saves and retrieves recovery packet", async () => {
      await store.saveRecoveryPacket(userId, mockEnvelope);
      const packet = await store.getRecoveryPacket(userId);
      expect(packet).toEqual(mockEnvelope);
    });

    it("rotates recovery packet", async () => {
      await store.saveRecoveryPacket(userId, mockEnvelope);

      const newEnvelope: CiphertextEnvelope = {
        alg: "AES_256_GCM",
        nonce: "bmV3",
        ciphertext: "bmV3"
      };
      await store.rotateRecoveryPacket(userId, newEnvelope);

      const packet = await store.getRecoveryPacket(userId);
      expect(packet!.alg).toBe("AES_256_GCM");
    });

    it("prefers recovery_packets table over users table", async () => {
      // Save a different packet to recovery_packets table
      const rotated: CiphertextEnvelope = {
        alg: "AES_256_GCM",
        nonce: "cm90YXRlZA",
        ciphertext: "cm90YXRlZA"
      };
      await store.saveRecoveryPacket(userId, rotated);

      const packet = await store.getRecoveryPacket(userId);
      expect(packet!.alg).toBe("AES_256_GCM");
    });
  });

  // ── Trusted Devices ────────────────────────────────────────────────────────

  describe("trusted devices", () => {
    let userId: string;

    beforeEach(async () => {
      const user = await store.createUser({
        email: "devices@example.com",
        opaqueRegistrationRecord: "rec",
        publicKeyBundle: "pk",
        encryptedRecoveryPacket: mockEnvelope
      });
      userId = user.id;
    });

    const makeDevice = (overrides: Partial<TrustedDevice> = {}): TrustedDevice => ({
      id: "c0000000-0000-0000-0000-000000000001",
      name: "My Laptop",
      fingerprint: "same-device-fingerprint",
      publicKey: "dGVzdC1way",
      status: "pending",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      ...overrides
    });

    it("registers and lists devices", async () => {
      await store.registerDevice(userId, makeDevice());
      const devices = await store.listDevices(userId);
      expect(devices).toHaveLength(1);
      expect(devices[0]!.name).toBe("My Laptop");
      expect(devices[0]!.status).toBe("pending");
    });

    it("reuses the existing device for the same browser public key", async () => {
      const first = await store.registerDevice(userId, makeDevice());
      const second = await store.registerDevice(
        userId,
        makeDevice({
          id: "c0000000-0000-0000-0000-000000000002",
          name: "Renamed Laptop",
          publicKey: first.publicKey,
          createdAt: "2025-01-02T00:00:00.000Z",
          updatedAt: "2025-01-02T00:00:00.000Z"
        })
      );

      expect(second.id).toBe(first.id);
      expect(second.name).toBe("Renamed Laptop");

      const devices = await store.listDevices(userId);
      expect(devices).toHaveLength(1);
      expect(devices[0]!.id).toBe(first.id);
      expect(devices[0]!.name).toBe("Renamed Laptop");
    });

    it("reuses the existing pending device for the same fingerprint when public key changes", async () => {
      const first = await store.registerDevice(userId, makeDevice());
      const second = await store.registerDevice(
        userId,
        makeDevice({
          id: "c0000000-0000-0000-0000-000000000002",
          fingerprint: first.fingerprint,
          publicKey: "bmV3LXB1YmxpYy1rZXk",
          lastSeenIp: "203.0.113.10",
          lastSeenLocation: "Shanghai · CN"
        })
      );

      expect(second.id).toBe(first.id);
      expect(second.publicKey).toBe("bmV3LXB1YmxpYy1rZXk");
      expect(second.status).toBe("pending");
      expect(second.lastSeenIp).toBe("203.0.113.10");

      const devices = await store.listDevices(userId);
      expect(devices).toHaveLength(1);
      expect(devices[0]!.id).toBe(first.id);
      expect(devices[0]!.publicKey).toBe("bmV3LXB1YmxpYy1rZXk");
    });

    it("collapses legacy pending duplicates created in the same minute", async () => {
      await store.registerDevice(
        userId,
        makeDevice({
          id: "c0000000-0000-0000-0000-000000000010",
          fingerprint: undefined,
          name: "Mac",
          publicKey: "bWFjLTE",
          createdAt: "2026-06-16T08:48:01.000Z",
          updatedAt: "2026-06-16T08:48:01.000Z"
        })
      );
      await store.registerDevice(
        userId,
        makeDevice({
          id: "c0000000-0000-0000-0000-000000000011",
          fingerprint: undefined,
          name: "Mac",
          publicKey: "bWFjLTI",
          createdAt: "2026-06-16T08:48:40.000Z",
          updatedAt: "2026-06-16T08:48:40.000Z"
        })
      );

      const devices = await store.listDevices(userId);
      expect(devices).toHaveLength(1);
      expect(devices[0]!.publicKey).toBe("bWFjLTI");
    });

    it("approves a device", async () => {
      const device = makeDevice();
      await store.registerDevice(userId, device);
      await store.approveDevice(userId, device.id);

      const devices = await store.listDevices(userId);
      expect(devices[0]!.status).toBe("approved");
    });

    it("rejects a device", async () => {
      const device = makeDevice();
      await store.registerDevice(userId, device);
      await store.rejectDevice(userId, device.id);

      const devices = await store.listDevices(userId);
      expect(devices[0]!.status).toBe("rejected");
    });

    it("revokes a device", async () => {
      const device = makeDevice();
      await store.registerDevice(userId, device);
      await store.revokeDevice(userId, device.id);

      const devices = await store.listDevices(userId);
      expect(devices[0]!.status).toBe("revoked");
    });

    it("throws device_not_found for unknown device", async () => {
      await expect(store.approveDevice(userId, "nonexistent")).rejects.toThrow(
        "device_not_found"
      );
    });

    it("returns empty list when no devices", async () => {
      const devices = await store.listDevices(userId);
      expect(devices).toEqual([]);
    });
  });

  // ── Device Vault Keys ──────────────────────────────────────────────────────

  describe("device vault keys", () => {
    let userId: string;

    beforeEach(async () => {
      const user = await store.createUser({
        email: "dvk@example.com",
        opaqueRegistrationRecord: "rec",
        publicKeyBundle: "pk",
        encryptedRecoveryPacket: mockEnvelope
      });
      userId = user.id;

      await store.registerDevice(userId, {
        id: "dvk-device-001",
        name: "Test Device",
        publicKey: "dGVzdC1way",
        status: "approved",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z"
      });
    });

    it("saves and retrieves a device vault key", async () => {
      await store.saveDeviceVaultKey(userId, "dvk-device-001", "encrypted-blob-data");
      const key = await store.getDeviceVaultKey(userId, "dvk-device-001");
      expect(key).toBe("encrypted-blob-data");
    });

    it("returns null for device without a vault key", async () => {
      const key = await store.getDeviceVaultKey(userId, "dvk-device-001");
      expect(key).toBeNull();
    });

    it("overwrites an existing device vault key", async () => {
      await store.saveDeviceVaultKey(userId, "dvk-device-001", "old-blob");
      await store.saveDeviceVaultKey(userId, "dvk-device-001", "new-blob");
      const key = await store.getDeviceVaultKey(userId, "dvk-device-001");
      expect(key).toBe("new-blob");
    });

    it("returns null for unknown device", async () => {
      const key = await store.getDeviceVaultKey(userId, "nonexistent");
      expect(key).toBeNull();
    });
  });

  // ── Delete User ────────────────────────────────────────────────────────────

  describe("deleteUser", () => {
    it("deletes a user and cascades to sessions and devices", async () => {
      const user = await store.createUser({
        email: "delete-me@example.com",
        opaqueRegistrationRecord: "rec",
        publicKeyBundle: "pk",
        encryptedRecoveryPacket: mockEnvelope
      });
      const userId = user.id;

      // Create a session for the user
      await store.createSession({
        userId,
        tokenHash: "del-hash",
        csrfToken: "csrf",
        expiresAt: new Date(Date.now() + 60_000)
      });

      // Register a device
      await store.registerDevice(userId, {
        id: "del-device-001",
        name: "Delete Device",
        publicKey: "dGVzdA",
        status: "approved",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z"
      });

      // Delete user
      await store.deleteUser(userId);

      // User is gone
      expect(await store.findUserById(userId)).toBeNull();
      expect(await store.findUserByEmail("delete-me@example.com")).toBeNull();

      // Session is gone (cascade)
      expect(await store.findSessionByTokenHash("del-hash")).toBeNull();

      // Devices are gone (cascade)
      const devices = await store.listDevices(userId);
      expect(devices).toEqual([]);
    });

    it("does not throw for nonexistent user", async () => {
      await expect(store.deleteUser("nonexistent")).resolves.not.toThrow();
    });
  });
});
