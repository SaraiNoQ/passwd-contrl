/**
 * DesktopCiphertextStore — adapter for local ciphertext caching via Tauri + SQLite.
 *
 * Stores encrypted item envelopes, server revision, item revisions,
 * last synced timestamp, and conflict markers.
 *
 * Security rules:
 * - Stores ONLY ciphertext, never plaintext.
 * - Stores revisions and sync metadata.
 * - Does NOT store master password, derived key, vault key, or plaintext items.
 */

import { invoke } from "@tauri-apps/api/core";
import type { VaultItemCiphertext } from "@zero-vault/shared";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StoredItem {
  itemId: string;
  ciphertext: VaultItemCiphertext;
  itemRevision: number;
  lastSyncedAt: string;
  hasConflict: boolean;
  conflictServerItemRevision: number | undefined;
}

export interface DesktopCiphertextStore {
  getAll(): Promise<StoredItem[]>;
  getById(itemId: string): Promise<StoredItem | null>;
  upsert(item: StoredItem): Promise<void>;
  delete(itemId: string): Promise<void>;
  getServerRevision(): Promise<number>;
  setServerRevision(revision: number): Promise<void>;
  getLastSyncedAt(): Promise<string | null>;
  setLastSyncedAt(timestamp: string): Promise<void>;
  getConflictIds(): Promise<Set<string>>;
  setConflictIds(ids: Set<string>): Promise<void>;
  clear(): Promise<void>;
}

// ── Wire types ───────────────────────────────────────────────────────────────

/** Shape returned by the Rust `db_get_all_ciphertext` / `db_get_ciphertext_by_id` commands. */
interface StoredItemRow {
  item_id: string;
  ciphertext_json: string;
  item_revision: number;
  last_synced_at: string;
  has_conflict: boolean;
  conflict_server_item_revision: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rowToStoredItem(row: StoredItemRow): StoredItem {
  return {
    itemId: row.item_id,
    ciphertext: JSON.parse(row.ciphertext_json) as VaultItemCiphertext,
    itemRevision: row.item_revision,
    lastSyncedAt: row.last_synced_at,
    hasConflict: row.has_conflict,
    conflictServerItemRevision: row.conflict_server_item_revision ?? undefined,
  };
}

// ── Production implementation ────────────────────────────────────────────────

/**
 * Production store backed by SQLite via Tauri IPC.
 *
 * Delegates all persistence to the Rust `db_*` commands registered in main.rs.
 * The ciphertext JSON is stored as a TEXT column; the TypeScript side
 * serializes/deserializes the `VaultItemCiphertext` object on read/write.
 */
export class SqliteCiphertextStore implements DesktopCiphertextStore {
  async getAll(): Promise<StoredItem[]> {
    const rows = await invoke<StoredItemRow[]>("db_get_all_ciphertext");
    return rows.map(rowToStoredItem);
  }

  async getById(itemId: string): Promise<StoredItem | null> {
    const row = await invoke<StoredItemRow | null>("db_get_ciphertext_by_id", {
      itemId,
    });
    return row ? rowToStoredItem(row) : null;
  }

  async upsert(item: StoredItem): Promise<void> {
    await invoke<void>("db_upsert_ciphertext", {
      itemId: item.itemId,
      ciphertextJson: JSON.stringify(item.ciphertext),
      itemRevision: item.itemRevision,
      lastSyncedAt: item.lastSyncedAt,
      hasConflict: item.hasConflict,
      conflictServerItemRevision: item.conflictServerItemRevision ?? null,
    });
  }

  async delete(itemId: string): Promise<void> {
    await invoke<void>("db_delete_ciphertext", { itemId });
  }

  async getServerRevision(): Promise<number> {
    return invoke<number>("db_get_server_revision");
  }

  async setServerRevision(revision: number): Promise<void> {
    await invoke<void>("db_set_server_revision", { revision });
  }

  async getLastSyncedAt(): Promise<string | null> {
    return invoke<string | null>("db_get_last_synced_at");
  }

  async setLastSyncedAt(timestamp: string): Promise<void> {
    await invoke<void>("db_set_last_synced_at", { timestamp });
  }

  async getConflictIds(): Promise<Set<string>> {
    const ids = await invoke<string[]>("db_get_conflict_ids");
    return new Set(ids);
  }

  async setConflictIds(ids: Set<string>): Promise<void> {
    await invoke<void>("db_set_conflict_ids", {
      ids: Array.from(ids),
    });
  }

  async clear(): Promise<void> {
    await invoke<void>("db_clear");
  }
}

// ── In-memory implementation ─────────────────────────────────────────────────

/**
 * In-memory implementation for testing.
 * Map-based, same pattern as the mobile InMemoryCiphertextStore.
 */
export class InMemoryCiphertextStore implements DesktopCiphertextStore {
  private items = new Map<string, StoredItem>();
  private serverRevision = 0;
  private lastSyncedAt: string | null = null;
  private conflictIds = new Set<string>();

  async getAll(): Promise<StoredItem[]> {
    return Array.from(this.items.values());
  }

  async getById(itemId: string): Promise<StoredItem | null> {
    return this.items.get(itemId) ?? null;
  }

  async upsert(item: StoredItem): Promise<void> {
    this.items.set(item.itemId, item);
  }

  async delete(itemId: string): Promise<void> {
    this.items.delete(itemId);
  }

  async getServerRevision(): Promise<number> {
    return this.serverRevision;
  }

  async setServerRevision(revision: number): Promise<void> {
    this.serverRevision = revision;
  }

  async getLastSyncedAt(): Promise<string | null> {
    return this.lastSyncedAt;
  }

  async setLastSyncedAt(timestamp: string): Promise<void> {
    this.lastSyncedAt = timestamp;
  }

  async getConflictIds(): Promise<Set<string>> {
    return new Set(this.conflictIds);
  }

  async setConflictIds(ids: Set<string>): Promise<void> {
    this.conflictIds = new Set(ids);
  }

  async clear(): Promise<void> {
    this.items.clear();
    this.serverRevision = 0;
    this.lastSyncedAt = null;
    this.conflictIds.clear();
  }
}
