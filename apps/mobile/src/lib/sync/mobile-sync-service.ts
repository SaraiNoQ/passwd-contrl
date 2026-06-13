/**
 * Mobile sync service — orchestrates item-level sync for mobile.
 *
 * Pull flow (MVP read-only):
 * 1. Fetch ciphertext from server via MobileApiClient.
 * 2. Store ciphertext in MobileCiphertextStore.
 * 3. Decrypt items in memory via MobileCryptoAdapter.
 * 4. Present plaintext in UI (never persisted).
 *
 * Push flow: NOT implemented in MVP. Conflicts are displayed
 * with a message to resolve on the Web Vault.
 */

import type { VaultItemCiphertext, ItemLevelSyncPullResponse } from "@zero-vault/shared";
import type { MobileApiClient } from "../api/mobile-api-client";
import type { MobileCiphertextStore, StoredItem } from "../storage/mobile-ciphertext-store";

export interface SyncResult {
  itemsStored: number;
  serverRevision: number;
  conflictCount: number;
  lastSyncedAt: string;
}

export class MobileSyncService {
  constructor(
    private apiClient: MobileApiClient,
    private ciphertextStore: MobileCiphertextStore
  ) {}

  /**
   * Pull all items from server and cache locally.
   * Returns the sync result with counts.
   */
  async pullAll(): Promise<SyncResult> {
    const currentRevision = await this.ciphertextStore.getServerRevision();
    const response = await this.apiClient.pullItems(currentRevision);

    return this.processPullResponse(response);
  }

  /**
   * Process a pull response: store ciphertext, update revision.
   */
  async processPullResponse(response: ItemLevelSyncPullResponse): Promise<SyncResult> {
    const now = new Date().toISOString();

    // Store each item's ciphertext
    for (const item of response.items) {
      const stored: StoredItem = {
        itemId: item.id,
        ciphertext: item,
        itemRevision: item.revision,
        lastSyncedAt: now,
        hasConflict: false,
      };
      await this.ciphertextStore.upsert(stored);
    }

    // Handle deleted items
    for (const deletedId of response.deletedItemIds) {
      await this.ciphertextStore.delete(deletedId);
    }

    // Update server revision
    await this.ciphertextStore.setServerRevision(response.serverRevision);
    await this.ciphertextStore.setLastSyncedAt(now);

    return {
      itemsStored: response.items.length,
      serverRevision: response.serverRevision,
      conflictCount: 0,
      lastSyncedAt: now,
    };
  }

  /**
   * Mark conflict items. Called when server returns 409.
   */
  async markConflicts(itemIds: string[]): Promise<void> {
    const conflicts = await this.ciphertextStore.getConflictIds();
    for (const id of itemIds) {
      conflicts.add(id);
    }
    await this.ciphertextStore.setConflictIds(conflicts);
  }
}
