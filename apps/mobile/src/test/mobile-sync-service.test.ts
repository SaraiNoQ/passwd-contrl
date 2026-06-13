import { describe, it, expect, vi, beforeEach } from "vitest";
import { MobileSyncService } from "../lib/sync/mobile-sync-service";
import { InMemoryCiphertextStore } from "../lib/storage/mobile-ciphertext-store";
import type { MobileApiClient } from "../lib/api/mobile-api-client";
import type { ItemLevelSyncPullResponse } from "@zero-vault/shared";

function makeMockApiClient(response: ItemLevelSyncPullResponse): MobileApiClient {
  return {
    pullItems: vi.fn().mockResolvedValue(response),
  } as unknown as MobileApiClient;
}

describe("MobileSyncService", () => {
  let store: InMemoryCiphertextStore;

  beforeEach(() => {
    store = new InMemoryCiphertextStore();
  });

  it("should store pulled items", async () => {
    const pullResponse: ItemLevelSyncPullResponse = {
      serverRevision: 5,
      items: [
        {
          id: "item-1",
          ownerUserId: "user-1",
          revision: 1,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          encryptedItemKey: { alg: "XCHACHA20_POLY1305", nonce: "AA", ciphertext: "AA" },
          encryptedPayload: { alg: "XCHACHA20_POLY1305", nonce: "AA", ciphertext: "AA" },
          encryptedSearchTokens: [],
        },
      ],
      deletedItemIds: [],
    };

    const apiClient = makeMockApiClient(pullResponse);
    const service = new MobileSyncService(apiClient, store);

    const result = await service.pullAll();

    expect(result.itemsStored).toBe(1);
    expect(result.serverRevision).toBe(5);

    const stored = await store.getById("item-1");
    expect(stored).not.toBeNull();
  });

  it("should handle deleted items", async () => {
    // First, add an item
    await store.upsert({
      itemId: "item-to-delete",
      ciphertext: {
        id: "item-to-delete",
        ownerUserId: "user-1",
        revision: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        encryptedItemKey: { alg: "XCHACHA20_POLY1305", nonce: "AA", ciphertext: "AA" },
        encryptedPayload: { alg: "XCHACHA20_POLY1305", nonce: "AA", ciphertext: "AA" },
        encryptedSearchTokens: [],
      },
      itemRevision: 1,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      hasConflict: false,
    });

    const pullResponse: ItemLevelSyncPullResponse = {
      serverRevision: 2,
      items: [],
      deletedItemIds: ["item-to-delete"],
    };

    const apiClient = makeMockApiClient(pullResponse);
    const service = new MobileSyncService(apiClient, store);

    await service.pullAll();

    const deleted = await store.getById("item-to-delete");
    expect(deleted).toBeNull();
  });

  it("should mark conflicts", async () => {
    const apiClient = makeMockApiClient({
      serverRevision: 0,
      items: [],
      deletedItemIds: [],
    });
    const service = new MobileSyncService(apiClient, store);

    await service.markConflicts(["c1", "c2"]);
    const conflicts = await store.getConflictIds();
    expect(conflicts.size).toBe(2);
    expect(conflicts.has("c1")).toBe(true);
  });
});
