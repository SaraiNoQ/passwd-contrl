import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
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
import type { VaultItem, ItemLevelSyncResponse } from "@zero-vault/shared";
import {
  enqueueOfflineMutation,
  dequeueOfflineMutations,
  hasOfflineMutations,
  peekAllEntries,
  clearOfflineQueue,
} from "../lib/offline-queue";

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

function createConflictResponse(itemId: string): ItemLevelSyncResponse {
  return {
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

function setupStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  };
  const win = {
    localStorage: ls,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", ls);
  return store;
}

function assertOk<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useVaultState — pushOfflineQueue", () => {
  let ciphertextStore: DesktopCiphertextStore;
  let secureStore: DesktopSecureStore;
  let cryptoAdapter: DesktopCryptoAdapter;
  let store: Map<string, string>;

  beforeEach(() => {
    ciphertextStore = new InMemoryCiphertextStore();
    secureStore = new InMemorySecureStore();
    cryptoAdapter = new TestDoubleCryptoAdapter();
    store = setupStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  // ── success ─────────────────────────────────────────────────────────────────

  describe("success", () => {
    it("processes an upsert entry and updates the ciphertext store", async () => {
      const itemId = "11111111-1111-1111-1111-111111111111";
      const updateItem = vi.fn().mockResolvedValue(createSuccessResponse(itemId));

      setupDeps({ updateItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      // Pre-populate the vault with an item so it exists in items state
      const item = createTestLoginItem(itemId);
      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      // Enqueue an upsert for the item
      enqueueOfflineMutation({
        type: "upsert",
        itemId,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });

      const queueResult = await act(async () =>
        result.current.pushOfflineQueue("test-csrf", TEST_USER_ID),
      );

      expect(queueResult.ok).toBe(true);
      expect(assertOk(queueResult)).toEqual({ processed: 1, requeued: 0 });
      expect(updateItem).toHaveBeenCalledTimes(1);
      expect(hasOfflineMutations()).toBe(false);
    });

    it("processes a delete entry and removes from ciphertext store", async () => {
      const itemId = "22222222-2222-2222-2222-222222222222";
      const deleteItem = vi.fn().mockResolvedValue(createDeleteSuccessResponse(itemId));

      setupDeps({ deleteItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      // Add item first
      const item = createTestLoginItem(itemId);
      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      // Enqueue a delete
      enqueueOfflineMutation({
        type: "delete",
        itemId,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });

      const queueResult = await act(async () =>
        result.current.pushOfflineQueue("test-csrf", TEST_USER_ID),
      );

      expect(queueResult.ok).toBe(true);
      expect(assertOk(queueResult)).toEqual({ processed: 1, requeued: 0 });
      expect(deleteItem).toHaveBeenCalledTimes(1);

      const stored = await ciphertextStore.getById(itemId);
      expect(stored).toBeNull();
      expect(hasOfflineMutations()).toBe(false);
    });

    it("skips upserts for items no longer in plaintext state", async () => {
      const itemId = "33333333-3333-3333-3333-333333333333";
      const updateItem = vi.fn().mockResolvedValue(createSuccessResponse(itemId));

      setupDeps({ updateItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      // Enqueue an upsert for an item that was never added locally
      enqueueOfflineMutation({
        type: "upsert",
        itemId,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });

      const queueResult = await act(async () =>
        result.current.pushOfflineQueue("test-csrf", TEST_USER_ID),
      );

      expect(queueResult.ok).toBe(true);
      expect(assertOk(queueResult)).toEqual({ processed: 1, requeued: 0 });
      expect(updateItem).not.toHaveBeenCalled();
      expect(hasOfflineMutations()).toBe(false);
    });
  });

  // ── network error re-enqueue ────────────────────────────────────────────────

  describe("network error", () => {
    it("re-enqueues an upsert that fails with network_error", async () => {
      const itemId = "44444444-4444-4444-4444-444444444444";
      const updateItem = vi.fn().mockRejectedValue(new Error("network_error"));

      setupDeps({ updateItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      const item = createTestLoginItem(itemId);
      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      enqueueOfflineMutation({
        type: "upsert",
        itemId,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });

      const queueResult = await act(async () =>
        result.current.pushOfflineQueue("test-csrf", TEST_USER_ID),
      );

      expect(queueResult.ok).toBe(true);
      expect(assertOk(queueResult)).toEqual({ processed: 0, requeued: 1 });
      expect(updateItem).toHaveBeenCalledTimes(1);

      // Entry should be back in the queue
      const entries = peekAllEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.itemId).toBe(itemId);
    });

    it("re-enqueues a delete that fails with network_error", async () => {
      const itemId = "55555555-5555-5555-5555-555555555555";
      const deleteItem = vi.fn().mockRejectedValue(new Error("network_error"));

      setupDeps({ deleteItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      const item = createTestLoginItem(itemId);
      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      enqueueOfflineMutation({
        type: "delete",
        itemId,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });

      const queueResult = await act(async () =>
        result.current.pushOfflineQueue("test-csrf", TEST_USER_ID),
      );

      expect(queueResult.ok).toBe(true);
      expect(assertOk(queueResult)).toEqual({ processed: 0, requeued: 1 });
      expect(deleteItem).toHaveBeenCalledTimes(1);

      const entries = peekAllEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.itemId).toBe(itemId);
    });
  });

  // ── conflict not re-enqueued ────────────────────────────────────────────────

  describe("conflict", () => {
    it("marks conflict locally and does not re-enqueue the entry", async () => {
      const itemId = "66666666-6666-6666-6666-666666666666";
      const updateItem = vi.fn().mockResolvedValue(createConflictResponse(itemId));

      setupDeps({ updateItem });
      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      const item = createTestLoginItem(itemId);
      await act(async () => {
        await result.current.addItem(item, "test-csrf", TEST_USER_ID);
      });

      enqueueOfflineMutation({
        type: "upsert",
        itemId,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });

      const queueResult = await act(async () =>
        result.current.pushOfflineQueue("test-csrf", TEST_USER_ID),
      );

      expect(queueResult.ok).toBe(true);
      expect(assertOk(queueResult)).toEqual({ processed: 1, requeued: 0 });
      expect(updateItem).toHaveBeenCalledTimes(1);

      // Queue should be empty
      expect(hasOfflineMutations()).toBe(false);

      // Conflict should be marked in the ciphertext store
      const conflictIds = await ciphertextStore.getConflictIds();
      expect(conflictIds.has(itemId)).toBe(true);

      const stored = await ciphertextStore.getById(itemId);
      expect(stored).not.toBeNull();
      expect(stored!.hasConflict).toBe(true);
    });
  });

  // ── locked / no client ────────────────────────────────────────────────────

  describe("preconditions", () => {
    it("returns error when vault is locked", async () => {
      setupDeps();
      const { result } = renderHook(() => useVaultState());

      // Do not unlock
      const queueResult = await act(async () =>
        result.current.pushOfflineQueue("test-csrf", TEST_USER_ID),
      );

      expect(queueResult.ok).toBe(false);
      expect((queueResult as { ok: false; error: string }).error).toBe("密码库已锁定，请先解锁");
    });

    it("returns error when api client is not configured", async () => {
      configureVaultDependencies({
        cryptoAdapter,
        ciphertextStore,
        secureStore,
        apiClient: null as unknown as DesktopApiClient,
        syncService: createMockSyncService(),
      });

      const { result } = renderHook(() => useVaultState());

      await unlockVault(secureStore, result);

      const queueResult = await act(async () =>
        result.current.pushOfflineQueue("test-csrf", TEST_USER_ID),
      );

      expect(queueResult.ok).toBe(false);
      expect((queueResult as { ok: false; error: string }).error).toBe("API 客户端未配置");
    });
  });
});
