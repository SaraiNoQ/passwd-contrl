/**
 * Desktop sync service — orchestrates item-level sync for the desktop app.
 *
 * Pull flow:
 * 1. Fetch ciphertext from server via DesktopApiClient.
 * 2. Store ciphertext in DesktopCiphertextStore.
 * 3. Track conflict IDs returned by the server.
 *
 * Push flow:
 * 1. Delegate to DesktopApiClient.pushItemLevelSync.
 * 2. Return the raw server response for the caller to inspect conflicts.
 *
 * Conflict resolution (MVP):
 * - Conflict markers are removed from the local store on explicit user action.
 * - Full merge/re-encrypt is deferred to a future release.
 */

import type {
  ItemLevelSyncPullResponse,
  ItemLevelSyncPlan,
  ItemLevelSyncResponse,
  VaultItemCiphertext,
} from "@zero-vault/shared";
import type { DesktopApiClient } from "../api/desktop-api-client";
import type {
  DesktopCiphertextStore,
  StoredItem,
} from "../storage/desktop-ciphertext-store";
import type { DesktopCryptoAdapter } from "../crypto/desktop-crypto-adapter";

// ── Public types ──────────────────────────────────────────────────────────────

export interface SyncResult {
  pulled: number;
  conflicts: string[];
  serverRevision: number;
}

export interface DesktopSyncService {
  pullAll(currentRevision?: number): Promise<SyncResult>;
  pushSync(
    csrfToken: string,
    plan: ItemLevelSyncPlan,
  ): Promise<ItemLevelSyncResponse>;
  resolveConflict(
    itemId: string,
    strategy: "keep_local" | "accept_remote" | "create_copy" | "skip",
  ): Promise<void>;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class DesktopSyncServiceImpl implements DesktopSyncService {
  constructor(
    private apiClient: DesktopApiClient,
    private ciphertextStore: DesktopCiphertextStore,
    private _cryptoAdapter: DesktopCryptoAdapter,
  ) {}

  /**
   * Pull all items newer than the current server revision.
   * Stores ciphertext locally and returns a summary.
   */
  async pullAll(currentRevision?: number): Promise<SyncResult> {
    const revision =
      currentRevision ?? (await this.ciphertextStore.getServerRevision());

    const response = await this.apiClient.pullItems(
      revision > 0 ? revision : undefined,
    );

    return this.processPullResponse(response);
  }

  /**
   * Push an item-level sync plan to the server.
   * Returns the raw response so the caller can inspect conflicts.
   */
  async pushSync(
    csrfToken: string,
    plan: ItemLevelSyncPlan,
  ): Promise<ItemLevelSyncResponse> {
    return this.apiClient.pushItemLevelSync(csrfToken, plan);
  }

  /**
   * Resolve a single conflict by removing its conflict marker.
   *
   * MVP strategy:
   * - "keep_local" / "skip": remove conflict marker (local ciphertext is kept).
   * - "accept_remote": remove conflict marker (remote was already stored on pull).
   * - "create_copy": remove conflict marker (caller is responsible for creating
   *   a new item via pushSync).
   */
  async resolveConflict(
    itemId: string,
    strategy: "keep_local" | "accept_remote" | "create_copy" | "skip",
  ): Promise<void> {
    if (strategy === "skip") {
      return;
    }

    const conflicts = await this.ciphertextStore.getConflictIds();
    conflicts.delete(itemId);
    await this.ciphertextStore.setConflictIds(conflicts);

    // Clear the hasConflict flag on the stored item if it exists.
    const stored = await this.ciphertextStore.getById(itemId);
    if (stored) {
      await this.ciphertextStore.upsert({ ...stored, hasConflict: false });
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async processPullResponse(
    response: ItemLevelSyncPullResponse,
  ): Promise<SyncResult> {
    const now = new Date().toISOString();
    const conflictIds: string[] = [];

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

    // Remove deleted items
    for (const deletedId of response.deletedItemIds) {
      await this.ciphertextStore.delete(deletedId);
    }

    // Update sync metadata
    await this.ciphertextStore.setServerRevision(response.serverRevision);
    await this.ciphertextStore.setLastSyncedAt(now);

    // Merge any existing conflict IDs with new ones
    const existingConflicts = await this.ciphertextStore.getConflictIds();
    for (const id of conflictIds) {
      existingConflicts.add(id);
    }
    await this.ciphertextStore.setConflictIds(existingConflicts);

    return {
      pulled: response.items.length,
      conflicts: Array.from(existingConflicts),
      serverRevision: response.serverRevision,
    };
  }
}
