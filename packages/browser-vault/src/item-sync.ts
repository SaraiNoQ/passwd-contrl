import {
  aeadCiphertextEnvelopeSchema,
  hmacSha256EnvelopeSchema,
  MAX_SYNC_MUTATIONS,
  type ItemLevelEncryptedDelete,
  type ItemLevelEncryptedUpsert,
  type ItemLevelSyncPlan,
  type ItemLevelSyncResponse
} from "@zero-vault/shared";
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

export type PendingItemMutation = {
  itemUpdatedAt: string;
  clientMutationId: string;
  // Added in v2. Older localStorage entries contain only the two fields above
  // and are intentionally regenerated once. New retries reuse the exact
  // encrypted envelope so the server can bind idempotency to ciphertext.
  baseItemRevision?: number;
  upsert?: ItemLevelEncryptedUpsert;
  delete?: ItemLevelEncryptedDelete;
};

export const buildItemLevelSyncPlan = async (
  vault: UnlockedVault,
  userId: string,
  revisionMap: Record<string, number>,
  conflicts: Set<string>,
  baseRevision: number,
  pendingMutations: Record<string, PendingItemMutation>,
  syncedUpdatedAt: Record<string, string> = {}
): Promise<{
  plan: ItemLevelSyncPlan;
  itemInfos: ItemSyncInfo[];
  pendingMutations: Record<string, PendingItemMutation>;
}> => {
  const itemInfos: ItemSyncInfo[] = [];
  const upserts: ItemLevelEncryptedUpsert[] = [];
  const deletes: ItemLevelEncryptedDelete[] = [];
  const nextPendingMutations = { ...pendingMutations };

  for (const credential of vault.snapshot.items) {
    if (conflicts.has(credential.id)) {
      itemInfos.push({ itemId: credential.id, status: "conflict", revision: revisionMap[credential.id] });
      continue;
    }

    const baseItemRevision = revisionMap[credential.id];
    const unchanged = syncedUpdatedAt[credential.id] === credential.updatedAt && !nextPendingMutations[credential.id];
    const status: ItemSyncStatus = unchanged ? "synced" : "pending";
    itemInfos.push({ itemId: credential.id, status, revision: baseItemRevision });
    if (unchanged || upserts.length >= MAX_SYNC_MUTATIONS) continue;
    const previousMutation = nextPendingMutations[credential.id];
    const expectedBaseRevision = previousMutation?.itemUpdatedAt === credential.updatedAt && previousMutation.upsert
      ? previousMutation.baseItemRevision ?? baseItemRevision ?? 0
      : baseItemRevision ?? 0;
    const canReplay = previousMutation?.itemUpdatedAt === credential.updatedAt
      && previousMutation.baseItemRevision === expectedBaseRevision
      && previousMutation.upsert?.id === credential.id
      && previousMutation.upsert.ownerUserId === userId
      && previousMutation.upsert.clientMutationId === previousMutation.clientMutationId;
    let upsert: ItemLevelEncryptedUpsert;
    if (canReplay && previousMutation.upsert) {
      upsert = previousMutation.upsert;
    } else {
      const bundle = await encryptItemForSync(vault, credential);
      const searchTokens = await generateSearchTokens(vault, credential);
      upsert = {
        id: credential.id,
        ownerUserId: userId,
        revision: expectedBaseRevision,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
        encryptedItemKey: aeadCiphertextEnvelopeSchema.parse(bundle.encryptedItemKey),
        encryptedPayload: aeadCiphertextEnvelopeSchema.parse(bundle.encryptedPayload),
        encryptedSearchTokens: searchTokens.map((token) => hmacSha256EnvelopeSchema.parse(token)),
        baseItemRevision: expectedBaseRevision,
        clientMutationId: globalThis.crypto.randomUUID()
      };
    }
    nextPendingMutations[credential.id] = {
      itemUpdatedAt: credential.updatedAt,
      clientMutationId: upsert.clientMutationId,
      baseItemRevision: expectedBaseRevision,
      upsert
    };
    upserts.push(upsert);
  }

  const localIds = new Set(vault.snapshot.items.map((item) => item.id));
  for (const itemId of new Set([...Object.keys(revisionMap), ...Object.keys(pendingMutations)])) {
    if (localIds.has(itemId) || conflicts.has(itemId)) continue;
    if (upserts.length + deletes.length >= MAX_SYNC_MUTATIONS) break;
    const previous = pendingMutations[itemId];
    const baseItemRevision = revisionMap[itemId] ?? previous?.baseItemRevision ?? 0;
    const deletion = previous?.delete?.ownerUserId === userId && previous.delete.baseItemRevision === baseItemRevision
      ? previous.delete
      : { id: itemId, ownerUserId: userId, baseItemRevision, deletedAt: new Date().toISOString(), clientMutationId: globalThis.crypto.randomUUID() };
    deletes.push(deletion);
    nextPendingMutations[itemId] = { itemUpdatedAt: deletion.deletedAt, clientMutationId: deletion.clientMutationId, baseItemRevision, delete: deletion };
  }

  const plan: ItemLevelSyncPlan = {
    protocol: "item_level_v1",
    baseRevision,
    upserts,
    deletes
  };
  return { plan, itemInfos, pendingMutations: nextPendingMutations };
};

export const extractConflicts = (response: unknown): ItemLevelSyncResponse["conflicts"] => {
  const raw = response as { protocol?: string; conflicts?: unknown[] };
  if (!raw || raw.protocol !== "item_level_v1" || !Array.isArray(raw.conflicts)) return [];
  return raw.conflicts as ItemLevelSyncResponse["conflicts"];
};

