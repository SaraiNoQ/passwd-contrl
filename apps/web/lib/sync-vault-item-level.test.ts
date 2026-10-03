import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemLevelSyncPlan } from "@zero-vault/shared";
import type { UnlockedVault } from "./local-vault";

vi.mock("./item-sync", () => ({
  buildItemLevelSyncPlan: vi.fn(),
  extractConflicts: vi.fn((response) => response.conflicts ?? [])
}));

const { buildItemLevelSyncPlan } = await import("./item-sync");
const { performItemLevelSync } = await import("./sync-vault");

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: storage }
});

const itemOne = "10000000-0000-4000-8000-000000000001";
const itemTwo = "10000000-0000-4000-8000-000000000002";
const mutationOne = "20000000-0000-4000-8000-000000000001";
const mutationTwo = "20000000-0000-4000-8000-000000000002";
const emptyPlan: ItemLevelSyncPlan = {
  protocol: "item_level_v1",
  baseRevision: 0,
  upserts: [],
  deletes: []
};

describe("performItemLevelSync durable acknowledgements", () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
  });

  it("persists caller-generated mutation ids before an uncertain network result", async () => {
    const pendingMutations = {
      [itemOne]: {
        itemUpdatedAt: "2026-07-16T00:00:00.000Z",
        clientMutationId: mutationOne
      }
    };
    vi.mocked(buildItemLevelSyncPlan).mockResolvedValue({
      plan: emptyPlan,
      itemInfos: [{ itemId: itemOne, status: "pending", revision: undefined }],
      pendingMutations
    });

    await expect(performItemLevelSync(
      {} as UnlockedVault,
      "30000000-0000-4000-8000-000000000001",
      async () => {
        expect(JSON.parse(storage.getItem("zero-vault.local.pending-item-mutations.v1")!))
          .toEqual(pendingMutations);
        throw new Error("response_lost");
      }
    )).rejects.toThrow("response_lost");

    expect(JSON.parse(storage.getItem("zero-vault.local.pending-item-mutations.v1")!))
      .toEqual(pendingMutations);
  });

  it("clears only applied mutation ids and preserves conflict work after a partial ack", async () => {
    vi.mocked(buildItemLevelSyncPlan).mockResolvedValue({
      plan: emptyPlan,
      itemInfos: [
        { itemId: itemOne, status: "pending", revision: undefined },
        { itemId: itemTwo, status: "pending", revision: undefined }
      ],
      pendingMutations: {
        [itemOne]: {
          itemUpdatedAt: "2026-07-16T00:00:00.000Z",
          clientMutationId: mutationOne
        },
        [itemTwo]: {
          itemUpdatedAt: "2026-07-16T00:00:00.000Z",
          clientMutationId: mutationTwo
        }
      }
    });

    const result = await performItemLevelSync(
      {} as UnlockedVault,
      "30000000-0000-4000-8000-000000000001",
      async () => ({
        protocol: "item_level_v1",
        serverRevision: 7,
        applied: {
          upsertedItemIds: [itemOne],
          deletedItemIds: [],
          mutationReceipts: [{
            clientMutationId: mutationOne,
            itemId: itemOne,
            operation: "upsert",
            appliedItemRevision: 6
          }]
        },
        conflicts: [{
          itemId: itemTwo,
          operation: "upsert",
          reason: "item_revision_advanced",
          clientBaseRevision: 1,
          serverRevision: 7,
          serverItemRevision: 6,
          serverState: { kind: "missing" }
        }]
      })
    );

    expect(result.protocol).toBe("item_level_v1");
    if (result.protocol !== "item_level_v1") throw new Error("unexpected legacy result");
    expect(result.hasConflicts).toBe(true);
    expect(result.itemInfos).toEqual([
      { itemId: itemOne, status: "synced", revision: 6 },
      { itemId: itemTwo, status: "conflict", revision: undefined }
    ]);
    expect(JSON.parse(storage.getItem("zero-vault.local.item-revisions.v1")!))
      .toEqual({ [itemOne]: 6 });
    expect(JSON.parse(storage.getItem("zero-vault.local.pending-item-mutations.v1")!))
      .toEqual({
        [itemTwo]: {
          itemUpdatedAt: "2026-07-16T00:00:00.000Z",
          clientMutationId: mutationTwo
        }
      });
    expect(JSON.parse(storage.getItem("zero-vault.local.conflict-ids.v1")!))
      .toEqual([itemTwo]);
    expect(storage.getItem("zero-vault.local.sync-revision.v1")).toBe("7");
  });
});
