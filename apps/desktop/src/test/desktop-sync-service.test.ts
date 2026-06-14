import { describe, it, expect, beforeEach } from "vitest";
import {
  DesktopSyncServiceImpl,
  type SyncResult,
} from "../lib/sync/desktop-sync-service";
import {
  InMemoryCiphertextStore,
  type DesktopCiphertextStore,
  type StoredItem,
} from "../lib/storage/desktop-ciphertext-store";
import {
  TestDoubleCryptoAdapter,
  type DesktopCryptoAdapter,
} from "../lib/crypto/desktop-crypto-adapter";
import type { DesktopApiClient } from "../lib/api/desktop-api-client";
import type {
  ItemLevelSyncPullResponse,
  ItemLevelSyncPlan,
  ItemLevelSyncResponse,
  VaultItem,
  ItemLevelEncryptedUpsert,
} from "@zero-vault/shared";

// ── Mock API client ───────────────────────────────────────────────────────────

function createMockApiClient(
  overrides: Partial<DesktopApiClient> = {},
): DesktopApiClient {
  return {
    pullItems: async () => ({
      serverRevision: 1,
      items: [],
      deletedItemIds: [],
    }),
    pushItemLevelSync: async () => ({
      protocol: "item_level_v1" as const,
      serverRevision: 1,
      applied: { upsertedItemIds: [], deletedItemIds: [] },
      conflicts: [],
    }),
    ...overrides,
  } as DesktopApiClient;
}

function makeStoredCiphertext(itemId: string, revision = 1) {
  const b64 = btoa(JSON.stringify({ id: itemId, title: "test" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const nonce = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  return {
    id: itemId,
    ownerUserId: "00000000-0000-0000-0000-000000000001",
    revision,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    encryptedItemKey: {
      alg: "XCHACHA20_POLY1305" as const,
      nonce,
      ciphertext: b64,
    },
    encryptedPayload: {
      alg: "XCHACHA20_POLY1305" as const,
      nonce,
      ciphertext: b64,
    },
    encryptedSearchTokens: [],
  };
}

function makeVaultItem(itemId: string, title = "test"): VaultItem {
  return {
    id: itemId,
    type: "login",
    title,
    folder: "",
    notes: "",
    customFields: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    origin: "https://example.com",
    username: "user",
    password: "pass",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DesktopSyncServiceImpl", () => {
  let store: DesktopCiphertextStore;
  let crypto: DesktopCryptoAdapter;
  let service: DesktopSyncServiceImpl;

  beforeEach(() => {
    store = new InMemoryCiphertextStore();
    crypto = new TestDoubleCryptoAdapter();
  });

  // ── pullAll ─────────────────────────────────────────────────────────────────

  describe("pullAll", () => {
    it("stores pulled items in the ciphertext store", async () => {
      const item = makeStoredCiphertext(
        "11111111-1111-1111-1111-111111111111",
      );
      const api = createMockApiClient({
        pullItems: async () => ({
          serverRevision: 5,
          items: [item],
          deletedItemIds: [],
        }),
      });
      service = new DesktopSyncServiceImpl(api, store, crypto);

      const result = await service.pullAll();

      expect(result.pulled).toBe(1);
      expect(result.serverRevision).toBe(5);

      const stored = await store.getById(
        "11111111-1111-1111-1111-111111111111",
      );
      expect(stored).not.toBeNull();
      expect(stored!.itemRevision).toBe(1);
    });

    it("deletes items listed in deletedItemIds", async () => {
      const existingId = "22222222-2222-2222-2222-222222222222";
      await store.upsert({
        itemId: existingId,
        ciphertext: makeStoredCiphertext(existingId),
        itemRevision: 1,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        hasConflict: false,
        conflictServerItemRevision: undefined,
      });

      const api = createMockApiClient({
        pullItems: async () => ({
          serverRevision: 2,
          items: [],
          deletedItemIds: [existingId],
        }),
      });
      service = new DesktopSyncServiceImpl(api, store, crypto);

      const result = await service.pullAll();

      expect(result.pulled).toBe(0);
      expect(await store.getById(existingId)).toBeNull();
    });

    it("updates the server revision after pull", async () => {
      const api = createMockApiClient({
        pullItems: async () => ({
          serverRevision: 42,
          items: [],
          deletedItemIds: [],
        }),
      });
      service = new DesktopSyncServiceImpl(api, store, crypto);

      await service.pullAll();

      expect(await store.getServerRevision()).toBe(42);
    });

    it("sets lastSyncedAt after pull", async () => {
      service = new DesktopSyncServiceImpl(
        createMockApiClient(),
        store,
        crypto,
      );

      await service.pullAll();

      const ts = await store.getLastSyncedAt();
      expect(ts).not.toBeNull();
      expect(new Date(ts!).toISOString()).toBe(ts);
    });

    it("passes current revision to the API client", async () => {
      let receivedRevision: number | undefined;
      const api = createMockApiClient({
        pullItems: async (rev?: number) => {
          receivedRevision = rev;
          return {
            serverRevision: 10,
            items: [],
            deletedItemIds: [],
          };
        },
      });
      service = new DesktopSyncServiceImpl(api, store, crypto);

      await store.setServerRevision(7);
      await service.pullAll();

      expect(receivedRevision).toBe(7);
    });

    it("passes undefined when current revision is 0", async () => {
      let receivedRevision: number | undefined;
      const api = createMockApiClient({
        pullItems: async (rev?: number) => {
          receivedRevision = rev;
          return {
            serverRevision: 1,
            items: [],
            deletedItemIds: [],
          };
        },
      });
      service = new DesktopSyncServiceImpl(api, store, crypto);

      await service.pullAll();

      expect(receivedRevision).toBeUndefined();
    });

    it("returns empty conflicts when server returns no conflicts", async () => {
      service = new DesktopSyncServiceImpl(
        createMockApiClient(),
        store,
        crypto,
      );

      const result = await service.pullAll();

      expect(result.conflicts).toEqual([]);
    });
  });

  // ── pushSync ────────────────────────────────────────────────────────────────

  describe("pushSync", () => {
    it("delegates to apiClient.pushItemLevelSync", async () => {
      const plan: ItemLevelSyncPlan = {
        protocol: "item_level_v1",
        baseRevision: 0,
        upserts: [],
        deletes: [],
      };
      const expectedResponse: ItemLevelSyncResponse = {
        protocol: "item_level_v1",
        serverRevision: 3,
        applied: {
          upsertedItemIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
          deletedItemIds: [],
        },
        conflicts: [],
      };

      let receivedCsrf: string | undefined;
      let receivedPlan: ItemLevelSyncPlan | undefined;

      const api = createMockApiClient({
        pushItemLevelSync: async (
          csrf: string,
          p: ItemLevelSyncPlan,
        ): Promise<ItemLevelSyncResponse> => {
          receivedCsrf = csrf;
          receivedPlan = p;
          return expectedResponse;
        },
      });
      service = new DesktopSyncServiceImpl(api, store, crypto);

      const result = await service.pushSync("test-csrf-token", plan);

      expect(receivedCsrf).toBe("test-csrf-token");
      expect(receivedPlan).toBe(plan);
      expect(result).toBe(expectedResponse);
    });
  });

  // ── resolveConflict ─────────────────────────────────────────────────────────

  describe("resolveConflict", () => {
    function makeResolveOptions(
      itemId: string,
      title = "local-title",
    ): {
      localItem: VaultItem;
      vaultKey: Uint8Array;
      csrfToken: string;
      ownerUserId: string;
    } {
      return {
        localItem: makeVaultItem(itemId, title),
        vaultKey: new Uint8Array(32),
        csrfToken: "test-csrf-token",
        ownerUserId: "00000000-0000-0000-0000-000000000001",
      };
    }

    it("removes the item from conflict IDs", async () => {
      const itemId = "33333333-3333-3333-3333-333333333333";
      await store.setConflictIds(new Set([itemId]));

      service = new DesktopSyncServiceImpl(
        createMockApiClient(),
        store,
        crypto,
      );

      await service.resolveConflict(itemId, "keep_local", makeResolveOptions(itemId));

      const conflicts = await store.getConflictIds();
      expect(conflicts.has(itemId)).toBe(false);
    });

    it("clears hasConflict flag on the stored item", async () => {
      const itemId = "44444444-4444-4444-4444-444444444444";
      await store.upsert({
        itemId,
        ciphertext: makeStoredCiphertext(itemId),
        itemRevision: 1,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        hasConflict: true,
        conflictServerItemRevision: undefined,
      });
      await store.setConflictIds(new Set([itemId]));

      service = new DesktopSyncServiceImpl(
        createMockApiClient(),
        store,
        crypto,
      );

      await service.resolveConflict(itemId, "accept_remote", makeResolveOptions(itemId));

      const stored = await store.getById(itemId);
      expect(stored!.hasConflict).toBe(false);
    });

    it("does not throw when item does not exist in store", async () => {
      service = new DesktopSyncServiceImpl(
        createMockApiClient(),
        store,
        crypto,
      );

      await expect(
        service.resolveConflict(
          "55555555-5555-5555-5555-555555555555",
          "skip",
          makeResolveOptions("55555555-5555-5555-5555-555555555555"),
        ),
      ).resolves.toEqual({});
    });

    it("keep_local re-encrypts and pushes the local item", async () => {
      const itemId = "77777777-7777-7777-7777-777777777777";
      await store.upsert({
        itemId,
        ciphertext: makeStoredCiphertext(itemId, 5),
        itemRevision: 5,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        hasConflict: true,
        conflictServerItemRevision: 7,
      });
      await store.setConflictIds(new Set([itemId]));
      await store.setServerRevision(10);

      let receivedPlan: ItemLevelSyncPlan | undefined;
      const api = createMockApiClient({
        pushItemLevelSync: async (_csrf: string, plan: ItemLevelSyncPlan) => {
          receivedPlan = plan;
          return {
            protocol: "item_level_v1" as const,
            serverRevision: 11,
            applied: { upsertedItemIds: [itemId], deletedItemIds: [] },
            conflicts: [],
          };
        },
      });
      service = new DesktopSyncServiceImpl(api, store, crypto);

      await service.resolveConflict(itemId, "keep_local", makeResolveOptions(itemId));

      expect(receivedPlan).toBeDefined();
      expect(receivedPlan!.baseRevision).toBe(10);
      expect(receivedPlan!.upserts).toHaveLength(1);
      const upsert = receivedPlan!.upserts[0]!;
      expect(upsert.id).toBe(itemId);
      expect(upsert.baseItemRevision).toBe(7);
      expect(upsert.revision).toBe(8);

      const stored = await store.getById(itemId);
      expect(stored!.hasConflict).toBe(false);
      expect(stored!.itemRevision).toBe(11);
      expect(stored!.conflictServerItemRevision).toBeUndefined();
    });

    it("keep_local preserves conflict if server still conflicts", async () => {
      const itemId = "88888888-8888-8888-8888-888888888888";
      await store.upsert({
        itemId,
        ciphertext: makeStoredCiphertext(itemId, 5),
        itemRevision: 5,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        hasConflict: true,
        conflictServerItemRevision: 7,
      });
      await store.setConflictIds(new Set([itemId]));

      const api = createMockApiClient({
        pushItemLevelSync: async () => ({
          protocol: "item_level_v1" as const,
          serverRevision: 12,
          applied: { upsertedItemIds: [], deletedItemIds: [] },
          conflicts: [
            {
              itemId,
              operation: "upsert" as const,
              reason: "server_revision_advanced" as const,
              clientBaseRevision: 10,
              serverRevision: 12,
              serverItemRevision: 8,
            },
          ],
        }),
      });
      service = new DesktopSyncServiceImpl(api, store, crypto);

      await service.resolveConflict(itemId, "keep_local", makeResolveOptions(itemId));

      const conflicts = await store.getConflictIds();
      expect(conflicts.has(itemId)).toBe(true);
      const stored = await store.getById(itemId);
      expect(stored!.hasConflict).toBe(true);
      expect(stored!.conflictServerItemRevision).toBe(8);
    });

    it("create_copy clones the item with a new id and pushes it", async () => {
      const itemId = "66666666-6666-6666-6666-666666666666";
      await store.upsert({
        itemId,
        ciphertext: makeStoredCiphertext(itemId, 3),
        itemRevision: 3,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        hasConflict: true,
        conflictServerItemRevision: undefined,
      });
      await store.setConflictIds(new Set([itemId]));
      await store.setServerRevision(10);

      let receivedPlan: ItemLevelSyncPlan | undefined;
      const api = createMockApiClient({
        pushItemLevelSync: async (_csrf: string, plan: ItemLevelSyncPlan) => {
          receivedPlan = plan;
          return {
            protocol: "item_level_v1" as const,
            serverRevision: 11,
            applied: { upsertedItemIds: plan.upserts.map((u) => u.id), deletedItemIds: [] },
            conflicts: [],
          };
        },
      });
      service = new DesktopSyncServiceImpl(api, store, crypto);

      const result = await service.resolveConflict(itemId, "create_copy", makeResolveOptions(itemId));

      expect(result.clonedItemId).toBeDefined();
      expect(result.clonedItemId).not.toBe(itemId);
      expect(receivedPlan).toBeDefined();
      expect(receivedPlan!.upserts).toHaveLength(1);
      const upsert = receivedPlan!.upserts[0]!;
      expect(upsert.id).toBe(result.clonedItemId);
      expect(upsert.baseItemRevision).toBe(0);
      expect(upsert.revision).toBe(0);

      const conflicts = await store.getConflictIds();
      expect(conflicts.has(itemId)).toBe(false);

      const original = await store.getById(itemId);
      expect(original!.hasConflict).toBe(false);

      const clone = await store.getById(result.clonedItemId!);
      expect(clone).not.toBeNull();
      expect(clone!.hasConflict).toBe(false);
      expect(clone!.itemRevision).toBe(11);
    });
  });
});
