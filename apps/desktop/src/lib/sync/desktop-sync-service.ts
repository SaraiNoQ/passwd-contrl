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
  VaultItem,
  ItemLevelEncryptedUpsert,
} from "@zero-vault/shared";
import type { DesktopApiClient } from "../api/desktop-api-client";
import type {
  DesktopCiphertextStore,
  StoredItem,
} from "../storage/desktop-ciphertext-store";
import type { DesktopCryptoAdapter } from "../crypto/desktop-crypto-adapter";
import { generateSearchTokens } from "../search-tokens";

// ── Public types ──────────────────────────────────────────────────────────────

export interface SyncResult {
  pulled: number;
  conflicts: string[];
  serverRevision: number;
}

export interface ResolveConflictOptions {
  localItem: VaultItem;
  vaultKey: Uint8Array;
  csrfToken: string;
  ownerUserId: string;
}

export interface ResolveConflictResult {
  clonedItemId?: string;
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
    options: ResolveConflictOptions,
  ): Promise<ResolveConflictResult>;
}

// ── Implementation ────────────────────────────────────────────────────────────

/** Per-session counter: tracks consecutive keep_local failures per itemId.
 *  After 3 failures, resolveKeepLocal will escalate to create_copy automatically. */
const KEEP_LOCAL_RETRY_LIMIT = 3;
const keepLocalAttempts = new Map<string, number>();

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

  async resolveConflict(
    itemId: string,
    strategy: "keep_local" | "accept_remote" | "create_copy" | "skip",
    options: ResolveConflictOptions,
  ): Promise<ResolveConflictResult> {
    if (strategy === "skip") {
      return {};
    }

    if (strategy === "accept_remote") {
      return this.clearConflictMarker(itemId);
    }

    if (strategy === "keep_local") {
      return this.resolveKeepLocal(itemId, options);
    }

    return this.resolveCreateCopy(itemId, options);
  }

  private async clearConflictMarker(itemId: string): Promise<ResolveConflictResult> {
    const conflicts = await this.ciphertextStore.getConflictIds();
    conflicts.delete(itemId);
    await this.ciphertextStore.setConflictIds(conflicts);

    const stored = await this.ciphertextStore.getById(itemId);
    if (stored) {
      await this.ciphertextStore.upsert({
        ...stored,
        hasConflict: false,
        conflictServerItemRevision: undefined,
      });
    }
    return {};
  }

  private async resolveKeepLocal(
    itemId: string,
    options: ResolveConflictOptions,
  ): Promise<ResolveConflictResult> {
    const stored = await this.ciphertextStore.getById(itemId);
    if (!stored) {
      return this.clearConflictMarker(itemId);
    }

    const { localItem, vaultKey, csrfToken, ownerUserId } = options;
    const now = new Date().toISOString();
    const encrypted = await this._cryptoAdapter.encryptItem(vaultKey, localItem, itemId);
    const serverItemRevision =
      stored.conflictServerItemRevision ?? stored.itemRevision;
    const baseRevision = await this.ciphertextStore.getServerRevision();

    const upsert: ItemLevelEncryptedUpsert = {
      id: itemId,
      ownerUserId,
      revision: serverItemRevision + 1,
      createdAt: stored.ciphertext.createdAt,
      updatedAt: now,
      encryptedItemKey: encrypted.encryptedItemKey,
      encryptedPayload: encrypted.encryptedPayload,
      encryptedSearchTokens: await generateSearchTokens(vaultKey, localItem),
      baseItemRevision: serverItemRevision,
    };

    const response = await this.pushSync(csrfToken, {
      protocol: "item_level_v1",
      baseRevision,
      upserts: [upsert],
      deletes: [],
    });

    if (response.conflicts.length > 0) {
      // Increment retry counter for this item
      const attempts = (keepLocalAttempts.get(itemId) ?? 0) + 1;
      keepLocalAttempts.set(itemId, attempts);

      // After KEEP_LOCAL_RETRY_LIMIT consecutive failures, escalate to create_copy
      if (attempts >= KEEP_LOCAL_RETRY_LIMIT) {
        keepLocalAttempts.delete(itemId);
        return this.resolveCreateCopy(itemId, options);
      }

      const conflictIds = await this.ciphertextStore.getConflictIds();
      for (const conflict of response.conflicts) {
        conflictIds.add(conflict.itemId);
      }
      await this.ciphertextStore.setConflictIds(conflictIds);
      await this.ciphertextStore.setServerRevision(response.serverRevision);

      const newServerItemRevision = response.conflicts.find(
        (c) => c.itemId === itemId,
      )?.serverItemRevision;
      await this.ciphertextStore.upsert({
        ...stored,
        ciphertext: { ...upsert, revision: serverItemRevision },
        itemRevision: serverItemRevision,
        lastSyncedAt: now,
        hasConflict: true,
        conflictServerItemRevision: newServerItemRevision ?? serverItemRevision,
      });
      return {};
    }

    // On success, clear the retry counter
    keepLocalAttempts.delete(itemId);

    const storedRevision = response.applied.upsertedItemIds.includes(itemId)
      ? response.serverRevision
      : serverItemRevision + 1;
    await this.ciphertextStore.upsert({
      ...stored,
      ciphertext: {
        ...upsert,
        revision: storedRevision,
      },
      itemRevision: storedRevision,
      lastSyncedAt: now,
      hasConflict: false,
      conflictServerItemRevision: undefined,
    });
    await this.ciphertextStore.setServerRevision(response.serverRevision);
    return {};
  }

  private async resolveCreateCopy(
    itemId: string,
    options: ResolveConflictOptions,
  ): Promise<ResolveConflictResult> {
    const { localItem, vaultKey, csrfToken, ownerUserId } = options;
    const clonedItemId = crypto.randomUUID();
    const now = new Date().toISOString();
    const clonedItem = {
      ...localItem,
      id: clonedItemId,
      title: `${localItem.title} (副本)`,
      createdAt: now,
      updatedAt: now,
    };
    const encrypted = await this._cryptoAdapter.encryptItem(
      vaultKey,
      clonedItem,
      clonedItemId,
    );
    const baseRevision = await this.ciphertextStore.getServerRevision();

    const upsert: ItemLevelEncryptedUpsert = {
      id: clonedItemId,
      ownerUserId,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      encryptedItemKey: encrypted.encryptedItemKey,
      encryptedPayload: encrypted.encryptedPayload,
      encryptedSearchTokens: [],
      baseItemRevision: 0,
    };

    const response = await this.pushSync(csrfToken, {
      protocol: "item_level_v1",
      baseRevision,
      upserts: [upsert],
      deletes: [],
    });

    const stored = await this.ciphertextStore.getById(itemId);
    if (stored) {
      await this.ciphertextStore.upsert({
        ...stored,
        hasConflict: false,
        conflictServerItemRevision: undefined,
      });
    }

    const conflicts = await this.ciphertextStore.getConflictIds();
    conflicts.delete(itemId);

    if (response.conflicts.length > 0) {
      for (const conflict of response.conflicts) {
        conflicts.add(conflict.itemId);
      }
    }
    await this.ciphertextStore.setConflictIds(conflicts);
    await this.ciphertextStore.setServerRevision(response.serverRevision);

    if (response.conflicts.length === 0) {
      const storedRevision = response.applied.upsertedItemIds.includes(
        clonedItemId,
      )
        ? response.serverRevision
        : 1;
      await this.ciphertextStore.upsert({
        itemId: clonedItemId,
        ciphertext: { ...upsert, revision: storedRevision },
        itemRevision: storedRevision,
        lastSyncedAt: now,
        hasConflict: false,
        conflictServerItemRevision: undefined,
      });
    }

    return { clonedItemId };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async processPullResponse(
    response: ItemLevelSyncPullResponse,
  ): Promise<SyncResult> {
    const now = new Date().toISOString();

    // Store each item's ciphertext
    for (const item of response.items) {
      const stored: StoredItem = {
        itemId: item.id,
        ciphertext: item,
        itemRevision: item.revision,
        lastSyncedAt: now,
        hasConflict: false,
        conflictServerItemRevision: undefined,
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

    // Preserve existing conflict markers from local store
    const existingConflicts = await this.ciphertextStore.getConflictIds();
    await this.ciphertextStore.setConflictIds(existingConflicts);

    return {
      pulled: response.items.length,
      conflicts: Array.from(existingConflicts),
      serverRevision: response.serverRevision,
    };
  }
}
