import type { CiphertextEnvelope, ItemLevelSyncResponse, SyncPushRequest, VaultItemCiphertext } from "@zero-vault/shared";
import type { EncryptedLocalVault, UnlockedVault } from "./local-vault";
import { decryptItemFromSync } from "./local-vault";
import { decodeJsonFromEnvelope, encodeJsonForEnvelope } from "./api-client";
import {
  buildItemLevelSyncPlan,
  extractConflicts,
  type ItemSyncInfo,
  type PendingItemMutation
} from "./item-sync";

const LOCAL_VAULT_SYNC_ITEM_ID = "00000000-0000-4000-8000-000000000001";
const LOCAL_SYNC_REVISION_KEY = "zero-vault.local.sync-revision.v1";
const LOCAL_ITEM_REVISIONS_KEY = "zero-vault.local.item-revisions.v1";
const LOCAL_LAST_SYNCED_AT_KEY = "zero-vault.local.last-synced-at.v1";
const LOCAL_CONFLICT_IDS_KEY = "zero-vault.local.conflict-ids.v1";
const LOCAL_PENDING_MUTATIONS_KEY = "zero-vault.local.pending-item-mutations.v1";
const LOCAL_SYNCED_TIMESTAMPS_KEY = "zero-vault.local.synced-timestamps.v1";
const LOCAL_CURSOR_KEY = "zero-vault.local.sync-cursor.v1";

export const loadSyncedTimestamps = (): Record<string, string> => JSON.parse(window.localStorage.getItem(LOCAL_SYNCED_TIMESTAMPS_KEY) ?? "{}");
export const saveSyncedTimestamps = (timestamps: Record<string, string>): void => window.localStorage.setItem(LOCAL_SYNCED_TIMESTAMPS_KEY, JSON.stringify(timestamps));
export const loadSyncCursor = (): number => Number(window.localStorage.getItem(LOCAL_CURSOR_KEY) ?? 0);
export const saveSyncCursor = (cursor: number): void => window.localStorage.setItem(LOCAL_CURSOR_KEY, String(cursor));

// ---------------------------------------------------------------------------
// Legacy whole-envelope helpers (kept as fallback)
// ---------------------------------------------------------------------------

export const loadLocalServerRevision = () => {
  const raw = window.localStorage.getItem(LOCAL_SYNC_REVISION_KEY);
  return raw ? Number(raw) : 0;
};

export const saveLocalServerRevision = (revision: number) => {
  window.localStorage.setItem(LOCAL_SYNC_REVISION_KEY, String(revision));
};

export const encryptedVaultToSyncRequest = (
  encryptedVault: EncryptedLocalVault,
  userId: string,
  baseRevision: number
): SyncPushRequest => {
  const now = new Date().toISOString();
  const item: VaultItemCiphertext = {
    id: LOCAL_VAULT_SYNC_ITEM_ID,
    ownerUserId: userId,
    revision: baseRevision,
    createdAt: encryptedVault.updatedAt,
    updatedAt: now,
    encryptedItemKey: {
      alg: "AES_256_GCM",
      nonce: encryptedVault.kdf.salt,
      ciphertext: encodeJsonForEnvelope(encryptedVault.kdf)
    },
    encryptedPayload: {
      alg: encryptedVault.cipher.alg,
      nonce: encryptedVault.cipher.nonce,
      ciphertext: encodeJsonForEnvelope(encryptedVault)
    },
    encryptedSearchTokens: []
  };

  return {
    baseRevision,
    upserts: [item],
    deletes: []
  };
};

export const getSyncedLocalVaultItem = (items: VaultItemCiphertext[]) =>
  items.find((item) => item.id === LOCAL_VAULT_SYNC_ITEM_ID) ?? null;

export const syncItemToEncryptedVault = (item: VaultItemCiphertext): EncryptedLocalVault => {
  return decodeJsonFromEnvelope<EncryptedLocalVault>(item.encryptedPayload.ciphertext);
};

// ---------------------------------------------------------------------------
// Per-item revision tracking (for item-level sync)
// ---------------------------------------------------------------------------

export const loadItemRevisionMap = (): Record<string, number> => {
  const raw = window.localStorage.getItem(LOCAL_ITEM_REVISIONS_KEY);
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, number>;
};

export const saveItemRevisionMap = (map: Record<string, number>) => {
  window.localStorage.setItem(LOCAL_ITEM_REVISIONS_KEY, JSON.stringify(map));
};

export const updateItemRevisionMap = (
  current: Record<string, number>,
  applied: ItemLevelSyncResponse["applied"],
  serverRevision: number
): Record<string, number> => {
  const next = { ...current };
  for (const id of applied.upsertedItemIds) {
    const receipt = applied.mutationReceipts?.find(
      (candidate) => candidate.operation === "upsert" && candidate.itemId === id
    );
    next[id] = receipt?.appliedItemRevision ?? serverRevision;
  }
  for (const id of applied.deletedItemIds) {
    delete next[id];
  }
  return next;
};

export const loadPendingItemMutations = (): Record<string, PendingItemMutation> => {
  try {
    const raw = window.localStorage.getItem(LOCAL_PENDING_MUTATIONS_KEY);
    return raw ? JSON.parse(raw) as Record<string, PendingItemMutation> : {};
  } catch {
    return {};
  }
};

export const savePendingItemMutations = (
  mutations: Record<string, PendingItemMutation>
): void => {
  window.localStorage.setItem(LOCAL_PENDING_MUTATIONS_KEY, JSON.stringify(mutations));
};

// ---------------------------------------------------------------------------
// Conflict ID tracking
// ---------------------------------------------------------------------------

export const loadConflictIds = (): Set<string> => {
  const raw = window.localStorage.getItem(LOCAL_CONFLICT_IDS_KEY);
  if (!raw) return new Set();
  return new Set(JSON.parse(raw) as string[]);
};

export const saveConflictIds = (ids: Set<string>) => {
  window.localStorage.setItem(LOCAL_CONFLICT_IDS_KEY, JSON.stringify([...ids]));
};

// ---------------------------------------------------------------------------
// Last synced timestamp
// ---------------------------------------------------------------------------

export const loadLastSyncedAt = (): string | null => {
  return window.localStorage.getItem(LOCAL_LAST_SYNCED_AT_KEY);
};

export const saveLastSyncedAt = (timestamp: string) => {
  window.localStorage.setItem(LOCAL_LAST_SYNCED_AT_KEY, timestamp);
};

// ---------------------------------------------------------------------------
// Merging remote items into local vault
// ---------------------------------------------------------------------------

export type MergeRemoteItemsResult = {
  vault: UnlockedVault;
  revisionMap: Record<string, number>;
  mergedItemIds: string[];
  failedItemIds: string[];
};

export const mergeRemoteItems = async (
  vault: UnlockedVault,
  remoteItems: VaultItemCiphertext[]
): Promise<MergeRemoteItemsResult> => {
  const revisionMap = loadItemRevisionMap();
  let merged = vault;
  const mergedItemIds: string[] = [];
  const failedItemIds: string[] = [];

  for (const item of remoteItems) {
    if (item.id === LOCAL_VAULT_SYNC_ITEM_ID) continue;
    try {
      const credential = await decryptItemFromSync(merged, item.encryptedItemKey as CiphertextEnvelope, item.encryptedPayload as CiphertextEnvelope, item.id);
      const existingIndex = merged.snapshot.items.findIndex((i) => i.id === credential.id);
      const updatedItems = [...merged.snapshot.items];
      if (existingIndex >= 0) {
        updatedItems[existingIndex] = credential;
      } else {
        updatedItems.push(credential);
      }
      merged = { ...merged, snapshot: { ...merged.snapshot, items: updatedItems, updatedAt: new Date().toISOString() } };
      revisionMap[credential.id] = item.revision;
      mergedItemIds.push(credential.id);
    } catch {
      failedItemIds.push(item.id);
    }
  }

  saveItemRevisionMap(revisionMap);
  return { vault: merged, revisionMap, mergedItemIds, failedItemIds };
};

// ---------------------------------------------------------------------------
// Item-level sync flow
// ---------------------------------------------------------------------------

export type ItemLevelSyncResult = {
  protocol: "item_level_v1";
  response: ItemLevelSyncResponse;
  mergedVault: UnlockedVault;
  itemInfos: ItemSyncInfo[];
  hasConflicts: boolean;
};

export type LegacySyncResult = {
  protocol: "legacy";
  serverRevision: number;
};

export type SyncResult = ItemLevelSyncResult | LegacySyncResult;

export const performItemLevelSync = async (
  vault: UnlockedVault,
  userId: string,
  pushItemLevel: (plan: ReturnType<typeof buildItemLevelSyncPlan> extends Promise<infer R> ? R extends { plan: infer P } ? P : never : never) => Promise<ItemLevelSyncResponse>
): Promise<SyncResult> => {
  const revisionMap = loadItemRevisionMap();
  const conflictIds = loadConflictIds();
  const built = await buildItemLevelSyncPlan(
    vault,
    userId,
    revisionMap,
    conflictIds,
    loadLocalServerRevision(),
    loadPendingItemMutations()
  );
  const { plan, itemInfos } = built;
  // Persist before the network call so a timeout/restart reuses the same
  // mutation ids. Only encrypted payloads travel in the request; this local
  // record contains ids and timestamps, never vault plaintext.
  savePendingItemMutations(built.pendingMutations);
  const response = await pushItemLevel(plan);
  const conflicts = response.conflicts ?? [];
  const updatedMap = updateItemRevisionMap(revisionMap, response.applied, response.serverRevision);
  saveItemRevisionMap(updatedMap);
  const remainingMutations = { ...built.pendingMutations };
  for (const itemId of [
    ...response.applied.upsertedItemIds,
    ...response.applied.deletedItemIds
  ]) {
    delete remainingMutations[itemId];
  }
  savePendingItemMutations(remainingMutations);

  if (conflicts.length > 0) {
    const newConflictIds = new Set(conflicts.map((c) => c.itemId));
    saveConflictIds(newConflictIds);
    if (response.serverRevision != null) {
      saveLocalServerRevision(response.serverRevision);
    }
    return {
      protocol: "item_level_v1",
      response,
      mergedVault: vault,
      itemInfos: itemInfos.map((info) =>
        newConflictIds.has(info.itemId)
          ? { ...info, status: "conflict" as const }
          : response.applied.upsertedItemIds.includes(info.itemId)
            ? { ...info, status: "synced" as const, revision: updatedMap[info.itemId] }
            : info
      ),
      hasConflicts: true
    };
  }

  saveLocalServerRevision(response.serverRevision);
  saveConflictIds(new Set());
  saveLastSyncedAt(new Date().toISOString());

  const updatedInfos = itemInfos.map((info) =>
    response.applied.upsertedItemIds.includes(info.itemId)
      ? { ...info, status: "synced" as const, revision: updatedMap[info.itemId] }
      : info
  );

  return {
    protocol: "item_level_v1",
    response,
    mergedVault: vault,
    itemInfos: updatedInfos,
    hasConflicts: false
  };
};
