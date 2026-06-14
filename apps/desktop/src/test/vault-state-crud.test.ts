import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useVaultState,
  configureVaultDependencies,
} from "../state/vault-state";
import {
  InMemoryCiphertextStore,
  type DesktopCiphertextStore,
} from "../lib/storage/desktop-ciphertext-store";
import {
  InMemorySecureStore,
  type DesktopSecureStore,
} from "../lib/storage/desktop-secure-store";
import {
  TestDoubleCryptoAdapter,
  type DesktopCryptoAdapter,
} from "../lib/crypto/desktop-crypto-adapter";
import type { DesktopSyncService, SyncResult } from "../lib/sync/desktop-sync-service";
import type { DesktopApiClient } from "../lib/api/desktop-api-client";
import type {
  VaultItem,
  ItemLevelSyncResponse,
} from "@zero-vault/shared";

const TEST_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createTestLoginItem(id: string): VaultItem {
  return {
    id,
    type: "login",
    title: "Test Login",
    origin: "https://example.com",
    username: "user",
    password: "pass",
    folder: "",
    notes: "",
    customFields: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createSuccessResponse(itemId: string): ItemLevelSyncResponse {
  return {
    protocol: "item_level_v1",
    serverRevision: 2,
    applied: {
      upsertedItemIds: [itemId],
      deletedItemIds: [],
    },
    conflicts: [],
  };
}

function createDeleteSuccessResponse(itemId: string): ItemLevelSyncResponse {
  return {
    protocol: "item_level_v1",
    serverRevision: 3,
    applied: {
      upsertedItemIds: [],
      deletedItemIds: [itemId],
    },
    conflicts: [],
  };
}

function createMockApiClient(
  overrides: Partial<DesktopApiClient> = {},
): DesktopApiClient {
  return {
    loginDirect: vi.fn(),
    loginStart: vi.fn(),
    loginFinish: vi.fn(),
    fetchCurrentUser: vi.fn(),
    logout: vi.fn(),
    getBaseUrl: vi.fn().mockReturnValue("http://localhost"),
    pullItems: vi.fn(),
    pushItemLevelSync: vi.fn(),
    createItem: vi.fn().mockResolvedValue(createSuccessResponse("test-id")),
    updateItem: vi.fn().mockResolvedValue(createSuccessResponse("test-id")),
    deleteItem: vi.fn().mockResolvedValue(createDeleteSuccessResponse("test-id")),
    registerDevice: vi.fn(),
    listDevices: vi.fn(),
    approveDevice: vi.fn(),
    revokeDevice: vi.fn(),
    shareVaultKey: vi.fn(),
    uploadRecoveryPacket: vi.fn(),
    downloadRecoveryPacket: vi.fn(),
    ...overrides,
  } as unknown as DesktopApiClient;
}

function createMockSyncService(
  overrides: Partial<DesktopSyncService> = {},
): DesktopSyncService {
  return {
    pullAll: vi.fn<() => Promise<SyncResult>>().mockResolvedValue({
      pulled: 0,
      conflicts: [],
      serverRevision: 1,
    }),
    pushSync: vi.fn(),
    resolveConflict: vi.fn(),
    ...overrides,
  };
}

async function unlockVault(
  secureStore: DesktopSecureStore,
  result: { current: { unlock: (pw: string) => Promise<boolean> } },
) {
  const salt = new Uint8Array([1, 2, 3, 4]);
  const saltB64 = btoa(String.fromCharCode(...salt));
  await secureStore.setItem("vault_salt", saltB64);
  await secureStore.setItem(
    "vault_params",
    JSON.stringify({ memoryKib: 65536, iterations: 3, parallelism: 1 }),
  );

  await act(async () => result.current.unlock("test-password"));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useVaultState — CRUD operations", () => {
  let ciphertextStore: DesktopCiphertextStore;
  let secureStore: DesktopSecureStore;
  let cryptoAdapter: DesktopCryptoAdapter;

  beforeEach(() => {
    ciphertextStore = new InMemoryCiphertextStore();
    secureStore = new InMemorySecureStore();
    cryptoAdapter = new TestDoubleCryptoAdapter();
  });

  function setupDeps(
    apiClientOverrides?: Partial<DesktopApiClient>,
    syncServiceOverrides?: Partial<DesktopSyncService>,
  ) {
    configureVaultDependencies({
      cryptoAdapter,
      ciphertextStore,
      secureStore,
      apiClient: createMockApiClient(apiClientOverrides),
      syncService: createMockSyncService(syncServiceOverrides),
    });
  }

  // ── addItem ─────────────────────────────────────────────────────────────────

  describe("addItem", () => {
    it("encrypts and pushes a new item to the server", async () => {
      const itemId = "11111111-1111-1111-1111-111111111111";
      const item = createTestLoginItem(itemId);
      const createItem = vi.fn().mockResolvedValue(createSuccessResponse(itemId));

      setupDeps({ createItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      expect(createItem).toHaveBeenCalledTimes(1);
      expect(createItem).toHaveBeenCalledWith(
        "test-csrf",
        expect.objectContaining({
          id: itemId,
          ownerUserId: TEST_USER_ID,
          revision: 0,
          baseItemRevision: 0,
          encryptedItemKey: expect.objectContaining({ alg: "XCHACHA20_POLY1305" }),
          encryptedPayload: expect.objectContaining({ alg: "XCHACHA20_POLY1305" }),
        }),
        0,
      );
    });

    it("adds item to local plaintext state after successful push", async () => {
      const itemId = "22222222-2222-2222-2222-222222222222";
      const item = createTestLoginItem(itemId);

      setupDeps({ createItem: vi.fn().mockResolvedValue(createSuccessResponse(itemId)) });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0]!.id).toBe(itemId);
        expect(result.current.items[0]!.title).toBe("Test Login");
      });
    });

    it("stores ciphertext in the ciphertext store", async () => {
      const itemId = "33333333-3333-3333-3333-333333333333";
      const item = createTestLoginItem(itemId);

      setupDeps({ createItem: vi.fn().mockResolvedValue(createSuccessResponse(itemId)) });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      const stored = await ciphertextStore.getById(itemId);
      expect(stored).not.toBeNull();
      expect(stored!.itemId).toBe(itemId);
      expect(stored!.hasConflict).toBe(false);
    });

    it("does nothing when vault is locked", async () => {
      const createItem = vi.fn();
      setupDeps({ createItem });
      const { result } = renderHook(() => useVaultState());

      // Don't unlock
      await act(async () => {
        await result.current.addItem(
          createTestLoginItem("test"),
          "test-csrf",
          TEST_USER_ID,
        );
      });

      expect(createItem).not.toHaveBeenCalled();
      expect(result.current.error).toBe("密码库已锁定，请先解锁");
    });

    it("sets error on network failure", async () => {
      const itemId = "44444444-4444-4444-4444-444444444444";
      const item = createTestLoginItem(itemId);
      const createItem = vi.fn().mockRejectedValue(new Error("network_error"));

      setupDeps({ createItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      expect(result.current.error).toBe("网络错误，请检查连接");
    });

    it("sets error on sync conflict", async () => {
      const itemId = "55555555-5555-5555-5555-555555555555";
      const item = createTestLoginItem(itemId);
      const conflictResponse: ItemLevelSyncResponse = {
        protocol: "item_level_v1",
        serverRevision: 2,
        applied: { upsertedItemIds: [], deletedItemIds: [] },
        conflicts: [
          {
            itemId,
            operation: "upsert",
            reason: "item_revision_advanced",
            clientBaseRevision: 0,
            serverRevision: 2,
            serverItemRevision: 5,
          },
        ],
      };
      const createItem = vi.fn().mockResolvedValue(conflictResponse);

      setupDeps({ createItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      expect(result.current.error).toBe("同步冲突，请手动解决");
    });
  });

  // ── updateItem ──────────────────────────────────────────────────────────────

  describe("updateItem", () => {
    it("encrypts and pushes updated item to the server", async () => {
      const itemId = "66666666-6666-6666-6666-666666666666";
      const item = createTestLoginItem(itemId);
      const updateItem = vi.fn().mockResolvedValue(createSuccessResponse(itemId));

      setupDeps({ updateItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      // Pre-populate ciphertext store with existing item
      await ciphertextStore.upsert({
        itemId,
        ciphertext: {
          id: itemId,
          ownerUserId: TEST_USER_ID,
          revision: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          encryptedItemKey: { alg: "XCHACHA20_POLY1305", nonce: "AA", ciphertext: "AA" },
          encryptedPayload: { alg: "XCHACHA20_POLY1305", nonce: "AA", ciphertext: "AA" },
          encryptedSearchTokens: [],
        },
        itemRevision: 1,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        hasConflict: false,
      });

      const updated = { ...item, title: "Updated Title" };
      await act(async () => {
        await result.current.updateItem(updated, "test-csrf", TEST_USER_ID);
      });

      expect(updateItem).toHaveBeenCalledTimes(1);
      expect(updateItem).toHaveBeenCalledWith(
        "test-csrf",
        expect.objectContaining({
          id: itemId,
          ownerUserId: TEST_USER_ID,
          baseItemRevision: 1,
          revision: 2,
        }),
        0,
      );
    });

    it("updates item in local plaintext state", async () => {
      const itemId = "77777777-7777-7777-7777-777777777777";
      const item = createTestLoginItem(itemId);

      setupDeps({ updateItem: vi.fn().mockResolvedValue(createSuccessResponse(itemId)) });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      // Add item first
      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      // Update it
      const updated = { ...item, title: "New Title", updatedAt: "2026-06-08T00:00:00.000Z" };
      await act(async () => {
        await result.current.updateItem(updated, "test-csrf", TEST_USER_ID);
      });

      await waitFor(() => {
        const found = result.current.items.find((i) => i.id === itemId);
        expect(found).toBeDefined();
        expect(found!.title).toBe("New Title");
      });
    });

    it("does nothing when vault is locked", async () => {
      const updateItem = vi.fn();
      setupDeps({ updateItem });
      const { result } = renderHook(() => useVaultState());

      await act(async () => {
        await result.current.updateItem(
          createTestLoginItem("test"),
          "test-csrf",
          TEST_USER_ID,
        );
      });

      expect(updateItem).not.toHaveBeenCalled();
      expect(result.current.error).toBe("密码库已锁定，请先解锁");
    });

    it("sets error on network failure", async () => {
      const itemId = "88888888-8888-8888-8888-888888888888";
      const item = createTestLoginItem(itemId);
      const updateItem = vi.fn().mockRejectedValue(new Error("network_error"));

      setupDeps({ updateItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      await act(async () => {
        await result.current.updateItem(item, "test-csrf", TEST_USER_ID);
      });

      expect(result.current.error).toBe("网络错误，请检查连接");
    });

    it("sets error on sync conflict", async () => {
      const itemId = "99999999-9999-9999-9999-999999999999";
      const item = createTestLoginItem(itemId);
      const conflictResponse: ItemLevelSyncResponse = {
        protocol: "item_level_v1",
        serverRevision: 5,
        applied: { upsertedItemIds: [], deletedItemIds: [] },
        conflicts: [
          {
            itemId,
            operation: "upsert",
            reason: "server_revision_advanced",
            clientBaseRevision: 1,
            serverRevision: 5,
          },
        ],
      };
      const updateItem = vi.fn().mockResolvedValue(conflictResponse);

      setupDeps({ updateItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      await act(async () => {
        await result.current.updateItem(item, "test-csrf", TEST_USER_ID);
      });

      expect(result.current.error).toBe("同步冲突，请手动解决");
    });
  });

  // ── deleteItem ──────────────────────────────────────────────────────────────

  describe("deleteItem", () => {
    it("pushes delete to the server", async () => {
      const itemId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const deleteItem = vi.fn().mockResolvedValue(createDeleteSuccessResponse(itemId));

      setupDeps({ deleteItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      await act(async () => {
        await result.current.deleteItem(itemId, "test-csrf", TEST_USER_ID);
      });

      expect(deleteItem).toHaveBeenCalledTimes(1);
      expect(deleteItem).toHaveBeenCalledWith(
        "test-csrf",
        itemId,
        0,
        TEST_USER_ID,
        0,
      );
    });

    it("removes item from local plaintext state", async () => {
      const itemId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      const item = createTestLoginItem(itemId);

      setupDeps({
        deleteItem: vi.fn().mockResolvedValue(createDeleteSuccessResponse(itemId)),
      });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      // Add item first
      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      expect(result.current.items).toHaveLength(1);

      // Delete it
      await act(async () => {
        await result.current.deleteItem(itemId, "test-csrf", TEST_USER_ID);
      });

      await waitFor(() => {
        expect(result.current.items).toHaveLength(0);
      });
    });

    it("removes item from ciphertext store", async () => {
      const itemId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const item = createTestLoginItem(itemId);

      setupDeps({
        deleteItem: vi.fn().mockResolvedValue(createDeleteSuccessResponse(itemId)),
      });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      // Add item first
      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      const storedBefore = await ciphertextStore.getById(itemId);
      expect(storedBefore).not.toBeNull();

      // Delete it
      await act(async () => {
        await result.current.deleteItem(itemId, "test-csrf", TEST_USER_ID);
      });

      const storedAfter = await ciphertextStore.getById(itemId);
      expect(storedAfter).toBeNull();
    });

    it("does nothing when vault is locked", async () => {
      const deleteItem = vi.fn();
      setupDeps({ deleteItem });
      const { result } = renderHook(() => useVaultState());

      await act(async () => {
        await result.current.deleteItem("test-id", "test-csrf", TEST_USER_ID);
      });

      expect(deleteItem).not.toHaveBeenCalled();
      expect(result.current.error).toBe("密码库已锁定，请先解锁");
    });

    it("sets error on network failure", async () => {
      const itemId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
      const deleteItem = vi.fn().mockRejectedValue(new Error("network_error"));

      setupDeps({ deleteItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      await act(async () => {
        await result.current.deleteItem(itemId, "test-csrf", TEST_USER_ID);
      });

      expect(result.current.error).toBe("网络错误，请检查连接");
    });

    it("sets error on sync conflict", async () => {
      const itemId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
      const conflictResponse: ItemLevelSyncResponse = {
        protocol: "item_level_v1",
        serverRevision: 3,
        applied: { upsertedItemIds: [], deletedItemIds: [] },
        conflicts: [
          {
            itemId,
            operation: "delete",
            reason: "item_revision_advanced",
            clientBaseRevision: 0,
            serverRevision: 3,
            serverItemRevision: 2,
          },
        ],
      };
      const deleteItem = vi.fn().mockResolvedValue(conflictResponse);

      setupDeps({ deleteItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      await act(async () => {
        await result.current.deleteItem(itemId, "test-csrf", TEST_USER_ID);
      });

      expect(result.current.error).toBe("同步冲突，请手动解决");
    });

    it("uses current revision from ciphertext store", async () => {
      const itemId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      const item = createTestLoginItem(itemId);
      const deleteItem = vi.fn().mockResolvedValue(createDeleteSuccessResponse(itemId));

      setupDeps({ deleteItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      // Add item (which stores it with revision from server response)
      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      // Delete — should use the stored revision
      await act(async () => {
        await result.current.deleteItem(itemId, "test-csrf", TEST_USER_ID);
      });

      expect(deleteItem).toHaveBeenCalledWith(
        "test-csrf",
        itemId,
        expect.any(Number),
        TEST_USER_ID,
        expect.any(Number),
      );
      const calledRevision = (deleteItem as ReturnType<typeof vi.fn>).mock.calls[0]![2];
      expect(calledRevision).toBeGreaterThan(0);
    });
  });
});
