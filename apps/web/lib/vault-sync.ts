/**
 * Pure sync-related vault operations.
 * Each function accepts dependencies as parameters and returns a result object.
 * No React hooks or state management — that stays in vault-provider.tsx.
 */
import {
  pullVault,
  pushItemLevelSync,
  pushVault
} from "./api-client";
import {
  addCredential,
  persistUnlockedVault,
  saveEncryptedLocalVault,
  unlockLocalVaultWithRecoveredKey,
  type EncryptedLocalVault,
  type UnlockedVault,
  type VaultItem
} from "./local-vault";
import { isLogin } from "./item-types";
import {
  encryptedVaultToSyncRequest,
  getSyncedLocalVaultItem,
  loadLocalServerRevision,
  saveLocalServerRevision,
  syncItemToEncryptedVault,
  mergeRemoteItems,
  performItemLevelSync,
  loadItemRevisionMap,
  saveItemRevisionMap,
  loadConflictIds,
  saveConflictIds
} from "./sync-vault";
import {
  buildItemLevelSyncPlan,
  extractConflicts,
  type ItemSyncInfo
} from "./item-sync";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ItemConflict = {
  itemId: string;
  reason: string;
  localRevision: number | undefined;
  serverRevision: number | undefined;
};

export type SyncResult =
  | { status: "no-local-vault" }
  | { status: "not-logged-in" }
  | {
      status: "merged";
      serverRevision: number;
      mergedVault: { encrypted: EncryptedLocalVault; unlocked: UnlockedVault };
    }
  | {
      status: "item-synced";
      serverRevision: number;
      itemInfos: ItemSyncInfo[];
      appliedCount: number;
    }
  | {
      status: "restored-from-cloud";
      encrypted: EncryptedLocalVault;
      serverRevision: number;
    }
  | {
      status: "conflicts";
      conflicts: ItemConflict[];
      itemInfos: ItemSyncInfo[];
    }
  | {
      status: "version-conflict";
      localRevision: number;
      remoteRevision: number;
    }
  | {
      status: "remote-vault-mismatch";
      failedItemCount: number;
      canRestoreFromCloud: boolean;
    }
  | { status: "sync-conflict"; localRevision: number }
  | { status: "error"; message: string };

export type RestoreFromCloudResult =
  | {
      status: "restored";
      encrypted: EncryptedLocalVault;
      serverRevision: number;
    }
  | { status: "no-user" }
  | { status: "no-remote-vault" }
  | { status: "error"; message: string };

export type ConflictResolutionResult =
  | { status: "ok" }
  | { status: "still-conflicting"; message: string }
  | { status: "error"; message: string };

export type AcceptRemoteResult =
  | {
      status: "ok";
      mergedVault: { encrypted: EncryptedLocalVault; unlocked: UnlockedVault };
    }
  | { status: "not-found" }
  | { status: "error"; message: string };

export type CreateCopyResult =
  | {
      status: "ok";
      copiedVault: { encrypted: EncryptedLocalVault; unlocked: UnlockedVault };
    }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Perform a full sync cycle: pull remote, merge, item-level sync, or legacy push.
 */
export async function performSync(deps: {
  encryptedVault: EncryptedLocalVault | null;
  unlockedVault: UnlockedVault | null;
  user: { id: string; serverRevision: number };
  csrfToken: string;
}): Promise<SyncResult> {
  const { encryptedVault, unlockedVault, user, csrfToken } = deps;

  if (!encryptedVault) {
    return { status: "no-local-vault" };
  }
  if (!user || !csrfToken) {
    return { status: "not-logged-in" };
  }

  try {
    const remote = await pullVault();
    const syncedLocalVaultItem = getSyncedLocalVaultItem(remote.items);
    const baseRevision = loadLocalServerRevision();

    // Merge remote items into unlocked vault if available
    let mergedVault:
      | { encrypted: EncryptedLocalVault; unlocked: UnlockedVault }
      | undefined;
    if (unlockedVault && remote.items.length > 0) {
      const { vault: merged, failedItemIds } = await mergeRemoteItems(
        unlockedVault,
        remote.items
      );
      if (failedItemIds.length > 0) {
        const localItemCount = unlockedVault.snapshot.items.length;
        if (localItemCount === 0 && syncedLocalVaultItem !== null) {
          const restored = syncItemToEncryptedVault(syncedLocalVaultItem);
          saveEncryptedLocalVault(restored);
          saveLocalServerRevision(remote.serverRevision);
          return {
            status: "restored-from-cloud",
            encrypted: restored,
            serverRevision: remote.serverRevision
          };
        }
        return {
          status: "remote-vault-mismatch",
          failedItemCount: failedItemIds.length,
          canRestoreFromCloud: syncedLocalVaultItem !== null
        };
      }
      const persisted = await persistUnlockedVault(merged);
      mergedVault = { encrypted: persisted.encrypted, unlocked: persisted.unlocked };
    }

    // Try item-level sync first
    const activeVault = mergedVault?.unlocked ?? unlockedVault;
    if (activeVault) {
      try {
        const result = await performItemLevelSync(
          activeVault,
          user.id,
          (plan) => pushItemLevelSync(csrfToken, plan)
        );

        if (result.protocol === "item_level_v1") {
          if (result.hasConflicts) {
            const conflicts = extractConflicts(result.response);
            return {
              status: "conflicts",
              conflicts: conflicts.map((c) => ({
                itemId: c.itemId,
                reason: c.reason,
                localRevision: c.clientBaseRevision,
                serverRevision: c.serverItemRevision
              })),
              itemInfos: result.itemInfos
            };
          }

          const appliedCount =
            result.response.applied.upsertedItemIds.length +
            result.response.applied.deletedItemIds.length;
          let serverRevision = result.response.serverRevision;
          const activeEncryptedVault = mergedVault?.encrypted ?? encryptedVault;
          if (appliedCount > 0 || syncedLocalVaultItem === null) {
            try {
              const legacyResult = await pushVault(
                csrfToken,
                encryptedVaultToSyncRequest(activeEncryptedVault, user.id, serverRevision)
              );
              serverRevision = legacyResult.serverRevision;
            } catch {
              // Legacy envelope push failed — item-level changes are already
              // committed on the server.  Keep the item-sync revision so the
              // next sync starts from a consistent baseline.
            }
          }
          saveLocalServerRevision(serverRevision);
          return {
            status: "item-synced",
            serverRevision,
            itemInfos: result.itemInfos,
            appliedCount
          };
        }
      } catch {
        // Item-level sync failed, fall through to legacy
      }
    }

    // Legacy envelope sync
    if (remote.serverRevision !== baseRevision) {
      return {
        status: "version-conflict",
        localRevision: baseRevision,
        remoteRevision: remote.serverRevision
      };
    }

    const result = await pushVault(
      csrfToken,
      encryptedVaultToSyncRequest(encryptedVault, user.id, baseRevision)
    );
    saveLocalServerRevision(result.serverRevision);

    if (mergedVault) {
      return {
        status: "merged",
        serverRevision: result.serverRevision,
        mergedVault
      };
    }

    return { status: "item-synced", serverRevision: result.serverRevision, itemInfos: [], appliedCount: 0 };
  } catch (syncError) {
    const message =
      syncError instanceof Error ? syncError.message : "sync_failed";
    if (message === "sync_conflict") {
      return {
        status: "sync-conflict",
        localRevision: loadLocalServerRevision()
      };
    }
    return { status: "error", message };
  }
}

// ---------------------------------------------------------------------------
// Restore from cloud
// ---------------------------------------------------------------------------

/**
 * Pull the encrypted vault from the server and restore it locally.
 */
export async function handleRestoreFromCloud(deps: {
  user: { id: string; email: string; serverRevision: number } | null;
}): Promise<RestoreFromCloudResult> {
  const { user } = deps;

  if (!user) {
    return { status: "no-user" };
  }

  try {
    const remote = await pullVault();
    const syncedItem = getSyncedLocalVaultItem(remote.items);
    if (!syncedItem) {
      return { status: "no-remote-vault" };
    }
    const restored = syncItemToEncryptedVault(syncedItem);
    saveEncryptedLocalVault(restored);
    saveLocalServerRevision(remote.serverRevision);
    return {
      status: "restored",
      encrypted: restored,
      serverRevision: remote.serverRevision
    };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "恢复失败。"
    };
  }
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

/**
 * Re-push a local item to the server to resolve a conflict.
 */
export async function handleResolveKeepLocal(deps: {
  unlockedVault: UnlockedVault;
  user: { id: string };
  csrfToken: string;
  itemId: string;
}): Promise<ConflictResolutionResult> {
  const { unlockedVault, user, csrfToken, itemId } = deps;

  const item = unlockedVault.snapshot.items.find((i) => i.id === itemId);
  if (!item) return { status: "error", message: "条目未找到。" };

  try {
    let remoteItemRevision: number | undefined;
    let baseServerRevision: number;
    try {
      const remote = await pullVault();
      const remoteItem = remote.items.find((i) => i.id === itemId);
      remoteItemRevision = remoteItem?.revision;
      baseServerRevision = remote.serverRevision;
    } catch {
      remoteItemRevision = undefined;
      baseServerRevision = loadLocalServerRevision();
    }
    const revisionMap = loadItemRevisionMap();
    const baseItemRevision = remoteItemRevision ?? revisionMap[itemId] ?? 0;
    const { plan } = await buildItemLevelSyncPlan(
      {
        ...unlockedVault,
        snapshot: { ...unlockedVault.snapshot, items: [item] }
      },
      user.id,
      { [itemId]: baseItemRevision },
      new Set(),
      baseServerRevision
    );
    const response = await pushItemLevelSync(csrfToken, plan);
    const conflicts = response.conflicts ?? [];
    if (conflicts.length === 0) {
      const updatedMap = { ...revisionMap, [itemId]: response.serverRevision };
      saveItemRevisionMap(updatedMap);
      saveLocalServerRevision(response.serverRevision);
      const conflictIds = loadConflictIds();
      conflictIds.delete(itemId);
      saveConflictIds(conflictIds);
      return { status: "ok" };
    }
    const conflict = conflicts[0];
    const serverRevisionText = conflict?.serverItemRevision ?? conflict?.serverRevision ?? "?";
    return {
      status: "still-conflicting",
      message: `服务器仍然报告 "${item.title}" 存在冲突，云端版本为 v${serverRevisionText}。请刷新后重试。`
    };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "重新推送失败。"
    };
  }
}

/**
 * Accept the remote version of an item, merging it into the local vault.
 */
export async function handleResolveAcceptRemote(deps: {
  unlockedVault: UnlockedVault;
  csrfToken: string;
  itemId: string;
}): Promise<AcceptRemoteResult> {
  const { unlockedVault, csrfToken, itemId } = deps;

  try {
    const remote = await pullVault();
    const remoteItem = remote.items.find((i) => i.id === itemId);
    if (!remoteItem) {
      return { status: "not-found" };
    }
    const { vault: merged, failedItemIds } = await mergeRemoteItems(unlockedVault, [
      remoteItem
    ]);
    if (failedItemIds.length > 0) {
      return {
        status: "error",
        message: "当前本地密码库无法解密云端版本。请先从云端恢复原密码库。"
      };
    }
    const persisted = await persistUnlockedVault(merged);

    const conflictIds = loadConflictIds();
    conflictIds.delete(itemId);
    saveConflictIds(conflictIds);

    return {
      status: "ok",
      mergedVault: { encrypted: persisted.encrypted, unlocked: persisted.unlocked }
    };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "接受远端版本失败。"
    };
  }
}

/**
 * Create a copy of a conflicting item.
 */
export async function handleResolveCreateCopy(deps: {
  unlockedVault: UnlockedVault;
  itemId: string;
}): Promise<CreateCopyResult> {
  const { unlockedVault, itemId } = deps;

  const item = unlockedVault.snapshot.items.find((i) => i.id === itemId);
  if (!item || !isLogin(item)) return { status: "error", message: "条目未找到。" };

  try {
    const copy = addCredential(unlockedVault, {
      title: `${item.title} (副本)`,
      origin: item.origin,
      username: item.username,
      password: item.password,
      notes: item.notes
    });
    const persisted = await persistUnlockedVault(copy);

    const conflictIds = loadConflictIds();
    conflictIds.delete(itemId);
    saveConflictIds(conflictIds);

    return {
      status: "ok",
      copiedVault: { encrypted: persisted.encrypted, unlocked: persisted.unlocked }
    };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "创建副本失败。"
    };
  }
}

/**
 * Skip a conflict — remove it from the conflict list.
 */
export function handleResolveSkip(itemId: string): void {
  const conflictIds = loadConflictIds();
  conflictIds.delete(itemId);
  saveConflictIds(conflictIds);
}
