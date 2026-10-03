import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  itemLevelSyncConflictSchema,
  itemLevelSyncResponseSchema,
  syncConflictResponseSchema,
  type ItemLevelSyncPlan,
  type ItemLevelSyncResponse,
} from "@zero-vault/shared";
import type { MobileApiClient } from "../lib/api/mobile-api-client";
import { InMemoryCiphertextStore } from "../lib/storage/mobile-ciphertext-store";
import { MobileSyncService } from "../lib/sync/mobile-sync-service";
import {
  ACCOUNT_ID,
  CREATED_AT,
  ITEM_ID_A,
  ITEM_ID_B,
  MUTATION_ID_A,
  MUTATION_ID_B,
  UPDATED_AT,
  makeCiphertext,
  makePullResponse,
  makeStoredItem,
} from "./fixtures";

const CSRF_TOKEN = "csrf_token";

function createApi() {
  return {
    pushItemLevelSync: vi.fn(),
    pullItems: vi.fn(),
  };
}

function createService(
  api: ReturnType<typeof createApi>,
  store: InMemoryCiphertextStore,
): MobileSyncService {
  return new MobileSyncService(api as unknown as MobileApiClient, store, ACCOUNT_ID, CSRF_TOKEN);
}

function appliedResponse(
  itemId = ITEM_ID_A,
  mutationId = MUTATION_ID_A,
  appliedItemRevision = 1,
  serverRevision = 1,
): ItemLevelSyncResponse {
  return itemLevelSyncResponseSchema.parse({
    protocol: "item_level_v1",
    serverRevision,
    applied: {
      upsertedItemIds: [itemId],
      deletedItemIds: [],
      mutationReceipts: [{
        clientMutationId: mutationId,
        itemId,
        operation: "upsert",
        appliedItemRevision,
      }],
    },
    conflicts: [],
  });
}

describe("MobileSyncService", () => {
  let store: InMemoryCiphertextStore;

  beforeEach(() => {
    store = new InMemoryCiphertextStore();
  });

  it("acknowledges only server mutationReceipts and advances the stored revision", async () => {
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 0), 0, MUTATION_ID_A);
    const api = createApi();
    api.pushItemLevelSync.mockResolvedValueOnce(appliedResponse());
    api.pullItems.mockResolvedValueOnce(makePullResponse({ serverRevision: 1 }));

    const result = await createService(api, store).synchronize();

    expect(result).toMatchObject({ pushed: 1, pendingCount: 0, serverRevision: 1 });
    expect((await store.getById(ITEM_ID_A))?.itemRevision).toBe(1);
    expect(api.pushItemLevelSync).toHaveBeenCalledWith(
      CSRF_TOKEN,
      expect.objectContaining({
        protocol: "item_level_v1",
        baseRevision: 0,
        upserts: [expect.objectContaining({
          id: ITEM_ID_A,
          clientMutationId: MUTATION_ID_A,
          baseItemRevision: 0,
        })],
      }),
    );
  });

  it("keeps the exact persisted mutation and ciphertext stable across a transport retry", async () => {
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 0), 0, MUTATION_ID_A);
    const api = createApi();
    api.pushItemLevelSync
      .mockRejectedValueOnce(new Error("network_error"))
      .mockResolvedValueOnce(appliedResponse());
    api.pullItems.mockResolvedValueOnce(makePullResponse({ serverRevision: 1 }));
    const service = createService(api, store);

    await expect(service.synchronize()).rejects.toThrow("network_error");
    expect(await store.listPendingMutations()).toHaveLength(1);
    await service.synchronize();

    const firstPlan = api.pushItemLevelSync.mock.calls[0]?.[1] as ItemLevelSyncPlan;
    const retryPlan = api.pushItemLevelSync.mock.calls[1]?.[1] as ItemLevelSyncPlan;
    expect(retryPlan).toEqual(firstPlan);
    expect(retryPlan.upserts[0]?.clientMutationId).toBe(MUTATION_ID_A);
    expect(retryPlan.upserts[0]?.encryptedPayload).toEqual(makeCiphertext().encryptedPayload);
  });

  it("fails closed when mutationReceipts are absent or do not match the queued operation", async () => {
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 0), 0, MUTATION_ID_A);
    const api = createApi();
    const withoutReceipts = {
      ...appliedResponse(),
      applied: {
        upsertedItemIds: [ITEM_ID_A],
        deletedItemIds: [],
      },
    } as ItemLevelSyncResponse;
    api.pushItemLevelSync.mockResolvedValueOnce(withoutReceipts);

    await expect(createService(api, store).synchronize()).rejects.toThrow("sync_receipts_missing");
    expect(await store.listPendingMutations()).toHaveLength(1);

    api.pushItemLevelSync.mockResolvedValueOnce(itemLevelSyncResponseSchema.parse({
      protocol: "item_level_v1",
      serverRevision: 1,
      applied: {
        upsertedItemIds: [ITEM_ID_A],
        deletedItemIds: [],
        mutationReceipts: [{
          clientMutationId: MUTATION_ID_A,
          itemId: ITEM_ID_B,
          operation: "upsert",
          appliedItemRevision: 1,
        }],
      },
      conflicts: [],
    }));
    await expect(createService(api, store).synchronize()).rejects.toThrow("sync_receipt_mismatch");
    expect(await store.listPendingMutations()).toHaveLength(1);
  });

  it("pulls every page by durable cursor and applies later deletions", async () => {
    const remote = makeCiphertext(ITEM_ID_A, 3);
    const api = createApi();
    api.pullItems
      .mockResolvedValueOnce(makePullResponse({
        serverRevision: 3,
        cursor: 10,
        hasMore: true,
        changes: [{ cursor: 10, operation: "upsert", item: remote }],
        items: [remote],
      }))
      .mockResolvedValueOnce(makePullResponse({
        serverRevision: 4,
        cursor: 11,
        changes: [{
          cursor: 11,
          operation: "delete",
          itemId: ITEM_ID_A,
          revision: 4,
          deletedAt: UPDATED_AT,
        }],
        deletedItemIds: [ITEM_ID_A],
        deletedItems: [{ id: ITEM_ID_A, revision: 4, deletedAt: UPDATED_AT }],
      }));

    const result = await createService(api, store).synchronize();

    expect(api.pullItems.mock.calls.map((call) => call[0])).toEqual([0, 10]);
    expect(result).toMatchObject({ pulledChanges: 2, serverRevision: 4 });
    expect(await store.getById(ITEM_ID_A)).toBeNull();
    expect((await store.getSyncMetadata()).serverCursor).toBe(11);
  });

  it("preserves the Worker tombstone revision when a pulled deletion conflicts locally", async () => {
    await store.applyPullPage([makeCiphertext(ITEM_ID_A, 3)], [], 3, 10, CREATED_AT);
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 3), 3, MUTATION_ID_A);
    const api = createApi();

    await createService(api, store).applyPullResponse(makePullResponse({
      serverRevision: 9,
      cursor: 11,
      changes: [{
        cursor: 11,
        operation: "delete",
        itemId: ITEM_ID_A,
        revision: 9,
        deletedAt: UPDATED_AT,
      }],
      deletedItemIds: [ITEM_ID_A],
      deletedItems: [{ id: ITEM_ID_A, revision: 9, deletedAt: UPDATED_AT }],
    }));

    expect((await store.listConflicts())[0]).toMatchObject({
      itemId: ITEM_ID_A,
      remoteCiphertextEnvelopeJson: null,
      serverRevision: 9,
      serverItemRevision: 9,
    });
  });

  it("rejects hasMore responses whose cursor does not advance", async () => {
    const api = createApi();
    api.pullItems.mockResolvedValueOnce(makePullResponse({ hasMore: true, cursor: 0 }));

    await expect(createService(api, store).synchronize()).rejects.toThrow(
      "sync_cursor_did_not_advance",
    );
    expect(await store.getSyncMetadata()).toEqual({
      serverRevision: 0,
      serverCursor: 0,
      lastSyncedAt: null,
    });
  });

  it("rejects a regressed server revision without acknowledging the local queue", async () => {
    await store.applyPullPage([], [], 5, 5, UPDATED_AT);
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 0), 0, MUTATION_ID_A);
    const api = createApi();
    api.pushItemLevelSync.mockResolvedValueOnce(appliedResponse(
      ITEM_ID_A,
      MUTATION_ID_A,
      1,
      4,
    ));

    await expect(createService(api, store).synchronize()).rejects.toThrow(
      "sync_server_revision_regressed",
    );
    expect(await store.listPendingMutations()).toHaveLength(1);
    expect((await store.getById(ITEM_ID_A))?.itemRevision).toBe(0);
  });

  it("persists a server conflict while acknowledging an independent mutation", async () => {
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 1), 1, MUTATION_ID_A);
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_B, 0), 0, MUTATION_ID_B);
    const conflict = itemLevelSyncConflictSchema.parse({
      itemId: ITEM_ID_A,
      operation: "upsert",
      reason: "item_revision_advanced",
      clientBaseRevision: 1,
      serverRevision: 7,
      serverItemRevision: 2,
      serverState: { kind: "item", item: makeCiphertext(ITEM_ID_A, 2) },
    });
    const api = createApi();
    api.pushItemLevelSync.mockResolvedValueOnce(syncConflictResponseSchema.parse({
      error: "sync_conflict",
      serverRevision: 7,
      applied: {
        upsertedItemIds: [ITEM_ID_B],
        deletedItemIds: [],
        mutationReceipts: [{
          clientMutationId: MUTATION_ID_B,
          itemId: ITEM_ID_B,
          operation: "upsert",
          appliedItemRevision: 1,
        }],
      },
      conflicts: [conflict],
    }));
    api.pullItems.mockResolvedValueOnce(makePullResponse({ serverRevision: 7 }));

    const result = await createService(api, store).synchronize();

    expect(result).toMatchObject({ pushed: 1, pendingCount: 1, conflictCount: 1 });
    expect((await store.listPendingMutations())[0]?.itemId).toBe(ITEM_ID_A);
    expect((await store.listConflicts())[0]).toMatchObject({
      itemId: ITEM_ID_A,
      status: "UNRESOLVED",
      serverItemRevision: 2,
    });
    expect((await store.getById(ITEM_ID_B))?.itemRevision).toBe(1);
  });

  it("skips an unresolved conflicted item without blocking a later queued item", async () => {
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 1), 1, MUTATION_ID_A);
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_B, 0), 0, MUTATION_ID_B);
    await store.saveConflicts([{
      conflict: itemLevelSyncConflictSchema.parse({
        itemId: ITEM_ID_A,
        operation: "upsert",
        reason: "item_revision_advanced",
        clientBaseRevision: 1,
        serverRevision: 2,
        serverItemRevision: 2,
        serverState: { kind: "item", item: makeCiphertext(ITEM_ID_A, 2) },
      }),
      localCiphertext: makeCiphertext(ITEM_ID_A, 1),
      createdAt: CREATED_AT,
    }]);
    const api = createApi();
    api.pushItemLevelSync.mockResolvedValueOnce(appliedResponse(
      ITEM_ID_B,
      MUTATION_ID_B,
      1,
      3,
    ));
    api.pullItems.mockResolvedValueOnce(makePullResponse({ serverRevision: 3 }));

    await createService(api, store).synchronize();

    const plan = api.pushItemLevelSync.mock.calls[0]?.[1] as ItemLevelSyncPlan;
    expect(plan.upserts.map((item) => item.id)).toEqual([ITEM_ID_B]);
    expect((await store.listPendingMutations()).map((item) => item.itemId)).toEqual([ITEM_ID_A]);
  });
});
