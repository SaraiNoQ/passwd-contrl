/**
 * MobileCiphertextStore — adapter for local ciphertext caching.
 *
 * Stores encrypted item envelopes, server revision, item revisions,
 * last synced timestamp, and conflict markers.
 *
 * Security rules:
 * - Stores ONLY ciphertext, never plaintext.
 * - Stores revisions and sync metadata.
 * - Does NOT store master password, derived key, vault key, or plaintext items.
 */

import type { VaultItemCiphertext } from "@zero-vault/shared";

export interface StoredItem {
  itemId: string;
  ciphertext: VaultItemCiphertext;
  itemRevision: number;
  lastSyncedAt: string;
  hasConflict: boolean;
}

export interface MobileCiphertextStore {
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

/**
 * In-memory implementation for MVP.
 * Replace with SQLite (expo-sqlite) for production persistence.
 */
export class InMemoryCiphertextStore implements MobileCiphertextStore {
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
