import type {
  CiphertextEnvelope,
  ItemLevelSyncConflict,
  ItemLevelSyncPlan,
  ItemLevelSyncPullResponse,
  SyncPullResponse,
  SyncPushRequest,
  TrustedDevice,
  VaultItemCiphertext
} from "@zero-vault/shared";
import type {
  ItemLevelSyncPushResult,
  LoginSession,
  PushResult,
  RegistrationSession,
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
    encryptedRecoveryPacket: CiphertextEnvelope;
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
      serverRevision: 0
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
    const row = await this.db
      .prepare("SELECT * FROM registration_sessions WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();

    if (!row) return null;

    await this.db
      .prepare("DELETE FROM registration_sessions WHERE id = ?")
      .bind(id)
      .run();

    const expiresAt = new Date(row.expires_at as string);
    if (expiresAt <= new Date()) {
      return null;
    }

    return {
      id: row.id as string,
      email: row.email as string,
      registrationResponse: row.registration_response as string,
      expiresAt
    };
  }

  // ── Login Sessions ─────────────────────────────────────────────────────────

  async createLoginSession(input: Omit<LoginSession, "id">): Promise<LoginSession> {
    const id = generateId();
    const ts = nowISO();

    await this.db
      .prepare(
        `INSERT INTO login_sessions (id, user_id, server_login_state, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, input.userId, input.serverLoginState, input.expiresAt.toISOString(), ts)
      .run();

    return { ...input, id };
  }

  async consumeLoginSession(id: string): Promise<LoginSession | null> {
    const row = await this.db
      .prepare("SELECT * FROM login_sessions WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();

    if (!row) return null;

    await this.db
      .prepare("DELETE FROM login_sessions WHERE id = ?")
      .bind(id)
      .run();

    const expiresAt = new Date(row.expires_at as string);
    if (expiresAt <= new Date()) {
      return null;
    }

    return {
      id: row.id as string,
      userId: row.user_id as string,
      serverLoginState: row.server_login_state as string,
      expiresAt
    };
  }

  // ── Auth Sessions ──────────────────────────────────────────────────────────

  async createSession(input: Omit<StoredSession, "id">): Promise<StoredSession> {
    const id = generateId();
    const ts = nowISO();

    await this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id, input.userId, input.tokenHash, input.csrfToken, input.expiresAt.toISOString(), ts)
      .run();

    return { ...input, id };
  }

  async findSessionByTokenHash(
    tokenHash: string
  ): Promise<(StoredSession & { user: StoredUser }) | null> {
    const row = await this.db
      .prepare(
        `SELECT
           s.id AS s_id, s.user_id, s.token_hash, s.csrf_token, s.expires_at AS s_expires_at,
           u.id AS u_id, u.email, u.opaque_registration_record, u.public_key_bundle,
           u.encrypted_recovery_packet, u.server_revision
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.token_hash = ?`
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
      expiresAt,
      user: {
        id: row.u_id as string,
        email: row.email as string,
        opaqueRegistrationRecord: row.opaque_registration_record as string,
        publicKeyBundle: row.public_key_bundle as string,
        encryptedRecoveryPacket: parseJSON(row.encrypted_recovery_packet as string),
        serverRevision: row.server_revision as number
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
  ): Promise<{ sessions: number; loginSessions: number; registrationSessions: number }> {
    const iso = now.toISOString();

    const sessResult = await this.db
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .bind(iso)
      .run();

    const loginResult = await this.db
      .prepare("DELETE FROM login_sessions WHERE expires_at <= ?")
      .bind(iso)
      .run();

    const regResult = await this.db
      .prepare("DELETE FROM registration_sessions WHERE expires_at <= ?")
      .bind(iso)
      .run();

    return {
      sessions: sessResult.meta?.changes ?? 0,
      loginSessions: loginResult.meta?.changes ?? 0,
      registrationSessions: regResult.meta?.changes ?? 0
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

    if (request.baseRevision !== user.serverRevision) {
      return { ok: false, error: "sync_conflict", serverRevision: user.serverRevision };
    }

    const nextRevision = user.serverRevision + 1;
    const ts = nowISO();

    // Build batch of statements
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmts: D1PreparedStatement[] = [];

    // Update user revision
    stmts.push(
      this.db
        .prepare("UPDATE users SET server_revision = ?, updated_at = ? WHERE id = ?")
        .bind(nextRevision, ts, userId)
    );

    // Upserts
    for (const item of request.upserts) {
      const nextItem: VaultItemCiphertext = {
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
               deleted_at = NULL`
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
    }

    // Deletes
    for (const id of request.deletes) {
      stmts.push(
        this.db
          .prepare(
            `UPDATE vault_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`
          )
          .bind(ts, ts, id, userId)
      );
    }

    await this.db.batch(stmts);

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
    const user = await this.findUserById(userId);
    if (!user) throw new Error("user_not_found");

    const conflicts: ItemLevelSyncConflict[] = [];
    const upsertedItemIds: string[] = [];
    const deletedItemIds: string[] = [];

    // Check server-level revision
    if (plan.baseRevision !== user.serverRevision) {
      for (const item of plan.upserts) {
        conflicts.push({
          itemId: item.id,
          operation: "upsert",
          reason: "server_revision_advanced",
          clientBaseRevision: plan.baseRevision,
          serverRevision: user.serverRevision
        });
      }
      for (const item of plan.deletes) {
        conflicts.push({
          itemId: item.id,
          operation: "delete",
          reason: "server_revision_advanced",
          clientBaseRevision: plan.baseRevision,
          serverRevision: user.serverRevision
        });
      }
      return {
        serverRevision: user.serverRevision,
        applied: { upsertedItemIds: [], deletedItemIds: [] },
        conflicts
      };
    }

    const nextRevision = user.serverRevision + 1;

    // Read current item revisions for conflict detection
    const currentItemRevisions = new Map<string, number>();
    if (plan.upserts.length > 0 || plan.deletes.length > 0) {
      const allItemIds = [
        ...plan.upserts.map((u) => u.id),
        ...plan.deletes.map((d) => d.id)
      ];
      const placeholders = allItemIds.map(() => "?").join(",");
      const rows = await this.db
        .prepare(
          `SELECT id, revision FROM vault_items WHERE id IN (${placeholders}) AND user_id = ?`
        )
        .bind(...allItemIds, userId)
        .all<Record<string, unknown>>();
      for (const r of rows.results) {
        currentItemRevisions.set(r.id as string, r.revision as number);
      }
    }

    // Process upserts
    const stmts: D1PreparedStatement[] = [];
    for (const item of plan.upserts) {
      if (item.ownerUserId !== userId) {
        throw new Error("item_owner_mismatch");
      }
      const currentItemRevision = currentItemRevisions.get(item.id) ?? 0;
      if (
        item.baseItemRevision !== undefined &&
        item.baseItemRevision < currentItemRevision
      ) {
        conflicts.push({
          itemId: item.id,
          operation: "upsert",
          reason: "item_revision_advanced",
          clientBaseRevision: item.baseItemRevision,
          serverRevision: user.serverRevision,
          serverItemRevision: currentItemRevision
        });
        continue;
      }

      const nextItem: VaultItemCiphertext = {
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
               deleted_at = NULL`
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

      upsertedItemIds.push(nextItem.id);
    }

    // Process deletes
    const ts = nowISO();
    for (const del of plan.deletes) {
      if (del.ownerUserId !== userId) {
        throw new Error("item_owner_mismatch");
      }
      const currentItemRevision = currentItemRevisions.get(del.id) ?? 0;
      if (
        del.baseItemRevision !== undefined &&
        del.baseItemRevision < currentItemRevision
      ) {
        conflicts.push({
          itemId: del.id,
          operation: "delete",
          reason: "item_revision_advanced",
          clientBaseRevision: del.baseItemRevision,
          serverRevision: user.serverRevision,
          serverItemRevision: currentItemRevision
        });
        continue;
      }

      stmts.push(
        this.db
          .prepare(
            `UPDATE vault_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`
          )
          .bind(ts, ts, del.id, userId)
      );
      deletedItemIds.push(del.id);
    }

    // Only advance revision if there were successful operations
    const serverRevision = upsertedItemIds.length > 0 || deletedItemIds.length > 0
      ? nextRevision
      : user.serverRevision;

    if (upsertedItemIds.length > 0 || deletedItemIds.length > 0) {
      stmts.push(
        this.db
          .prepare("UPDATE users SET server_revision = ?, updated_at = ? WHERE id = ?")
          .bind(serverRevision, ts, userId)
      );
    }

    if (stmts.length > 0) {
      await this.db.batch(stmts);
    }

    return {
      serverRevision,
      applied: { upsertedItemIds, deletedItemIds },
      conflicts
    };
  }

  async pullItemLevelSync(userId: string): Promise<ItemLevelSyncPullResponse> {
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

  async saveRecoveryPacket(userId: string, packet: CiphertextEnvelope): Promise<void> {
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

  async getRecoveryPacket(userId: string): Promise<CiphertextEnvelope | null> {
    // Check the dedicated recovery_packets table first (written by rotateRecoveryPacket)
    const row = await this.db
      .prepare("SELECT encrypted_recovery_packet FROM recovery_packets WHERE user_id = ?")
      .bind(userId)
      .first<Record<string, unknown>>();
    if (row) {
      return parseJSON<CiphertextEnvelope>(row.encrypted_recovery_packet as string);
    }
    // Fall back to the initial packet stored in the users table during registration
    const user = await this.findUserById(userId);
    return user?.encryptedRecoveryPacket ?? null;
  }

  async rotateRecoveryPacket(userId: string, packet: CiphertextEnvelope): Promise<void> {
    await this.saveRecoveryPacket(userId, packet);
  }

  // ── Trusted Devices ────────────────────────────────────────────────────────

  async registerDevice(userId: string, device: TrustedDevice): Promise<void> {
    const ts = nowISO();
    await this.db
      .prepare(
        `INSERT INTO trusted_devices (id, user_id, name, public_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        device.id,
        userId,
        device.name,
        device.publicKey,
        device.status,
        device.createdAt,
        device.updatedAt
      )
      .run();
  }

  async listDevices(userId: string): Promise<TrustedDevice[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, name, public_key, status, created_at, updated_at
         FROM trusted_devices WHERE user_id = ?`
      )
      .bind(userId)
      .all<Record<string, unknown>>();

    return rows.results.map(
      (r): TrustedDevice => ({
        id: r.id as string,
        name: r.name as string,
        publicKey: r.public_key as string,
        status: r.status as TrustedDevice["status"],
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string
      })
    );
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
    const ts = nowISO();
    const result = await this.db
      .prepare(
        `UPDATE trusted_devices SET status = 'rejected', updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .bind(ts, deviceId, userId)
      .run();
    if ((result.meta?.changes ?? 0) === 0) {
      throw new Error("device_not_found");
    }
  }

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    const ts = nowISO();
    const result = await this.db
      .prepare(
        `UPDATE trusted_devices SET status = 'revoked', updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .bind(ts, deviceId, userId)
      .run();
    if ((result.meta?.changes ?? 0) === 0) {
      throw new Error("device_not_found");
    }
  }

  // ── Device Vault Keys ─────────────────────────────────────────────────────

  async saveDeviceVaultKey(userId: string, deviceId: string, encryptedBlob: string): Promise<void> {
    const ts = nowISO();
    await this.db
      .prepare(
        `INSERT INTO device_vault_keys (user_id, device_id, encrypted_blob, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, device_id) DO UPDATE SET
           encrypted_blob = excluded.encrypted_blob,
           created_at = excluded.created_at`
      )
      .bind(userId, deviceId, encryptedBlob, ts)
      .run();
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  }

  async getDeviceVaultKey(userId: string, deviceId: string): Promise<string | null> {
    const row = await this.db
      .prepare("SELECT encrypted_blob FROM device_vault_keys WHERE user_id = ? AND device_id = ?")
      .bind(userId, deviceId)
      .first<Record<string, unknown>>();
    return row ? (row.encrypted_blob as string) : null;
  }

  // ── Row Mappers ────────────────────────────────────────────────────────────

  private rowToUser(row: Record<string, unknown>): StoredUser {
    return {
      id: row.id as string,
      email: row.email as string,
      opaqueRegistrationRecord: row.opaque_registration_record as string,
      publicKeyBundle: row.public_key_bundle as string,
      encryptedRecoveryPacket: parseJSON(row.encrypted_recovery_packet as string),
      serverRevision: row.server_revision as number
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
}
