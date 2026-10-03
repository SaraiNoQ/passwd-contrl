/**
 * Pure sync-related vault operations.
 * Each function accepts dependencies as parameters and returns a result object.
 * No React hooks or state management — that stays in vault-provider.tsx.
 */
import {
  pullVault,
  pullItemLevelSync,
  pushItemLevelSync,
  pushVault
} from "./api-client";
import {
  addCredential,
  deleteItem,
  persistUnlockedVault,
  saveEncryptedLocalVault,
  unlockLocalVaultWithRecoveredKey,
  decryptItemFromSync,
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
  loadPendingItemMutations,
  savePendingItemMutations,
  loadConflictIds,
  saveConflictIds,
  loadSyncedTimestamps, saveSyncedTimestamps, loadSyncCursor, saveSyncCursor
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
      mergedVault?: { encrypted: EncryptedLocalVault; unlocked: UnlockedVault };
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
      mergedVault?: { encrypted: EncryptedLocalVault; unlocked: UnlockedVault };
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
    if (unlockedVault?.runtime === "crypto-core-wasm") {
      return await performIncrementalSync(unlockedVault, user.id, csrfToken);
    }
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

/** Push durable local operations before pulling, so remote changes never erase edits. */
export async function performIncrementalSync(vault: UnlockedVault, userId: string, csrfToken: string): Promise<SyncResult> {
  const owner = window.localStorage.getItem("zero-vault.local.owner.v1");
  if (owner && owner !== userId) throw new Error("此浏览器密码库属于另一个账户，请使用另一个浏览器登录。");
  window.localStorage.setItem("zero-vault.local.owner.v1", userId);
  const { syncVault } = await import("@zero-vault/browser-vault/sync");
  const result = await syncVault(vault, userId, {
    cursor: loadSyncCursor(), serverRevision: loadLocalServerRevision(), revisions: loadItemRevisionMap(),
    timestamps: loadSyncedTimestamps(), pending: loadPendingItemMutations(), conflicts: [...loadConflictIds()]
  }, {
    push: plan => pushItemLevelSync(csrfToken, plan),
    pull: pullItemLevelSync,
    async commit(state, nextVault) {
      if (nextVault) await persistUnlockedVault(nextVault);
      saveItemRevisionMap(state.revisions); saveSyncedTimestamps(state.timestamps);
      savePendingItemMutations(state.pending); saveConflictIds(new Set(state.conflicts));
      saveLocalServerRevision(state.serverRevision); saveSyncCursor(state.cursor);
    }
  });
  const persisted = await persistUnlockedVault(result.vault);
  const itemInfos = result.vault.snapshot.items.map((item): ItemSyncInfo => ({ itemId: item.id, status: result.state.conflicts.includes(item.id) ? "conflict" : "synced", revision: result.state.revisions[item.id] }));
  if (result.conflicts.length) return { status: "conflicts", conflicts: result.conflicts, itemInfos, mergedVault: persisted };
  window.localStorage.setItem("zero-vault.local.last-synced-at.v1", new Date().toISOString());
  return { status: "item-synced", serverRevision: result.state.serverRevision, appliedCount: result.appliedCount, itemInfos, mergedVault: persisted };
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

  if (unlockedVault.runtime === "crypto-core-wasm") {
    try {
      const remote = await readRemoteItemState(itemId);
      const item = unlockedVault.snapshot.items.find((candidate) => candidate.id === itemId);
      const pending = loadPendingItemMutations();
      const baseItemRevision = remote.revision;
      let plan;
      if (!item) {
        if (!pending[itemId]?.delete) return { status: "error", message: "条目未找到。" };
        const deletion = { ...pending[itemId]!.delete!, baseItemRevision, clientMutationId: crypto.randomUUID() };
        pending[itemId] = { itemUpdatedAt: deletion.deletedAt, clientMutationId: deletion.clientMutationId, baseItemRevision, delete: deletion };
        plan = { protocol: "item_level_v1" as const, baseRevision: remote.serverRevision, upserts: [], deletes: [deletion] };
      } else {
        delete pending[itemId];
        const built = await buildItemLevelSyncPlan({ ...unlockedVault, snapshot: { ...unlockedVault.snapshot, items: [item] } }, user.id, { [itemId]: baseItemRevision }, new Set(), remote.serverRevision, {});
        Object.assign(pending, built.pendingMutations);
        plan = built.plan;
      }
      savePendingItemMutations(pending);
      const response = await pushItemLevelSync(csrfToken, plan);
      if (response.conflicts.length > 0) return { status: "still-conflicting", message: "远端版本再次变化，请刷新后重试。" };
      const receipt = response.applied.mutationReceipts?.find((entry) => entry.clientMutationId === pending[itemId]!.clientMutationId && entry.itemId === itemId);
      if (!receipt) throw new Error("sync_receipt_missing");
      const revisions = loadItemRevisionMap();
      const timestamps = loadSyncedTimestamps();
      if (item) { revisions[itemId] = receipt.appliedItemRevision; timestamps[itemId] = item.updatedAt; }
      else { delete revisions[itemId]; delete timestamps[itemId]; }
      saveItemRevisionMap(revisions);
      saveSyncedTimestamps(timestamps);
      delete pending[itemId];
      savePendingItemMutations(pending);
      const conflictIds = loadConflictIds();
      conflictIds.delete(itemId);
      saveConflictIds(conflictIds);
      saveLocalServerRevision(response.serverRevision);
      return { status: "ok" };
    } catch (caught) {
      return { status: "error", message: caught instanceof Error ? caught.message : "同步失败。" };
    }
  }

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
    const pendingMutations = loadPendingItemMutations();
    const baseItemRevision = remoteItemRevision ?? revisionMap[itemId] ?? 0;
    const built = await buildItemLevelSyncPlan(
      {
        ...unlockedVault,
        snapshot: { ...unlockedVault.snapshot, items: [item] }
      },
      user.id,
      { [itemId]: baseItemRevision },
      new Set(),
      baseServerRevision,
      pendingMutations
    );
    savePendingItemMutations(built.pendingMutations);
    const { plan } = built;
    const response = await pushItemLevelSync(csrfToken, plan);
    const conflicts = response.conflicts ?? [];
    if (conflicts.length === 0) {
      const appliedRevision = response.applied.mutationReceipts?.find(
        (receipt) => receipt.operation === "upsert" && receipt.itemId === itemId
      )?.appliedItemRevision ?? response.serverRevision;
      const updatedMap = { ...revisionMap, [itemId]: appliedRevision };
      saveItemRevisionMap(updatedMap);
      saveLocalServerRevision(response.serverRevision);
      const remainingMutations = { ...built.pendingMutations };
      delete remainingMutations[itemId];
      savePendingItemMutations(remainingMutations);
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
    if (unlockedVault.runtime === "crypto-core-wasm") {
      const remote = await readRemoteItemState(itemId);
      let next = deleteItem(unlockedVault, itemId);
      const revisions = loadItemRevisionMap();
      const timestamps = loadSyncedTimestamps();
      if (remote.item) {
        const item = await decryptItemFromSync(unlockedVault, remote.item.encryptedItemKey, remote.item.encryptedPayload, itemId);
        next = { ...next, snapshot: { ...next.snapshot, items: [...next.snapshot.items, item] } };
        revisions[itemId] = remote.revision;
        timestamps[itemId] = item.updatedAt;
      } else {
        delete revisions[itemId];
        delete timestamps[itemId];
      }
      const persisted = await persistUnlockedVault(next);
      saveItemRevisionMap(revisions);
      saveSyncedTimestamps(timestamps);
      const pending = loadPendingItemMutations();
      delete pending[itemId];
      savePendingItemMutations(pending);
      const conflictIds = loadConflictIds();
      conflictIds.delete(itemId);
      saveConflictIds(conflictIds);
      return { status: "ok", mergedVault: persisted };
    }
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
  if (!item) return { status: "error", message: "条目未找到。" };

  try {
    const now = new Date().toISOString();
    let copy = { ...unlockedVault, snapshot: { ...unlockedVault.snapshot, items: [...unlockedVault.snapshot.items, { ...item, id: crypto.randomUUID(), title: `${item.title} (副本)`, createdAt: now, updatedAt: now }] } };
    if (unlockedVault.runtime === "crypto-core-wasm") {
      const accepted = await handleResolveAcceptRemote({ unlockedVault: copy, csrfToken: "", itemId });
      if (accepted.status !== "ok") throw new Error("无法读取远端版本，请稍后重试。");
      copy = accepted.mergedVault.unlocked;
    }
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

async function readRemoteItemState(itemId: string) {
  let cursor = 0;
  let revision = 0;
  let serverRevision = 0;
  let item: import("@zero-vault/shared").VaultItemCiphertext | null = null;
  for (let page = 0; page < 1000; page += 1) {
    const remote = await pullItemLevelSync(cursor);
    serverRevision = remote.serverRevision;
    for (const change of remote.changes) {
      if (change.operation === "upsert" && change.item.id === itemId) { item = change.item; revision = change.item.revision; }
      if (change.operation === "delete" && change.itemId === itemId) { item = null; revision = change.revision; }
    }
    if (!remote.hasMore) return { item, revision, serverRevision };
    if (remote.cursor <= cursor) throw new Error("sync_cursor_invalid");
    cursor = remote.cursor;
  }
  throw new Error("sync_page_limit");
}

/**
 * Skip a conflict — remove it from the conflict list.
 */
export function handleResolveSkip(itemId: string): void {
  const conflictIds = loadConflictIds();
  conflictIds.add(itemId);
  saveConflictIds(conflictIds);
}
