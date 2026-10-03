import type {
  AppliedMutationReceipt,
  DeviceVaultKeyPacket,
  ItemLevelServerState,
  ItemLevelSyncChange,
  ItemLevelSyncConflict,
  ItemLevelSyncPlan,
  ItemLevelSyncPullResponse,
  RecoveryFinishUnsignedRequest,
  RecoveryPacketEnvelope,
  RecoveryPacketV2,
  SyncPullResponse,
  SyncPushRequest,
  TrustedDevice,
  VaultItemCiphertext
} from "@zero-vault/shared";
import {
  base64UrlSchema,
  deviceVaultKeyPacketSchema,
  itemLevelSyncChangeSchema,
  recoveryPacketV2Schema,
  recoverySigningPublicKeySchema
} from "@zero-vault/shared";
import type {
  FakeLoginSession,
  ItemLevelSyncPushResult,
  LoginSession,
  PushResult,
  RegistrationSession,
  RecoveryChallenge,
  RecoveryRecord,
  StoredSession,
  StoredUser,
  VaultStore
} from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

function parseJSON<T>(value: string): T {
  return JSON.parse(value) as T;
}

function nowPlus(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

const MAX_SYNC_REVISION_RETRIES = 2;
const DEVICE_PACKET_NONCE_BYTES = 24;
const DEVICE_PACKET_EPHEMERAL_KEY_BYTES = 32;
const DEVICE_PACKET_CIPHERTEXT_BYTES = 48;
const LEGACY_DEVICE_PACKET_BYTES =
  DEVICE_PACKET_NONCE_BYTES +
  DEVICE_PACKET_EPHEMERAL_KEY_BYTES +
  DEVICE_PACKET_CIPHERTEXT_BYTES;
const LEGACY_DEVICE_PACKET_BASE64URL_CHARS = Math.ceil(LEGACY_DEVICE_PACKET_BYTES * 8 / 6);

function decodeBase64Url(value: string): Uint8Array | null {
  if (!base64UrlSchema.safeParse(value).success) return null;
  try {
    const standard = value.replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

export function convertLegacyDeviceVaultKeyPacket(
  value: string,
  device: TrustedDevice
): DeviceVaultKeyPacket | null {
  // Historical Web writes used canonical, unpadded base64url.
  if (value.length !== LEGACY_DEVICE_PACKET_BASE64URL_CHARS) return null;
  const bytes = decodeBase64Url(value);
  if (!bytes || bytes.length !== LEGACY_DEVICE_PACKET_BYTES) return null;

  const nonceEnd = DEVICE_PACKET_NONCE_BYTES;
  const ephemeralEnd = nonceEnd + DEVICE_PACKET_EPHEMERAL_KEY_BYTES;
  const parsed = deviceVaultKeyPacketSchema.safeParse({
    version: 1,
    recipientDeviceId: device.id,
    recipientPublicKey: device.publicKey,
    ephemeralPublicKey: encodeBase64Url(bytes.slice(nonceEnd, ephemeralEnd)),
    encryptedVaultKey: {
      alg: "XCHACHA20_POLY1305",
      nonce: encodeBase64Url(bytes.slice(0, nonceEnd)),
      ciphertext: encodeBase64Url(bytes.slice(ephemeralEnd))
    }
  });
  return parsed.success ? parsed.data : null;
}

class SyncRevisionClaimConflict extends Error {
  constructor() {
    super("sync_revision_claim_conflict");
  }
}

// ── D1VaultStore ─────────────────────────────────────────────────────────────

export class D1VaultStore implements VaultStore {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  // ── User CRUD ──────────────────────────────────────────────────────────────

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const row = await this.db
      .prepare("SELECT * FROM users WHERE email = ?")
      .bind(email)
      .first<Record<string, unknown>>();
    return row ? this.rowToUser(row) : null;
  }

  async findUserByRecoveryEmail(email: string): Promise<StoredUser | null> {
    const row = await this.db
      .prepare("SELECT * FROM users WHERE lower(email) = lower(?)")
      .bind(email)
      .first<Record<string, unknown>>();
    return row ? this.rowToUser(row) : null;
  }

  async findUserById(userId: string): Promise<StoredUser | null> {
    const row = await this.db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(userId)
      .first<Record<string, unknown>>();
    return row ? this.rowToUser(row) : null;
  }

  async createUser(input: {
    email: string;
    opaqueRegistrationRecord: string;
    publicKeyBundle: string;
    encryptedRecoveryPacket: RecoveryPacketEnvelope;
  }): Promise<StoredUser> {
    const existing = await this.findUserByEmail(input.email);
    if (existing) {
      throw new Error("user_exists");
    }

    const id = generateId();
    const ts = nowISO();

    await this.db
      .prepare(
        `INSERT INTO users (id, email, opaque_registration_record, public_key_bundle, encrypted_recovery_packet, server_revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .bind(
        id,
        input.email,
        input.opaqueRegistrationRecord,
        input.publicKeyBundle,
        JSON.stringify(input.encryptedRecoveryPacket),
        ts,
        ts
      )
      .run();

    return {
      id,
      email: input.email,
      opaqueRegistrationRecord: input.opaqueRegistrationRecord,
      publicKeyBundle: input.publicKeyBundle,
      encryptedRecoveryPacket: input.encryptedRecoveryPacket,
      serverRevision: 0,
      authEpoch: 0
    };
  }

  async createMobileAccount(input: {
    email: string;
    opaqueRegistrationRecord: string;
    publicKeyBundle: string;
    encryptedRecoveryPacket: RecoveryPacketV2;
    recoverySigningPublicKey: string;
    device: TrustedDevice;
    deviceCredentialHash: string;
    encryptedVaultKeyPacket: DeviceVaultKeyPacket;
    session: { tokenHash: string; csrfToken: string; expiresAt: Date };
  }): Promise<{ user: StoredUser; session: StoredSession }> {
    if (await this.findUserByEmail(input.email)) throw new Error("user_exists");
    const existingDeviceId = await this.db
      .prepare("SELECT user_id FROM trusted_devices WHERE id = ?")
      .bind(input.device.id)
      .first<Record<string, unknown>>();
    if (existingDeviceId) throw new Error("device_id_conflict");

    const userId = generateId();
    const sessionId = generateId();
    const ts = nowISO();
    await this.db.batch([
      this.db.prepare(
         `INSERT INTO users
           (id, email, opaque_registration_record, public_key_bundle,
            encrypted_recovery_packet, server_revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        userId,
        input.email,
        input.opaqueRegistrationRecord,
        input.publicKeyBundle,
        JSON.stringify(input.encryptedRecoveryPacket),
        0,
        ts,
        ts
      ),
      this.db.prepare(
        `INSERT INTO recovery_packets
           (user_id, encrypted_recovery_packet, protocol_version,
            signing_public_key, generation, created_at, updated_at)
         VALUES (?, ?, 2, ?, 0, ?, ?)`
      ).bind(
        userId,
        JSON.stringify(input.encryptedRecoveryPacket),
        input.recoverySigningPublicKey,
        ts,
        ts
      ),
      this.db.prepare(
        `INSERT INTO trusted_devices
           (id, user_id, name, fingerprint, public_key, status, credential_hash,
            created_at, updated_at, last_seen_ip, last_seen_location)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        input.device.id,
        userId,
        input.device.name,
        input.device.fingerprint ?? null,
        input.device.publicKey,
        "approved",
        input.deviceCredentialHash,
        input.device.createdAt,
        input.device.updatedAt,
        input.device.lastSeenIp ?? null,
        input.device.lastSeenLocation ?? null
      ),
      this.db.prepare(
        `INSERT INTO device_vault_keys (user_id, device_id, encrypted_blob, created_at)
         VALUES (?, ?, ?, ?)`
      ).bind(
        userId,
        input.device.id,
        JSON.stringify(input.encryptedVaultKeyPacket),
        ts
      ),
      this.db.prepare(
        `INSERT INTO sessions
           (id, user_id, token_hash, csrf_token, device_id, auth_epoch, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      ).bind(
        sessionId,
        userId,
        input.session.tokenHash,
        input.session.csrfToken,
        input.device.id,
        input.session.expiresAt.toISOString(),
        ts
      )
    ]);

    const user: StoredUser = {
      id: userId,
      email: input.email,
      opaqueRegistrationRecord: input.opaqueRegistrationRecord,
      publicKeyBundle: input.publicKeyBundle,
      encryptedRecoveryPacket: input.encryptedRecoveryPacket,
      serverRevision: 0,
      authEpoch: 0
    };
    return {
      user,
      session: {
        id: sessionId,
        userId,
        tokenHash: input.session.tokenHash,
        csrfToken: input.session.csrfToken,
        deviceId: input.device.id,
        authEpoch: 0,
        expiresAt: input.session.expiresAt
      }
    };
  }

  // ── Registration Sessions ──────────────────────────────────────────────────

  async createRegistrationSession(
    input: Omit<RegistrationSession, "id">
  ): Promise<RegistrationSession> {
    const id = generateId();
    const ts = nowISO();

    await this.db
      .prepare(
        `INSERT INTO registration_sessions (id, email, registration_response, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, input.email, input.registrationResponse, input.expiresAt.toISOString(), ts)
      .run();

    return { ...input, id };
  }

  async consumeRegistrationSession(id: string): Promise<RegistrationSession | null> {
    const session = await this.getRegistrationSession(id);
    if (!session) return null;
    const consumed = await this.db
      .prepare("DELETE FROM registration_sessions WHERE id = ?")
      .bind(id)
      .run();
    if ((consumed.meta?.changes ?? 0) !== 1) return null;
    return session;
  }

  async getRegistrationSession(id: string): Promise<RegistrationSession | null> {
    const row = await this.db
      .prepare("SELECT * FROM registration_sessions WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();

    if (!row) return null;
    const expiresAt = new Date(row.expires_at as string);
    if (expiresAt <= new Date()) return null;

    return {
      id: row.id as string,
      email: row.email as string,
      registrationResponse: row.registration_response as string,
      expiresAt
    };
  }

  // ── Login Sessions ─────────────────────────────────────────────────────────

  async createLoginSession(
    input: Omit<LoginSession, "id" | "authEpoch"> & { authEpoch?: number }
  ): Promise<LoginSession> {
    const id = generateId();
    const ts = nowISO();
    const authEpoch = input.authEpoch ?? (await this.findUserById(input.userId))?.authEpoch;
    if (authEpoch === undefined) throw new Error("auth_epoch_changed");

    await this.db
      .prepare(
        `INSERT INTO login_sessions
           (id, user_id, server_login_state, auth_epoch, expires_at, created_at)
         SELECT ?, u.id, ?, ?, ?, ?
         FROM users u
         WHERE u.id = ? AND u.auth_epoch = ?`
      )
      .bind(
        id,
        input.serverLoginState,
        authEpoch,
        input.expiresAt.toISOString(),
        ts,
        input.userId,
        authEpoch
      )
      .run()
      .then((result) => {
        if ((result.meta?.changes ?? 0) !== 1) throw new Error("auth_epoch_changed");
      });

    return { ...input, id, authEpoch };
  }

  async consumeLoginSession(id: string): Promise<LoginSession | null> {
    const row = await this.db
      .prepare("SELECT * FROM login_sessions WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();

    if (!row) return null;
    const consumed = await this.db
      .prepare("DELETE FROM login_sessions WHERE id = ?")
      .bind(id)
      .run();
    if ((consumed.meta?.changes ?? 0) !== 1) return null;

    const expiresAt = new Date(row.expires_at as string);
    if (expiresAt <= new Date()) {
      return null;
    }

    return {
      id: row.id as string,
      userId: row.user_id as string,
      serverLoginState: row.server_login_state as string,
      authEpoch: typeof row.auth_epoch === "number" ? row.auth_epoch : 0,
      expiresAt
    };
  }

  async createFakeLoginSession(
    input: Omit<FakeLoginSession, "id">
  ): Promise<FakeLoginSession> {
    const id = generateId();
    await this.db
      .prepare(
        `INSERT INTO fake_login_sessions
           (id, email, server_login_state, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, input.email, input.serverLoginState, input.expiresAt.toISOString(), nowISO())
      .run();
    return { ...input, id };
  }

  async consumeFakeLoginSession(id: string): Promise<FakeLoginSession | null> {
    const row = await this.db
      .prepare("SELECT * FROM fake_login_sessions WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!row) return null;

    const consumed = await this.db
      .prepare("DELETE FROM fake_login_sessions WHERE id = ?")
      .bind(id)
      .run();
    if ((consumed.meta?.changes ?? 0) !== 1) return null;

    const expiresAt = new Date(row.expires_at as string);
    if (expiresAt <= new Date()) return null;
    return {
      id: row.id as string,
      email: row.email as string,
      serverLoginState: row.server_login_state as string,
      expiresAt
    };
  }

  // ── Auth Sessions ──────────────────────────────────────────────────────────

  async createSession(
    input: Omit<StoredSession, "id" | "deviceId" | "authEpoch"> & {
      deviceId?: string | null;
      authEpoch?: number;
    }
  ): Promise<StoredSession> {
    const id = generateId();
    const ts = nowISO();
    const authEpoch = input.authEpoch ?? (await this.findUserById(input.userId))?.authEpoch;
    if (authEpoch === undefined) throw new Error("auth_epoch_changed");

    const inserted = await this.db
      .prepare(
        `INSERT INTO sessions
           (id, user_id, token_hash, csrf_token, device_id, auth_epoch, expires_at, created_at)
         SELECT ?, u.id, ?, ?, ?, ?, ?, ?
         FROM users u
         WHERE u.id = ? AND u.auth_epoch = ?`
      )
      .bind(
        id,
        input.tokenHash,
        input.csrfToken,
        input.deviceId ?? null,
        authEpoch,
        input.expiresAt.toISOString(),
        ts,
        input.userId,
        authEpoch
      )
      .run();
    if ((inserted.meta?.changes ?? 0) !== 1) throw new Error("auth_epoch_changed");

    return { ...input, id, deviceId: input.deviceId ?? null, authEpoch };
  }

  async rotateDeviceSession(
    input: Omit<StoredSession, "id" | "deviceId" | "authEpoch"> & {
      deviceId: string;
      authEpoch?: number;
    }
  ): Promise<StoredSession> {
    const id = generateId();
    const ts = nowISO();
    const authEpoch = input.authEpoch ?? (await this.findUserById(input.userId))?.authEpoch;
    if (authEpoch === undefined) throw new Error("auth_epoch_changed");
    // A native login is also a session rotation. Keeping this insert and delete
    // in one D1 batch prevents repeated biometric/unlock authorization from
    // accumulating multiple 14-day bearer sessions for the same device. The
    // epoch/device-status SELECT closes the recovery-vs-login race.
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO sessions
             (id, user_id, token_hash, csrf_token, device_id, auth_epoch, expires_at, created_at)
           SELECT ?, u.id, ?, ?, d.id, ?, ?, ?
           FROM users u
           JOIN trusted_devices d ON d.user_id = u.id AND d.id = ?
           WHERE u.id = ? AND u.auth_epoch = ?
             AND d.status IN ('pending', 'approved')`
        )
        .bind(
          id,
          input.tokenHash,
          input.csrfToken,
          authEpoch,
          input.expiresAt.toISOString(),
          ts,
          input.deviceId,
          input.userId,
          authEpoch
        ),
      this.db
        .prepare(
          `DELETE FROM sessions
           WHERE user_id = ? AND device_id = ? AND id != ?
             AND EXISTS (
               SELECT 1 FROM sessions replacement
               WHERE replacement.id = ? AND replacement.user_id = ?
                 AND replacement.device_id = ? AND replacement.auth_epoch = ?
             )`
        )
        .bind(
          input.userId,
          input.deviceId,
          id,
          id,
          input.userId,
          input.deviceId,
          authEpoch
        )
    ]);
    const inserted = await this.findSessionByTokenHash(input.tokenHash);
    if (!inserted || inserted.id !== id) throw new Error("auth_epoch_changed");
    return { ...input, id, authEpoch };
  }

  async findSessionByTokenHash(
    tokenHash: string
  ): Promise<(StoredSession & { user: StoredUser }) | null> {
    const row = await this.db
      .prepare(
        `SELECT
           s.id AS s_id, s.user_id, s.token_hash, s.csrf_token, s.device_id, s.auth_epoch,
           s.expires_at AS s_expires_at,
           u.id AS u_id, u.email, u.opaque_registration_record, u.public_key_bundle,
           u.encrypted_recovery_packet, u.server_revision, u.auth_epoch AS u_auth_epoch
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.token_hash = ? AND s.auth_epoch = u.auth_epoch`
      )
      .bind(tokenHash)
      .first<Record<string, unknown>>();

    if (!row) return null;

    const expiresAt = new Date(row.s_expires_at as string);
    if (expiresAt <= new Date()) return null;

    return {
      id: row.s_id as string,
      userId: row.user_id as string,
      tokenHash: row.token_hash as string,
      csrfToken: row.csrf_token as string,
      deviceId: (row.device_id as string | null) ?? null,
      authEpoch: row.auth_epoch as number,
      expiresAt,
      user: {
        id: row.u_id as string,
        email: row.email as string,
        opaqueRegistrationRecord: row.opaque_registration_record as string,
        publicKeyBundle: row.public_key_bundle as string,
        encryptedRecoveryPacket: parseJSON(row.encrypted_recovery_packet as string),
        serverRevision: row.server_revision as number,
        authEpoch: row.u_auth_epoch as number
      }
    };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .run();
  }

  async cleanupExpiredSessions(
    now = new Date()
  ): Promise<{
    sessions: number;
    loginSessions: number;
    fakeLoginSessions: number;
    registrationSessions: number;
    recoveryChallenges: number;
  }> {
    const iso = now.toISOString();

    const sessResult = await this.db
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .bind(iso)
      .run();

    const loginResult = await this.db
      .prepare("DELETE FROM login_sessions WHERE expires_at <= ?")
      .bind(iso)
      .run();

    const fakeLoginResult = await this.db
      .prepare("DELETE FROM fake_login_sessions WHERE expires_at <= ?")
      .bind(iso)
      .run();

    const regResult = await this.db
      .prepare("DELETE FROM registration_sessions WHERE expires_at <= ?")
      .bind(iso)
      .run();

    // recovery_claims references recovery_challenges with ON DELETE CASCADE,
    // so an expired single-use proof and its audit claim are removed together.
    const recoveryResult = await this.db
      .prepare("DELETE FROM recovery_challenges WHERE expires_at <= ?")
      .bind(iso)
      .run();

    return {
      sessions: sessResult.meta?.changes ?? 0,
      loginSessions: loginResult.meta?.changes ?? 0,
      fakeLoginSessions: fakeLoginResult.meta?.changes ?? 0,
      registrationSessions: regResult.meta?.changes ?? 0,
      recoveryChallenges: recoveryResult.meta?.changes ?? 0
    };
  }

  // ── Vault Sync ─────────────────────────────────────────────────────────────

  async pullVault(userId: string): Promise<SyncPullResponse> {
    const user = await this.findUserById(userId);

    const itemRows = await this.db
      .prepare(
        `SELECT * FROM vault_items WHERE user_id = ? AND deleted_at IS NULL`
      )
      .bind(userId)
      .all<Record<string, unknown>>();

    const deletedRows = await this.db
      .prepare(
        `SELECT id FROM vault_items WHERE user_id = ? AND deleted_at IS NOT NULL`
      )
      .bind(userId)
      .all<Record<string, unknown>>();

    return {
      serverRevision: user?.serverRevision ?? 0,
      items: itemRows.results.map((r) => this.rowToVaultItem(r)),
      deletedItemIds: deletedRows.results.map((r) => r.id as string)
    };
  }

  async pushVault(userId: string, request: SyncPushRequest): Promise<PushResult> {
    const user = await this.findUserById(userId);
    if (!user) throw new Error("user_not_found");

    for (const item of request.upserts) {
      if (item.ownerUserId !== userId) throw new Error("item_owner_mismatch");
      const existing = await this.db
        .prepare("SELECT user_id FROM vault_items WHERE id = ?")
        .bind(item.id)
        .first<Record<string, unknown>>();
      if (existing && existing.user_id !== userId) throw new Error("item_owner_mismatch");
    }

    if (request.baseRevision !== user.serverRevision) {
      return { ok: false, error: "sync_conflict", serverRevision: user.serverRevision };
    }

    const nextRevision = user.serverRevision + 1;
    const ts = nowISO();

    // Build batch of statements
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmts: D1PreparedStatement[] = [];

    // This must be the first statement in the transaction. Concurrent legacy
    // and item-level writers that both read the same revision cannot both own
    // the next one.
    stmts.push(
      this.db
        .prepare(
          `INSERT INTO item_sync_revision_claims (user_id, revision, created_at)
           VALUES (?, ?, ?)`
        )
        .bind(userId, nextRevision, ts)
    );

    // Update user revision
    stmts.push(
      this.db
        .prepare("UPDATE users SET server_revision = ?, updated_at = ? WHERE id = ?")
        .bind(nextRevision, ts, userId)
    );

    // Upserts
    for (const item of request.upserts) {
      const nextItem = {
        id: item.id,
        ownerUserId: item.ownerUserId,
        revision: nextRevision,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        encryptedItemKey: item.encryptedItemKey,
        encryptedPayload: item.encryptedPayload,
        encryptedSearchTokens: item.encryptedSearchTokens
      };

      stmts.push(
        this.db
          .prepare(
            `INSERT INTO vault_items (id, user_id, revision, created_at, updated_at, encrypted_item_key, encrypted_payload, encrypted_search_tokens, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(id) DO UPDATE SET
               revision = excluded.revision,
               updated_at = excluded.updated_at,
               encrypted_item_key = excluded.encrypted_item_key,
               encrypted_payload = excluded.encrypted_payload,
               encrypted_search_tokens = excluded.encrypted_search_tokens,
               deleted_at = NULL
             WHERE vault_items.user_id = excluded.user_id`
          )
          .bind(
            nextItem.id,
            userId,
            nextRevision,
            nextItem.createdAt,
            nextItem.updatedAt,
            JSON.stringify(nextItem.encryptedItemKey),
            JSON.stringify(nextItem.encryptedPayload),
            JSON.stringify(nextItem.encryptedSearchTokens)
          )
      );

      // Add history entry
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO vault_item_history (id, item_id, user_id, revision, snapshot, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(
            generateId(),
            nextItem.id,
            userId,
            nextRevision,
            JSON.stringify(nextItem),
            ts
          )
      );

      stmts.push(
        this.db
          .prepare(
            `INSERT INTO item_sync_changes
               (user_id, item_id, operation, item_revision, change_json, created_at)
             VALUES (?, ?, 'upsert', ?, ?, ?)`
          )
          .bind(
            userId,
            nextItem.id,
            nextRevision,
            JSON.stringify({ operation: "upsert", item: nextItem }),
            ts
          )
      );
    }

    // Deletes
    for (const id of request.deletes) {
      stmts.push(
        this.db
          .prepare(
            `UPDATE vault_items
             SET revision = ?, deleted_at = ?, updated_at = ?
             WHERE id = ? AND user_id = ?`
          )
          .bind(nextRevision, ts, ts, id, userId)
      );
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO item_sync_changes
               (user_id, item_id, operation, item_revision, change_json, created_at)
             SELECT ?, id, 'delete', revision, ?, ?
             FROM vault_items
             WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`
          )
          .bind(
            userId,
            JSON.stringify({
              operation: "delete",
              itemId: id,
              revision: nextRevision,
              deletedAt: ts
            }),
            ts,
            id,
            userId
          )
      );
    }

    try {
      await this.db.batch(stmts);
    } catch (error) {
      const latestUser = await this.findUserById(userId);
      if (latestUser && latestUser.serverRevision !== user.serverRevision) {
        return {
          ok: false,
          error: "sync_conflict",
          serverRevision: latestUser.serverRevision
        };
      }
      throw error;
    }

    return { ok: true, serverRevision: nextRevision };
  }

  async getItemHistory(userId: string, itemId: string): Promise<VaultItemCiphertext[]> {
    const rows = await this.db
      .prepare(
        `SELECT snapshot FROM vault_item_history
         WHERE user_id = ? AND item_id = ?
         ORDER BY revision DESC`
      )
      .bind(userId, itemId)
      .all<Record<string, unknown>>();

    return rows.results.map((r) => parseJSON<VaultItemCiphertext>(r.snapshot as string));
  }

  // ── Item-Level Sync ────────────────────────────────────────────────────────

  async pushItemLevelSync(
    userId: string,
    plan: ItemLevelSyncPlan
  ): Promise<ItemLevelSyncPushResult> {
    for (let attempt = 0; attempt <= MAX_SYNC_REVISION_RETRIES; attempt += 1) {
      try {
        return await this.pushItemLevelSyncOnce(userId, plan);
      } catch (error) {
        if (!(error instanceof SyncRevisionClaimConflict) || attempt === MAX_SYNC_REVISION_RETRIES) {
          throw error;
        }
      }
    }
    throw new Error("sync_revision_retry_exhausted");
  }

  private async pushItemLevelSyncOnce(
    userId: string,
    plan: ItemLevelSyncPlan
  ): Promise<ItemLevelSyncPushResult> {
    const user = await this.findUserById(userId);
    if (!user) throw new Error("user_not_found");

    type ReceiptResult =
      | { status: "applied"; operation: "upsert" | "delete"; itemId: string; appliedRevision: number }
      | { status: "conflict"; conflict: ItemLevelSyncConflict };
    type PendingReceipt = {
      mutationId: string;
      requestFingerprint: string;
      result:
        | { status: "applied"; operation: "upsert" | "delete"; itemId: string }
        | { status: "conflict"; conflict: ItemLevelSyncConflict };
    };

    const conflicts: ItemLevelSyncConflict[] = [];
    const upsertedItemIds: string[] = [];
    const deletedItemIds: string[] = [];
    const mutationReceipts: AppliedMutationReceipt[] = [];
    const nextRevision = user.serverRevision + 1;
    const operations = [
      ...plan.upserts.map((item) => ({ operation: "upsert" as const, item })),
      ...plan.deletes.map((item) => ({ operation: "delete" as const, item }))
    ];
    const allItemIds = operations.map(({ item }) => item.id);
    const allMutationIds = operations.map(({ item }) => item.clientMutationId);
    const itemRowsById = new Map<string, Record<string, unknown>>();
    const receiptsById = new Map<string, { requestFingerprint: string; result: ReceiptResult }>();

    if (allItemIds.length > 0) {
      const placeholders = allItemIds.map(() => "?").join(",");
      const rows = await this.db
        .prepare(`SELECT * FROM vault_items WHERE id IN (${placeholders})`)
        .bind(...allItemIds)
        .all<Record<string, unknown>>();
      for (const row of rows.results) itemRowsById.set(row.id as string, row);

      const mutationPlaceholders = allMutationIds.map(() => "?").join(",");
      const receiptRows = await this.db
        .prepare(
          `SELECT client_mutation_id, request_fingerprint, result_json
           FROM item_sync_mutations
           WHERE user_id = ? AND client_mutation_id IN (${mutationPlaceholders})`
        )
        .bind(userId, ...allMutationIds)
        .all<Record<string, unknown>>();
      for (const row of receiptRows.results) {
        receiptsById.set(row.client_mutation_id as string, {
          requestFingerprint: row.request_fingerprint as string,
          result: parseJSON<ReceiptResult>(row.result_json as string)
        });
      }
    }

    const serverState = (row: Record<string, unknown> | undefined): ItemLevelServerState => {
      if (!row || row.user_id !== userId) return { kind: "missing" };
      if (typeof row.deleted_at === "string") {
        return {
          kind: "deleted",
          itemId: row.id as string,
          revision: row.revision as number,
          deletedAt: row.deleted_at
        };
      }
      return { kind: "item", item: this.rowToVaultItem(row) };
    };
    const conflictFor = (
      operation: "upsert" | "delete",
      itemId: string,
      baseItemRevision: number,
      reason: ItemLevelSyncConflict["reason"],
      row: Record<string, unknown> | undefined
    ): ItemLevelSyncConflict => ({
      itemId,
      operation,
      reason,
      clientBaseRevision: baseItemRevision,
      serverRevision: user.serverRevision,
      ...(row?.user_id === userId ? { serverItemRevision: row.revision as number } : {}),
      serverState: serverState(row)
    });

    const stmts: D1PreparedStatement[] = [];
    const pendingReceipts: PendingReceipt[] = [];
    let hasStateWrite = false;

    for (const { operation, item } of operations) {
      if (item.ownerUserId !== userId) {
        throw new Error("item_owner_mismatch");
      }

      // Native/Web queues persist the exact encrypted operation before send.
      // Bind the durable receipt to both logical metadata and canonical
      // envelope fields so a reused mutation id can never acknowledge content
      // that the server did not store.
      const requestFingerprint = operation === "upsert"
        ? JSON.stringify({
            operation,
            itemId: item.id,
            ownerUserId: item.ownerUserId,
            baseItemRevision: item.baseItemRevision,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            encryptedItemKey: {
              alg: item.encryptedItemKey.alg,
              nonce: item.encryptedItemKey.nonce,
              ciphertext: item.encryptedItemKey.ciphertext,
              aad: item.encryptedItemKey.aad ?? null
            },
            encryptedPayload: {
              alg: item.encryptedPayload.alg,
              nonce: item.encryptedPayload.nonce,
              ciphertext: item.encryptedPayload.ciphertext,
              aad: item.encryptedPayload.aad ?? null
            },
            encryptedSearchTokens: item.encryptedSearchTokens.map((token) => ({
              alg: token.alg,
              nonce: token.nonce,
              ciphertext: token.ciphertext,
              aad: token.aad ?? null
            })),
            ciphertextHash: item.ciphertextHash ?? null
          })
        : JSON.stringify({
            operation,
            itemId: item.id,
            ownerUserId: item.ownerUserId,
            baseItemRevision: item.baseItemRevision,
            deletedAt: item.deletedAt
          });
      const row = itemRowsById.get(item.id);
      const previous = receiptsById.get(item.clientMutationId);
      if (previous) {
        if (previous.requestFingerprint !== requestFingerprint) {
          conflicts.push(
            conflictFor(operation, item.id, item.baseItemRevision, "mutation_id_reused", row)
          );
        } else if (previous.result.status === "conflict") {
          conflicts.push(previous.result.conflict);
        } else if (previous.result.operation === "upsert") {
          upsertedItemIds.push(previous.result.itemId);
          mutationReceipts.push({
            clientMutationId: item.clientMutationId,
            itemId: previous.result.itemId,
            operation: "upsert",
            appliedItemRevision: previous.result.appliedRevision
          });
        } else {
          deletedItemIds.push(previous.result.itemId);
          mutationReceipts.push({
            clientMutationId: item.clientMutationId,
            itemId: previous.result.itemId,
            operation: "delete",
            appliedItemRevision: previous.result.appliedRevision
          });
        }
        continue;
      }

      let conflict: ItemLevelSyncConflict | undefined;
      if (plan.baseRevision > user.serverRevision) {
        conflict = conflictFor(
          operation,
          item.id,
          item.baseItemRevision,
          "invalid_server_revision",
          row
        );
      } else if (row && row.user_id !== userId) {
        conflict = conflictFor(operation, item.id, item.baseItemRevision, "item_owner_mismatch", row);
      } else if (operation === "delete" && !row) {
        // A local create+delete must be compacted out of the offline queue. The
        // server cannot acknowledge a delete for state it has never observed:
        // doing so races with a concurrent create of the same item id.
        conflict = conflictFor(
          operation,
          item.id,
          item.baseItemRevision,
          "item_revision_mismatch",
          row
        );
      } else {
        const currentRevision = (row?.revision as number | undefined) ?? 0;
        if (item.baseItemRevision !== currentRevision) {
          conflict = conflictFor(
            operation,
            item.id,
            item.baseItemRevision,
            currentRevision > item.baseItemRevision
              ? "item_revision_advanced"
              : "item_revision_mismatch",
            row
          );
        }
      }

      if (conflict) {
        conflicts.push(conflict);
        pendingReceipts.push({
          mutationId: item.clientMutationId,
          requestFingerprint,
          result: { status: "conflict", conflict }
        });
        continue;
      }

      if (operation === "upsert") {
        const nextItem: VaultItemCiphertext = {
          id: item.id,
          ownerUserId: userId,
          revision: nextRevision,
          createdAt: typeof row?.created_at === "string" ? row.created_at : item.createdAt,
          updatedAt: item.updatedAt,
          encryptedItemKey: item.encryptedItemKey,
          encryptedPayload: item.encryptedPayload,
          encryptedSearchTokens: item.encryptedSearchTokens
        };
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO vault_items (id, user_id, revision, created_at, updated_at, encrypted_item_key, encrypted_payload, encrypted_search_tokens, deleted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
               ON CONFLICT(id) DO UPDATE SET
                 revision = excluded.revision,
                 updated_at = excluded.updated_at,
                 encrypted_item_key = excluded.encrypted_item_key,
                 encrypted_payload = excluded.encrypted_payload,
                 encrypted_search_tokens = excluded.encrypted_search_tokens,
                 deleted_at = NULL
               WHERE vault_items.user_id = excluded.user_id`
            )
            .bind(
              nextItem.id,
              userId,
              nextRevision,
              nextItem.createdAt,
              nextItem.updatedAt,
              JSON.stringify(nextItem.encryptedItemKey),
              JSON.stringify(nextItem.encryptedPayload),
              JSON.stringify(nextItem.encryptedSearchTokens)
            )
        );
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO vault_item_history (id, item_id, user_id, revision, snapshot, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .bind(generateId(), nextItem.id, userId, nextRevision, JSON.stringify(nextItem), nowISO())
        );
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO item_sync_changes
                 (user_id, item_id, operation, item_revision, change_json, created_at)
               VALUES (?, ?, 'upsert', ?, ?, ?)`
            )
            .bind(
              userId,
              nextItem.id,
              nextRevision,
              JSON.stringify({ operation: "upsert", item: nextItem }),
              nowISO()
            )
        );
        hasStateWrite = true;
        upsertedItemIds.push(item.id);
      } else {
        deletedItemIds.push(item.id);
        if (row) {
          const deletedAt = nowISO();
          stmts.push(
            this.db
              .prepare(
                `UPDATE vault_items
                 SET revision = ?, deleted_at = ?, updated_at = ?
                 WHERE id = ? AND user_id = ? AND revision = ?`
              )
              .bind(nextRevision, deletedAt, deletedAt, item.id, userId, item.baseItemRevision)
          );
          stmts.push(
            this.db
              .prepare(
                `INSERT INTO item_sync_changes
                   (user_id, item_id, operation, item_revision, change_json, created_at)
                 VALUES (?, ?, 'delete', ?, ?, ?)`
              )
              .bind(
                userId,
                item.id,
                nextRevision,
                JSON.stringify({
                  operation: "delete",
                  itemId: item.id,
                  revision: nextRevision,
                  deletedAt
                }),
                deletedAt
              )
          );
          hasStateWrite = true;
        }
      }

      pendingReceipts.push({
        mutationId: item.clientMutationId,
        requestFingerprint,
        result: { status: "applied", operation, itemId: item.id }
      });
    }

    const serverRevision = hasStateWrite ? nextRevision : user.serverRevision;
    for (const receipt of pendingReceipts) {
      if (receipt.result.status === "conflict") {
        receipt.result.conflict.serverRevision = serverRevision;
      }
      const result: ReceiptResult = receipt.result.status === "applied"
        ? { ...receipt.result, appliedRevision: serverRevision }
        : receipt.result;
      if (result.status === "applied") {
        mutationReceipts.push({
          clientMutationId: receipt.mutationId,
          itemId: result.itemId,
          operation: result.operation,
          appliedItemRevision: result.appliedRevision
        });
      }
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO item_sync_mutations
               (user_id, client_mutation_id, request_fingerprint, result_json, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(
            userId,
            receipt.mutationId,
            receipt.requestFingerprint,
            JSON.stringify(result),
            nowISO()
          )
      );
    }

    if (hasStateWrite) {
      stmts.unshift(
        this.db
          .prepare(
            `INSERT INTO item_sync_revision_claims (user_id, revision, created_at)
             VALUES (?, ?, ?)`
          )
          .bind(userId, serverRevision, nowISO())
      );
      stmts.push(
        this.db
          .prepare("UPDATE users SET server_revision = ?, updated_at = ? WHERE id = ?")
          .bind(serverRevision, nowISO(), userId)
      );
    }

    if (stmts.length > 0) {
      try {
        await this.db.batch(stmts);
      } catch (error) {
        if (hasStateWrite) {
          const latestUser = await this.findUserById(userId);
          if (latestUser && latestUser.serverRevision !== user.serverRevision) {
            throw new SyncRevisionClaimConflict();
          }
        }
        if (pendingReceipts.length > 0) {
          const placeholders = pendingReceipts.map(() => "?").join(",");
          const claimedReceipt = await this.db
            .prepare(
              `SELECT client_mutation_id FROM item_sync_mutations
               WHERE user_id = ? AND client_mutation_id IN (${placeholders})
               LIMIT 1`
            )
            .bind(userId, ...pendingReceipts.map((receipt) => receipt.mutationId))
            .first<Record<string, unknown>>();
          if (claimedReceipt) throw new SyncRevisionClaimConflict();
        }
        throw error;
      }
    }

    return {
      serverRevision,
      applied: { upsertedItemIds, deletedItemIds, mutationReceipts },
      conflicts
    };
  }

  async pullItemLevelSync(
    userId: string,
    cursor: number,
    limit = 200
  ): Promise<ItemLevelSyncPullResponse> {
    const user = await this.findUserById(userId);
    if (!user) throw new Error("user_not_found");

    const safeLimit = Math.max(1, Math.min(limit, 500));
    const rows = await this.db
      .prepare(
        `SELECT cursor, change_json
         FROM item_sync_changes
         WHERE user_id = ? AND cursor > ?
         ORDER BY cursor ASC
         LIMIT ?`
      )
      .bind(userId, cursor, safeLimit + 1)
      .all<Record<string, unknown>>();
    const selected = rows.results.slice(0, safeLimit);
    const changes: ItemLevelSyncChange[] = selected.flatMap((row) => {
      try {
        const parsed = itemLevelSyncChangeSchema.safeParse({
          ...parseJSON<Omit<ItemLevelSyncChange, "cursor">>(row.change_json as string),
          cursor: row.cursor as number
        });
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
    const latestByItemId = new Map<string, ItemLevelSyncChange>();
    for (const change of changes) {
      latestByItemId.set(change.operation === "upsert" ? change.item.id : change.itemId, change);
    }
    const latestChanges = [...latestByItemId.values()];
    const items = latestChanges
      .filter((change): change is Extract<ItemLevelSyncChange, { operation: "upsert" }> =>
        change.operation === "upsert"
      )
      .map((change) => change.item);
    const deletedItems = latestChanges
      .filter((change): change is Extract<ItemLevelSyncChange, { operation: "delete" }> =>
        change.operation === "delete"
      )
      .map((change) => ({
        id: change.itemId,
        revision: change.revision,
        deletedAt: change.deletedAt
      }));

    return {
      protocol: "item_level_v1",
      serverRevision: user.serverRevision,
      // Advance over legacy whole-vault rows that cannot satisfy the strict
      // item-level envelope contract. Those vaults must be migrated on Web;
      // repeatedly returning the malformed row would otherwise brick Android.
      cursor: (selected.at(-1)?.cursor as number | undefined) ?? cursor,
      hasMore: rows.results.length > safeLimit,
      changes,
      items,
      deletedItemIds: deletedItems.map((item) => item.id),
      deletedItems
    };
  }

  async getEncryptedItem(userId: string, itemId: string): Promise<VaultItemCiphertext | null> {
    const row = await this.db
      .prepare("SELECT * FROM vault_items WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
      .bind(itemId, userId)
      .first<Record<string, unknown>>();
    return row ? this.rowToVaultItem(row) : null;
  }

  // ── Encrypted Search ─────────────────────────────────────────────────────────

  async searchItemsByTokens(userId: string, tokenHexes: string[]): Promise<string[]> {
    if (tokenHexes.length === 0) return [];

    // Use INSTR() instead of LIKE to avoid "LIKE or GLOB pattern too complex" errors
    // with 64-char hex tokens. INSTR() does simple substring matching.
    // The stored JSON for each token is {"alg":"HMAC_SHA256","nonce":"AA","ciphertext":"<hex>"}
    const instrClauses = tokenHexes.map(() =>
      `INSTR(encrypted_search_tokens, ?) > 0`
    );
    const orClause = instrClauses.length === 1
      ? instrClauses[0]!
      : `(${instrClauses.join(" OR ")})`;

    // Build search substrings that match the ciphertext field within the JSON array
    const patterns = tokenHexes.map((hex) => `"ciphertext":"${hex}"`);

    const rows = await this.db
      .prepare(
        `SELECT id FROM vault_items WHERE user_id = ? AND deleted_at IS NULL AND ${orClause}`
      )
      .bind(userId, ...patterns)
      .all<Record<string, unknown>>();

    return rows.results.map((r) => r.id as string);
  }

  // ── Recovery Packets ───────────────────────────────────────────────────────

  async saveRecoveryPacket(userId: string, packet: RecoveryPacketEnvelope): Promise<void> {
    const current = await this.getRecoveryRecord(userId);
    if (current?.protocolVersion === 2) throw new Error("recovery_v2_rotation_required");
    const ts = nowISO();
    await this.db
      .prepare(
        `INSERT INTO recovery_packets (user_id, encrypted_recovery_packet, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           encrypted_recovery_packet = excluded.encrypted_recovery_packet,
           updated_at = excluded.updated_at`
      )
      .bind(userId, JSON.stringify(packet), ts, ts)
      .run();
  }

  async getRecoveryPacket(userId: string): Promise<RecoveryPacketEnvelope | null> {
    const record = await this.getRecoveryRecord(userId);
    return record?.protocolVersion === 1
      ? record.encryptedRecoveryPacket as RecoveryPacketEnvelope
      : null;
  }

  async rotateRecoveryPacket(userId: string, packet: RecoveryPacketEnvelope): Promise<void> {
    await this.saveRecoveryPacket(userId, packet);
  }

  async getRecoveryRecord(userId: string): Promise<RecoveryRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT encrypted_recovery_packet, protocol_version, signing_public_key, generation
         FROM recovery_packets WHERE user_id = ?`
      )
      .bind(userId)
      .first<Record<string, unknown>>();
    if (row) {
      const protocolVersion = row.protocol_version === 2 ? 2 : 1;
      const packet = parseJSON<unknown>(row.encrypted_recovery_packet as string);
      if (protocolVersion === 2) {
        const parsedPacket = recoveryPacketV2Schema.safeParse(packet);
        const parsedKey = recoverySigningPublicKeySchema.safeParse(row.signing_public_key);
        if (!parsedPacket.success || !parsedKey.success) return null;
        return {
          protocolVersion,
          encryptedRecoveryPacket: parsedPacket.data,
          signingPublicKey: parsedKey.data,
          generation: row.generation as number
        };
      }
      return {
        protocolVersion,
        encryptedRecoveryPacket: packet as RecoveryPacketEnvelope,
        signingPublicKey: null,
        generation: row.generation as number
      };
    }
    const user = await this.findUserById(userId);
    return user ? {
      protocolVersion: 1,
      encryptedRecoveryPacket: user.encryptedRecoveryPacket as RecoveryPacketEnvelope,
      signingPublicKey: null,
      generation: 0
    } : null;
  }

  async createRecoveryChallenge(
    input: Omit<RecoveryChallenge, "id">
  ): Promise<RecoveryChallenge> {
    const id = generateId();
    await this.db.prepare(
      `INSERT INTO recovery_challenges
         (id, user_id, auth_epoch, recovery_generation, nonce,
          registration_session_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      input.userId,
      input.authEpoch,
      input.recoveryGeneration,
      input.nonce,
      input.registrationSessionId,
      input.expiresAt.toISOString(),
      nowISO()
    ).run();
    return { ...input, id };
  }

  async getRecoveryChallenge(id: string): Promise<RecoveryChallenge | null> {
    const row = await this.db.prepare(
      `SELECT id, user_id, auth_epoch, recovery_generation, nonce,
              registration_session_id, expires_at
       FROM recovery_challenges WHERE id = ?`
    ).bind(id).first<Record<string, unknown>>();
    if (!row) return null;
    return {
      id: row.id as string,
      userId: (row.user_id as string | null) ?? null,
      authEpoch: (row.auth_epoch as number | null) ?? null,
      recoveryGeneration: (row.recovery_generation as number | null) ?? null,
      nonce: row.nonce as string,
      registrationSessionId: row.registration_session_id as string,
      expiresAt: new Date(row.expires_at as string)
    };
  }

  async migrateRecoveryV1(
    userId: string,
    packet: RecoveryPacketV2,
    signingPublicKey: string
  ): Promise<void> {
    const current = await this.getRecoveryRecord(userId);
    if (!current) throw new Error("recovery_packet_not_found");
    if (current.protocolVersion === 2) throw new Error("recovery_v2_rotation_required");
    const ts = nowISO();
    const serialized = JSON.stringify(packet);
    await this.db.batch([
      this.db.prepare(
        `INSERT INTO recovery_packets
           (user_id, encrypted_recovery_packet, protocol_version,
            signing_public_key, generation, created_at, updated_at)
         VALUES (?, ?, 2, ?, 1, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           encrypted_recovery_packet = excluded.encrypted_recovery_packet,
           protocol_version = 2,
           signing_public_key = excluded.signing_public_key,
           generation = recovery_packets.generation + 1,
           updated_at = excluded.updated_at
         WHERE recovery_packets.protocol_version = 1`
      ).bind(userId, serialized, signingPublicKey, ts, ts),
      this.db.prepare(
        `UPDATE users SET encrypted_recovery_packet = ?, updated_at = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM recovery_packets r
           WHERE r.user_id = users.id AND r.protocol_version = 2
             AND r.encrypted_recovery_packet = ? AND r.signing_public_key = ?
         )`
      ).bind(serialized, ts, userId, serialized, signingPublicKey)
    ]);
    const migrated = await this.getRecoveryRecord(userId);
    if (
      migrated?.protocolVersion !== 2 ||
      migrated.signingPublicKey !== signingPublicKey ||
      JSON.stringify(migrated.encryptedRecoveryPacket) !== serialized
    ) {
      throw new Error("recovery_v1_migration_not_committed");
    }
  }

  async rotateRecoveryV2(
    user: StoredUser,
    expectedGeneration: number,
    packet: RecoveryPacketV2,
    signingPublicKey: string
  ): Promise<void> {
    const serialized = JSON.stringify(packet);
    const ts = nowISO();
    const [updated] = await this.db.batch([
      this.db.prepare(
        `UPDATE recovery_packets
         SET encrypted_recovery_packet = ?, signing_public_key = ?,
             generation = generation + 1, updated_at = ?
         WHERE user_id = ? AND protocol_version = 2 AND generation = ?
           AND EXISTS (
             SELECT 1 FROM users u
             WHERE u.id = recovery_packets.user_id AND u.auth_epoch = ?
           )`
      ).bind(
        serialized,
        signingPublicKey,
        ts,
        user.id,
        expectedGeneration,
        user.authEpoch
      ),
      this.db.prepare(
        `UPDATE users
         SET encrypted_recovery_packet = ?, updated_at = ?
         WHERE id = ? AND auth_epoch = ? AND EXISTS (
           SELECT 1 FROM recovery_packets r
           WHERE r.user_id = users.id AND r.protocol_version = 2
             AND r.generation = ? AND r.encrypted_recovery_packet = ?
             AND r.signing_public_key = ?
         )`
      ).bind(
        serialized,
        ts,
        user.id,
        user.authEpoch,
        expectedGeneration + 1,
        serialized,
        signingPublicKey
      )
    ]);
    if ((updated?.meta?.changes ?? 0) !== 1) throw new Error("recovery_state_changed");
    const [committedUser, committedRecord] = await Promise.all([
      this.findUserById(user.id),
      this.getRecoveryRecord(user.id)
    ]);
    if (
      !committedUser || committedUser.authEpoch !== user.authEpoch ||
      JSON.stringify(committedUser.encryptedRecoveryPacket) !== serialized ||
      committedRecord?.protocolVersion !== 2 ||
      committedRecord.generation !== expectedGeneration + 1 ||
      committedRecord.signingPublicKey !== signingPublicKey ||
      JSON.stringify(committedRecord.encryptedRecoveryPacket) !== serialized
    ) {
      throw new Error("recovery_state_changed");
    }
  }

  async finishRecoveryV2(input: {
    user: StoredUser;
    challenge: RecoveryChallenge;
    request: RecoveryFinishUnsignedRequest;
    deviceCredentialHash: string;
  }): Promise<void> {
    const { user, challenge, request } = input;
    const now = nowISO();
    const nextPacket = JSON.stringify(request.newEncryptedRecoveryPacket);
    const devicePacket = JSON.stringify(request.device.encryptedVaultKeyPacket);
    const eligibility = `
      SELECT c.id, c.user_id
      FROM recovery_challenges c
      JOIN users u ON u.id = c.user_id
      JOIN recovery_packets r ON r.user_id = u.id
      JOIN registration_sessions rs ON rs.id = c.registration_session_id
      WHERE c.id = ? AND c.user_id = ?
        AND c.expires_at > ? AND rs.expires_at > ?
        AND c.auth_epoch = u.auth_epoch AND c.auth_epoch = ?
        AND c.recovery_generation = r.generation AND c.recovery_generation = ?
        AND r.protocol_version = 2 AND r.signing_public_key IS NOT NULL
        AND c.registration_session_id = ?
        AND lower(rs.email) = lower(u.email) AND lower(u.email) = lower(?)
        AND NOT EXISTS (
          SELECT 1 FROM trusted_devices d
          WHERE d.id = ? AND d.user_id != u.id
        )`;

    try {
      await this.db.batch([
        // An invalid SELECT deliberately inserts NULL into NOT NULL columns;
        // a replay hits the claims primary key. Either constraint aborts the
        // entire D1 batch before any account state changes.
        this.db.prepare(
          `WITH eligible AS (${eligibility})
           INSERT INTO recovery_claims (challenge_id, user_id, claimed_at)
           SELECT id, user_id, ? FROM eligible
           UNION ALL
           SELECT NULL, NULL, ? WHERE NOT EXISTS (SELECT 1 FROM eligible)`
        ).bind(
          challenge.id,
          user.id,
          now,
          now,
          user.authEpoch,
          challenge.recoveryGeneration,
          request.registrationSessionId,
          request.email,
          request.device.id,
          now,
          now
        ),
        this.db.prepare(
          "DELETE FROM registration_sessions WHERE id = ? AND lower(email) = lower(?)"
        ).bind(request.registrationSessionId, request.email),
        this.db.prepare(
          `UPDATE users
           SET opaque_registration_record = ?, encrypted_recovery_packet = ?,
               auth_epoch = auth_epoch + 1, updated_at = ?
           WHERE id = ? AND auth_epoch = ?`
        ).bind(request.registrationRecord, nextPacket, now, user.id, user.authEpoch),
        this.db.prepare(
          `UPDATE recovery_packets
           SET encrypted_recovery_packet = ?, protocol_version = 2,
               signing_public_key = ?, generation = generation + 1, updated_at = ?
           WHERE user_id = ? AND protocol_version = 2 AND generation = ?`
        ).bind(
          nextPacket,
          request.newRecoverySigningPublicKey,
          now,
          user.id,
          challenge.recoveryGeneration
        ),
        this.db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
        this.db.prepare("DELETE FROM login_sessions WHERE user_id = ?").bind(user.id),
        this.db.prepare(
          "DELETE FROM registration_sessions WHERE lower(email) = lower(?)"
        ).bind(request.email),
        this.db.prepare("DELETE FROM device_vault_keys WHERE user_id = ?").bind(user.id),
        this.db.prepare(
          `UPDATE trusted_devices
           SET status = 'revoked', credential_hash = NULL, updated_at = ?
           WHERE user_id = ?`
        ).bind(now, user.id),
        this.db.prepare(
          `INSERT INTO trusted_devices
             (id, user_id, name, fingerprint, public_key, status, credential_hash,
              created_at, updated_at, last_seen_ip, last_seen_location)
           VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, NULL, NULL)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             fingerprint = excluded.fingerprint,
             public_key = excluded.public_key,
             status = 'approved',
             credential_hash = excluded.credential_hash,
             updated_at = excluded.updated_at,
             last_seen_ip = NULL,
             last_seen_location = NULL
           WHERE trusted_devices.user_id = excluded.user_id`
        ).bind(
          request.device.id,
          user.id,
          request.device.name,
          request.device.fingerprint,
          request.device.publicKey,
          input.deviceCredentialHash,
          now,
          now
        ),
        this.db.prepare(
          `INSERT INTO device_vault_keys (user_id, device_id, encrypted_blob, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, device_id) DO UPDATE SET
             encrypted_blob = excluded.encrypted_blob,
             created_at = excluded.created_at`
        ).bind(user.id, request.device.id, devicePacket, now)
      ]);
    } catch (error) {
      const owner = await this.getDeviceOwnerUserId(request.device.id);
      if (owner && owner !== user.id) throw new Error("device_id_conflict");
      const [freshUser, freshRecord, freshChallenge, registration, claim] = await Promise.all([
        this.findUserById(user.id),
        this.getRecoveryRecord(user.id),
        this.getRecoveryChallenge(challenge.id),
        this.getRegistrationSession(request.registrationSessionId),
        this.db.prepare("SELECT challenge_id FROM recovery_claims WHERE challenge_id = ?")
          .bind(challenge.id)
          .first<Record<string, unknown>>()
      ]);
      if (
        claim ||
        !freshUser || !freshRecord || freshRecord.protocolVersion !== 2 ||
        !freshChallenge || freshChallenge.expiresAt <= new Date() ||
        !registration ||
        freshUser.authEpoch !== challenge.authEpoch ||
        freshRecord.generation !== challenge.recoveryGeneration
      ) {
        throw new Error("invalid_recovery_authorization");
      }
      throw error;
    }

    const [committedUser, committedRecord, committedDevice, committedPacket] = await Promise.all([
      this.findUserById(user.id),
      this.getRecoveryRecord(user.id),
      this.getDevice(user.id, request.device.id),
      this.getDeviceVaultKey(user.id, request.device.id)
    ]);
    if (
      committedUser?.authEpoch !== user.authEpoch + 1 ||
      committedRecord?.protocolVersion !== 2 ||
      committedRecord.generation !== (challenge.recoveryGeneration ?? -1) + 1 ||
      committedDevice?.status !== "approved" ||
      !committedPacket || JSON.stringify(committedPacket) !== devicePacket
    ) {
      throw new Error("recovery_commit_not_committed");
    }
  }

  // ── Trusted Devices ────────────────────────────────────────────────────────

  async registerDevice(
    userId: string,
    device: TrustedDevice,
    credentialHash?: string,
    expectedAuthEpoch?: number
  ): Promise<TrustedDevice> {
    const ts = nowISO();
    const fingerprint = device.fingerprint ?? null;
    const epochBind = expectedAuthEpoch ?? null;
    const assertExpectedEpoch = async (): Promise<void> => {
      if (expectedAuthEpoch === undefined) return;
      const current = await this.db
        .prepare("SELECT auth_epoch FROM users WHERE id = ?")
        .bind(userId)
        .first<Record<string, unknown>>();
      const currentEpoch = typeof current?.auth_epoch === "number" ? current.auth_epoch : 0;
      if (!current || currentEpoch !== expectedAuthEpoch) throw new Error("auth_epoch_changed");
    };
    await assertExpectedEpoch();
    const idOwner = await this.db
      .prepare("SELECT user_id FROM trusted_devices WHERE id = ?")
      .bind(device.id)
      .first<Record<string, unknown>>();
    if (idOwner && idOwner.user_id !== userId) {
      throw new Error("device_id_conflict");
    }
    const existing = await this.db
      .prepare(
        `SELECT id, name, fingerprint, public_key, status, credential_hash,
                created_at, updated_at, last_seen_ip, last_seen_location
         FROM trusted_devices
         WHERE user_id = ? AND (public_key = ? OR (fingerprint IS NOT NULL AND fingerprint = ?))
         ORDER BY
           CASE WHEN fingerprint IS NOT NULL AND fingerprint = ? THEN 0 ELSE 1 END,
           CASE status
             WHEN 'approved' THEN 0
             WHEN 'pending' THEN 1
             WHEN 'revoked' THEN 2
             WHEN 'rejected' THEN 3
             ELSE 4
           END,
           updated_at DESC
         LIMIT 1`
      )
      .bind(userId, device.publicKey, fingerprint, fingerprint)
      .first<Record<string, unknown>>();

    if (existing) {
      const keyChanged = existing.public_key !== device.publicKey;
      // A registration without an existing device credential represents a new
      // installation. It must be approved again even if metadata was copied.
      const mobileReset = credentialHash !== undefined;
      if (mobileReset && existing.id !== device.id) {
        // Native callers persist the id and credential before the request. If
        // a reinstall reuses a fingerprint/public key, replace the stale row
        // with that caller id so a lost HTTP response remains retryable.
        await this.db.batch([
          this.db.prepare(
            `DELETE FROM sessions
             WHERE user_id = ? AND device_id = ? AND EXISTS (
               SELECT 1 FROM users u
               WHERE u.id = ? AND (? IS NULL OR u.auth_epoch = ?)
             )`
          ).bind(userId, existing.id as string, userId, epochBind, epochBind),
          this.db.prepare(
            `DELETE FROM device_vault_keys
             WHERE user_id = ? AND device_id = ? AND EXISTS (
               SELECT 1 FROM users u
               WHERE u.id = ? AND (? IS NULL OR u.auth_epoch = ?)
             )`
          ).bind(userId, existing.id as string, userId, epochBind, epochBind),
          this.db.prepare(
            `DELETE FROM trusted_devices
             WHERE user_id = ? AND id = ? AND EXISTS (
               SELECT 1 FROM users u
               WHERE u.id = ? AND (? IS NULL OR u.auth_epoch = ?)
             )`
          ).bind(userId, existing.id as string, userId, epochBind, epochBind),
          this.db.prepare(
            `INSERT INTO trusted_devices
               (id, user_id, name, fingerprint, public_key, status, credential_hash,
                created_at, updated_at, last_seen_ip, last_seen_location)
             SELECT ?, u.id, ?, ?, ?, 'pending', ?, ?, ?, ?, ?
             FROM users u
             WHERE u.id = ? AND (? IS NULL OR u.auth_epoch = ?)`
          ).bind(
            device.id,
            device.name,
            fingerprint,
            device.publicKey,
            credentialHash,
            device.createdAt,
            ts,
            device.lastSeenIp ?? null,
            device.lastSeenLocation ?? null,
            userId,
            epochBind,
            epochBind
          )
        ]);
        await assertExpectedEpoch();
        const registered = await this.getDevice(userId, device.id);
        if (!registered) throw new Error("auth_epoch_changed");
        return registered;
      }
      const nextStatus = mobileReset || keyChanged
        ? "pending"
        : (existing.status as TrustedDevice["status"]);
      const stmts = [
        this.db.prepare(
          `DELETE FROM trusted_devices
           WHERE user_id = ?
             AND id != ?
             AND (public_key = ? OR (fingerprint IS NOT NULL AND fingerprint = ?))
             AND EXISTS (
               SELECT 1 FROM users u
               WHERE u.id = ? AND (? IS NULL OR u.auth_epoch = ?)
             )`
        )
          .bind(
            userId,
            existing.id as string,
            device.publicKey,
            fingerprint,
            userId,
            epochBind,
            epochBind
          ),
        this.db.prepare(
          `UPDATE trusted_devices
           SET name = ?,
               fingerprint = COALESCE(?, fingerprint),
               public_key = ?,
               status = ?,
               credential_hash = COALESCE(?, credential_hash),
               updated_at = ?,
               last_seen_ip = ?,
               last_seen_location = ?
           WHERE id = ? AND user_id = ? AND EXISTS (
             SELECT 1 FROM users u
             WHERE u.id = ? AND (? IS NULL OR u.auth_epoch = ?)
           )`
        )
          .bind(
            device.name,
            fingerprint,
            device.publicKey,
            nextStatus,
            credentialHash ?? null,
            ts,
            device.lastSeenIp ?? null,
            device.lastSeenLocation ?? null,
            existing.id as string,
            userId,
            userId,
            epochBind,
            epochBind
          )
      ];
      if (mobileReset || keyChanged) {
        stmts.push(
          this.db.prepare(
            `DELETE FROM sessions
             WHERE user_id = ? AND device_id = ? AND EXISTS (
               SELECT 1 FROM users u
               WHERE u.id = ? AND (? IS NULL OR u.auth_epoch = ?)
             )`
          ).bind(userId, existing.id as string, userId, epochBind, epochBind),
          this.db.prepare(
            `DELETE FROM device_vault_keys
             WHERE user_id = ? AND device_id = ? AND EXISTS (
               SELECT 1 FROM users u
               WHERE u.id = ? AND (? IS NULL OR u.auth_epoch = ?)
             )`
          ).bind(userId, existing.id as string, userId, epochBind, epochBind)
        );
      }
      await this.db.batch(stmts);
      await assertExpectedEpoch();
      const registered = await this.getDevice(userId, existing.id as string);
      if (!registered) throw new Error("auth_epoch_changed");
      return registered;
    }

    const inserted = await this.db
      .prepare(
        `INSERT INTO trusted_devices
           (id, user_id, name, fingerprint, public_key, status, credential_hash,
            created_at, updated_at, last_seen_ip, last_seen_location)
         SELECT ?, u.id, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM users u
         WHERE u.id = ? AND (? IS NULL OR u.auth_epoch = ?)`
      )
      .bind(
        device.id,
        device.name,
        fingerprint,
        device.publicKey,
        device.status,
        credentialHash ?? null,
        device.createdAt,
        device.updatedAt,
        device.lastSeenIp ?? null,
        device.lastSeenLocation ?? null,
        userId,
        epochBind,
        epochBind
      )
      .run();
    if ((inserted.meta?.changes ?? 0) !== 1) throw new Error("auth_epoch_changed");
    await assertExpectedEpoch();

    return device;
  }

  async authenticateDevice(input: {
    userId: string;
    deviceId: string;
    credentialHash: string;
    fingerprint: string;
    publicKey: string;
  }): Promise<TrustedDevice | null> {
    const row = await this.db
      .prepare(
        `SELECT id, name, fingerprint, public_key, status, created_at, updated_at,
                last_seen_ip, last_seen_location
         FROM trusted_devices
         WHERE id = ? AND user_id = ? AND credential_hash = ?
           AND fingerprint = ? AND public_key = ?`
      )
      .bind(
        input.deviceId,
        input.userId,
        input.credentialHash,
        input.fingerprint,
        input.publicKey
      )
      .first<Record<string, unknown>>();
    return row ? this.rowToDevice(row) : null;
  }

  async getDevice(userId: string, deviceId: string): Promise<TrustedDevice | null> {
    const row = await this.db
      .prepare(
        `SELECT id, name, fingerprint, public_key, status, created_at, updated_at,
                last_seen_ip, last_seen_location
         FROM trusted_devices WHERE id = ? AND user_id = ?`
      )
      .bind(deviceId, userId)
      .first<Record<string, unknown>>();
    return row ? this.rowToDevice(row) : null;
  }

  async getDeviceOwnerUserId(deviceId: string): Promise<string | null> {
    const row = await this.db.prepare("SELECT user_id FROM trusted_devices WHERE id = ?")
      .bind(deviceId)
      .first<Record<string, unknown>>();
    return typeof row?.user_id === "string" ? row.user_id : null;
  }

  async listDevices(userId: string): Promise<TrustedDevice[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, name, fingerprint, public_key, status, created_at, updated_at, last_seen_ip, last_seen_location
         FROM trusted_devices WHERE user_id = ?`
      )
      .bind(userId)
      .all<Record<string, unknown>>();

    const devices = rows.results.map((row) => this.rowToDevice(row));

    const statusRank: Record<TrustedDevice["status"], number> = {
      approved: 0,
      pending: 1,
      revoked: 2,
      rejected: 3
    };
    const byPublicKey = new Map<string, TrustedDevice>();
    for (const device of devices) {
      const dedupeKey = device.fingerprint
        ? `fp:${device.fingerprint}`
        : `legacy:${device.name}:${device.createdAt.slice(0, 16)}`;
      const previous = byPublicKey.get(dedupeKey);
      if (!previous) {
        byPublicKey.set(dedupeKey, device);
        continue;
      }
      const previousRank = statusRank[previous.status];
      const currentRank = statusRank[device.status];
      if (
        currentRank < previousRank ||
        (currentRank === previousRank && device.updatedAt > previous.updatedAt)
      ) {
        byPublicKey.set(dedupeKey, device);
      }
    }

    return [...byPublicKey.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async approveDevice(userId: string, deviceId: string): Promise<void> {
    const ts = nowISO();
    const result = await this.db
      .prepare(
        `UPDATE trusted_devices SET status = 'approved', updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .bind(ts, deviceId, userId)
      .run();
    if ((result.meta?.changes ?? 0) === 0) {
      throw new Error("device_not_found");
    }
  }

  async rejectDevice(userId: string, deviceId: string): Promise<void> {
    if (!await this.getDevice(userId, deviceId)) throw new Error("device_not_found");
    const ts = nowISO();
    await this.db.batch([
      this.db.prepare(
        `UPDATE trusted_devices SET status = 'rejected', updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
        .bind(ts, deviceId, userId),
      this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND device_id = ?")
        .bind(userId, deviceId),
      this.db.prepare("DELETE FROM device_vault_keys WHERE user_id = ? AND device_id = ?")
        .bind(userId, deviceId)
    ]);
  }

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    if (!await this.getDevice(userId, deviceId)) throw new Error("device_not_found");
    const ts = nowISO();
    await this.db.batch([
      this.db.prepare(
        `UPDATE trusted_devices SET status = 'revoked', updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
        .bind(ts, deviceId, userId),
      this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND device_id = ?")
        .bind(userId, deviceId),
      this.db.prepare("DELETE FROM device_vault_keys WHERE user_id = ? AND device_id = ?")
        .bind(userId, deviceId)
    ]);
  }

  // ── Device Vault Keys ─────────────────────────────────────────────────────

  async saveDeviceVaultKey(
    userId: string,
    deviceId: string,
    packet: DeviceVaultKeyPacket
  ): Promise<void> {
    const ts = nowISO();
    await this.db
      .prepare(
        `INSERT INTO device_vault_keys (user_id, device_id, encrypted_blob, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, device_id) DO UPDATE SET
           encrypted_blob = excluded.encrypted_blob,
           created_at = excluded.created_at`
      )
      .bind(userId, deviceId, JSON.stringify(packet), ts)
      .run();
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  }

  async getDeviceVaultKey(userId: string, deviceId: string): Promise<DeviceVaultKeyPacket | null> {
    const row = await this.db
      .prepare("SELECT encrypted_blob FROM device_vault_keys WHERE user_id = ? AND device_id = ?")
      .bind(userId, deviceId)
      .first<Record<string, unknown>>();
    if (!row || typeof row.encrypted_blob !== "string") return null;

    const stored = row.encrypted_blob;
    try {
      const packet = deviceVaultKeyPacketSchema.safeParse(JSON.parse(stored));
      if (packet.success) return packet.data;
    } catch {
      // Pre-structured-packet rows contain raw base64url, not JSON.
    }

    const device = await this.getDevice(userId, deviceId);
    if (!device) return null;
    const migrated = convertLegacyDeviceVaultKeyPacket(stored, device);
    if (!migrated) return null;

    // Compare-and-swap the exact legacy value. This prevents a concurrent key
    // re-share from being overwritten by a stale migration read.
    const migratedWrite = await this.db
      .prepare(
        `UPDATE device_vault_keys
         SET encrypted_blob = ?, created_at = ?
         WHERE user_id = ? AND device_id = ? AND encrypted_blob = ?`
      )
      .bind(JSON.stringify(migrated), nowISO(), userId, deviceId, stored)
      .run();
    if ((migratedWrite.meta?.changes ?? 0) === 1) return migrated;

    // A concurrent writer won. Return only its strictly valid packet; never
    // overwrite it and never fall back to the stale legacy value.
    const current = await this.db
      .prepare("SELECT encrypted_blob FROM device_vault_keys WHERE user_id = ? AND device_id = ?")
      .bind(userId, deviceId)
      .first<Record<string, unknown>>();
    if (!current || typeof current.encrypted_blob !== "string") return null;
    try {
      const packet = deviceVaultKeyPacketSchema.safeParse(JSON.parse(current.encrypted_blob));
      return packet.success ? packet.data : null;
    } catch {
      return null;
    }
  }

  async approveDeviceWithVaultKey(
    userId: string,
    deviceId: string,
    packet: DeviceVaultKeyPacket
  ): Promise<void> {
    const ts = nowISO();
    const serialized = JSON.stringify(packet);
    await this.db.batch([
      // Write the packet only while the exact target remains pending. The
      // SELECT form prevents a stale route read from writing through a revoke.
      this.db.prepare(
        `INSERT INTO device_vault_keys (user_id, device_id, encrypted_blob, created_at)
         SELECT ?, d.id, ?, ?
         FROM trusted_devices d
         WHERE d.id = ? AND d.user_id = ? AND d.status = 'pending'
           AND d.public_key = ?
         ON CONFLICT(user_id, device_id) DO UPDATE SET
           encrypted_blob = excluded.encrypted_blob,
           created_at = excluded.created_at`
      ).bind(
        userId,
        serialized,
        ts,
        deviceId,
        userId,
        packet.recipientPublicKey
      ),
      // Approval is conditional on the exact packet existing in the same
      // transaction, so there is never an approved-without-key crash gap.
      this.db.prepare(
        `UPDATE trusted_devices
         SET status = 'approved', updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM device_vault_keys k
             WHERE k.user_id = ? AND k.device_id = ? AND k.encrypted_blob = ?
           )`
      ).bind(ts, deviceId, userId, userId, deviceId, serialized)
    ]);

    const [device, storedPacket] = await Promise.all([
      this.getDevice(userId, deviceId),
      this.getDeviceVaultKey(userId, deviceId)
    ]);
    if (
      device?.status !== "approved" ||
      !storedPacket ||
      JSON.stringify(storedPacket) !== serialized
    ) {
      throw new Error("device_approval_not_committed");
    }
  }

  // ── Row Mappers ────────────────────────────────────────────────────────────

  private rowToUser(row: Record<string, unknown>): StoredUser {
    return {
      id: row.id as string,
      email: row.email as string,
      opaqueRegistrationRecord: row.opaque_registration_record as string,
      publicKeyBundle: row.public_key_bundle as string,
      encryptedRecoveryPacket: parseJSON(row.encrypted_recovery_packet as string),
      serverRevision: row.server_revision as number,
      authEpoch: typeof row.auth_epoch === "number" ? row.auth_epoch : 0
    };
  }

  private rowToVaultItem(row: Record<string, unknown>): VaultItemCiphertext {
    return {
      id: row.id as string,
      ownerUserId: row.user_id as string,
      revision: row.revision as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      encryptedItemKey: parseJSON(row.encrypted_item_key as string),
      encryptedPayload: parseJSON(row.encrypted_payload as string),
      encryptedSearchTokens: parseJSON(row.encrypted_search_tokens as string)
    };
  }

  private rowToDevice(row: Record<string, unknown>): TrustedDevice {
    return {
      id: row.id as string,
      name: row.name as string,
      fingerprint: typeof row.fingerprint === "string" ? row.fingerprint : undefined,
      publicKey: row.public_key as string,
      status: row.status as TrustedDevice["status"],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      lastSeenIp: (row.last_seen_ip as string | null) ?? null,
      lastSeenLocation: (row.last_seen_location as string | null) ?? null
    };
  }
}
