import {
  itemLevelEncryptedDeleteSchema,
  itemLevelEncryptedUpsertSchema,
  itemLevelSyncPlanSchema,
  vaultItemCiphertextSchema,
  type AppliedMutationReceipt,
  type ItemLevelSyncPullResponse,
  type ItemLevelSyncResponse,
  type SyncConflictResponse,
  type VaultItemCiphertext,
} from "@zero-vault/shared";
import type { MobileApiClient } from "../api/mobile-api-client";
import type {
  ConflictPersistenceInput,
  MobileCiphertextStore,
  PendingMutation,
} from "../storage/mobile-ciphertext-store";

const MAX_MUTATIONS_PER_PUSH = 100;
const MAX_PULL_PAGES_PER_RUN = 10_000;

export interface SyncResult {
  pushed: number;
  pulledChanges: number;
  pendingCount: number;
  serverRevision: number;
  conflictCount: number;
  lastSyncedAt: string;
}

/**
 * Durable item-level sync.
 *
 * The Room queue is the source of truth. A retry reuses the exact persisted
 * encrypted operation and clientMutationId; it never re-encrypts an item.
 */
export class MobileSyncService {
  constructor(
    private readonly apiClient: MobileApiClient,
    private readonly ciphertextStore: MobileCiphertextStore,
    private readonly accountId: string,
    private readonly csrfToken: string,
  ) {
    if (!accountId || !csrfToken) throw new Error("authenticated_sync_required");
  }

  async synchronize(): Promise<SyncResult> {
    let pushed = 0;
    let pulledChanges = 0;

    // Drain in stable batches. Conflicted operations stay queued for explicit
    // user resolution, while later independent mutations remain eligible.
    for (;;) {
      const before = await this.ciphertextStore.listPendingMutations();
      if (before.length === 0) break;
      const unresolved = new Set(
        (await this.ciphertextStore.listConflicts())
          .filter((conflict) => conflict.status === "UNRESOLVED")
          .map((conflict) => conflict.itemId),
      );
      const batch = before
        .filter((mutation) => !unresolved.has(mutation.itemId))
        .slice(0, MAX_MUTATIONS_PER_PUSH);
      if (batch.length === 0) break;
      const response = await this.pushBatch(batch);
      pushed += response.applied;
      if (response.applied === 0 && response.conflicted === 0) break;
    }

    let metadata = await this.ciphertextStore.getSyncMetadata();
    let cursor = metadata.serverCursor ?? 0;
    for (let page = 0; page < MAX_PULL_PAGES_PER_RUN; page += 1) {
      const response = await this.apiClient.pullItems(cursor);
      if (response.cursor < cursor) throw new Error("sync_cursor_regressed");
      if (response.serverRevision < metadata.serverRevision) {
        throw new Error("sync_server_revision_regressed");
      }
      if (response.hasMore && response.cursor <= cursor) {
        throw new Error("sync_cursor_did_not_advance");
      }
      pulledChanges += response.changes.length;
      await this.applyPullResponse(response);
      metadata = await this.ciphertextStore.getSyncMetadata();
      if (!response.hasMore) break;
      cursor = response.cursor;
      if (page === MAX_PULL_PAGES_PER_RUN - 1) throw new Error("sync_pull_page_limit_exceeded");
    }

    metadata = await this.ciphertextStore.getSyncMetadata();
    const pending = await this.ciphertextStore.listPendingMutations();
    const conflicts = await this.ciphertextStore.listConflicts();
    return {
      pushed,
      pulledChanges,
      pendingCount: pending.length,
      serverRevision: metadata.serverRevision,
      conflictCount: conflicts.filter((conflict) => conflict.status === "UNRESOLVED").length,
      lastSyncedAt: metadata.lastSyncedAt ?? new Date().toISOString(),
    };
  }

  async applyPullResponse(response: ItemLevelSyncPullResponse): Promise<void> {
    const now = new Date().toISOString();
    // Parse the canonical item list even though changes contains the same data;
    // this keeps one server-defined representation at the Room boundary.
    const items = response.items.map((item) => vaultItemCiphertextSchema.parse(item));
    await this.ciphertextStore.applyPullPage(
      items,
      response.deletedItems,
      response.serverRevision,
      response.cursor,
      now,
    );
  }

  private async pushBatch(batch: PendingMutation[]): Promise<{ applied: number; conflicted: number }> {
    const metadata = await this.ciphertextStore.getSyncMetadata();
    const pendingByMutation = new Map(batch.map((mutation) => [mutation.clientMutationId, mutation]));
    const upserts = batch
      .filter((mutation) => mutation.operation === "upsert")
      .map((mutation) => {
        if (!mutation.ciphertextEnvelopeJson) throw new Error("pending_ciphertext_missing");
        const ciphertext = vaultItemCiphertextSchema.parse(JSON.parse(mutation.ciphertextEnvelopeJson));
        if (ciphertext.id !== mutation.itemId) throw new Error("pending_item_id_mismatch");
        return itemLevelEncryptedUpsertSchema.parse({
          ...ciphertext,
          baseItemRevision: mutation.baseItemRevision,
          clientMutationId: mutation.clientMutationId,
        });
      });
    const deletes = batch
      .filter((mutation) => mutation.operation === "delete")
      .map((mutation) => itemLevelEncryptedDeleteSchema.parse({
        id: mutation.itemId,
        ownerUserId: this.accountId,
        baseItemRevision: mutation.baseItemRevision,
        deletedAt: mutation.createdAt,
        clientMutationId: mutation.clientMutationId,
      }));
    const plan = itemLevelSyncPlanSchema.parse({
      protocol: "item_level_v1",
      baseRevision: metadata.serverRevision,
      upserts,
      deletes,
    });
    const response = await this.apiClient.pushItemLevelSync(this.csrfToken, plan);
    if (response.serverRevision < metadata.serverRevision) {
      throw new Error("sync_server_revision_regressed");
    }
    const receipts = requireMutationReceipts(response);
    validateReceipts(receipts, pendingByMutation);
    validateConflicts(response.conflicts, batch, receipts);
    const now = new Date().toISOString();

    await this.ciphertextStore.acknowledgeMutations(
      receipts.map(({ clientMutationId, appliedItemRevision }) => ({
        clientMutationId,
        appliedItemRevision,
      })),
      response.serverRevision,
      now,
    );

    if (response.conflicts.length > 0) {
      const conflicts: ConflictPersistenceInput[] = response.conflicts.map((conflict) => {
        const pending = batch.find((mutation) => mutation.itemId === conflict.itemId);
        let localCiphertext: VaultItemCiphertext | null = null;
        if (pending?.ciphertextEnvelopeJson) {
          localCiphertext = vaultItemCiphertextSchema.parse(JSON.parse(pending.ciphertextEnvelopeJson));
        }
        return { conflict, localCiphertext, createdAt: now };
      });
      await this.ciphertextStore.saveConflicts(conflicts);
    }
    return { applied: receipts.length, conflicted: response.conflicts.length };
  }
}

function validateConflicts(
  conflicts: SyncConflictResponse["conflicts"],
  batch: PendingMutation[],
  receipts: AppliedMutationReceipt[],
): void {
  const batchByItem = new Map(batch.map((mutation) => [mutation.itemId, mutation]));
  const acknowledgedItems = new Set(receipts.map((receipt) => receipt.itemId));
  const seen = new Set<string>();
  for (const conflict of conflicts) {
    const pending = batchByItem.get(conflict.itemId);
    if (
      seen.has(conflict.itemId) ||
      acknowledgedItems.has(conflict.itemId) ||
      !pending ||
      pending.operation !== conflict.operation ||
      pending.baseItemRevision !== conflict.clientBaseRevision
    ) {
      throw new Error("sync_conflict_mismatch");
    }
    seen.add(conflict.itemId);
  }
}

function requireMutationReceipts(
  response: ItemLevelSyncResponse | SyncConflictResponse,
): AppliedMutationReceipt[] {
  const receipts = response.applied.mutationReceipts;
  if (!receipts) throw new Error("sync_receipts_missing");
  return receipts;
}

function validateReceipts(
  receipts: AppliedMutationReceipt[],
  pendingByMutation: Map<string, PendingMutation>,
): void {
  if (new Set(receipts.map((receipt) => receipt.clientMutationId)).size !== receipts.length) {
    throw new Error("duplicate_sync_receipt");
  }
  for (const receipt of receipts) {
    const pending = pendingByMutation.get(receipt.clientMutationId);
    if (!pending || pending.itemId !== receipt.itemId || pending.operation !== receipt.operation) {
      throw new Error("sync_receipt_mismatch");
    }
  }
}
