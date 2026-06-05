import type { CiphertextEnvelope, ItemLevelEncryptedUpsert, ItemLevelSyncPlan, ItemLevelSyncResponse } from "@zero-vault/shared";
import type { UnlockedVault, VaultItem } from "./local-vault";
import { encryptItemForSync } from "./local-vault";
import { generateSearchTokens } from "./search-tokens";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ItemSyncStatus = "synced" | "local-only" | "pending" | "conflict";

export type ItemSyncInfo = {
  itemId: string;
  status: ItemSyncStatus;
  revision: number | undefined;
};

export const buildItemLevelSyncPlan = async (
  vault: UnlockedVault,
  userId: string,
  revisionMap: Record<string, number>,
  conflicts: Set<string>,
  baseRevision = 0
): Promise<{ plan: ItemLevelSyncPlan; itemInfos: ItemSyncInfo[] }> => {
  const now = new Date().toISOString();
  const itemInfos: ItemSyncInfo[] = [];
  const upserts: ItemLevelEncryptedUpsert[] = [];

  for (const credential of vault.snapshot.items) {
    if (conflicts.has(credential.id)) {
      itemInfos.push({ itemId: credential.id, status: "conflict", revision: revisionMap[credential.id] });
      continue;
    }

    const bundle = await encryptItemForSync(vault, credential);
    const searchTokens = await generateSearchTokens(vault, credential);
    const baseItemRevision = revisionMap[credential.id];
    const status: ItemSyncStatus = baseItemRevision !== undefined ? "synced" : "pending";
    itemInfos.push({ itemId: credential.id, status, revision: baseItemRevision });

    const upsert: ItemLevelEncryptedUpsert = {
      id: credential.id,
      ownerUserId: userId,
      revision: baseItemRevision ?? 0,
      createdAt: credential.createdAt,
      updatedAt: now,
      encryptedItemKey: bundle.encryptedItemKey,
      encryptedPayload: bundle.encryptedPayload,
      encryptedSearchTokens: searchTokens,
      ...(baseItemRevision !== undefined ? { baseItemRevision } : {})
    };
    upserts.push(upsert);
  }

  const plan: ItemLevelSyncPlan = {
    protocol: "item_level_v1",
    baseRevision,
    upserts,
    deletes: []
  };
  return { plan, itemInfos };
};

export const extractConflicts = (response: unknown): ItemLevelSyncResponse["conflicts"] => {
  const raw = response as { protocol?: string; conflicts?: unknown[] };
  if (!raw || raw.protocol !== "item_level_v1" || !Array.isArray(raw.conflicts)) return [];
  return raw.conflicts as ItemLevelSyncResponse["conflicts"];
};
