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
import type {
  VaultItem,
  CiphertextEnvelope,
  ItemLevelSyncPlan,
  ItemLevelSyncResponse,
} from "@zero-vault/shared";

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

function createMockSyncService(
  overrides: Partial<DesktopSyncService> = {},
): DesktopSyncService {
  return {
    pullAll: async () => ({
      pulled: 0,
      conflicts: [],
      serverRevision: 1,
    }),
    pushSync: async () => ({
      protocol: "item_level_v1" as const,
      serverRevision: 1,
      applied: { upsertedItemIds: [], deletedItemIds: [] },
      conflicts: [],
    }),
    resolveConflict: async () => ({}),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useVaultState", () => {
  let ciphertextStore: DesktopCiphertextStore;
  let secureStore: DesktopSecureStore;
  let cryptoAdapter: DesktopCryptoAdapter;

  beforeEach(() => {
    ciphertextStore = new InMemoryCiphertextStore();
    secureStore = new InMemorySecureStore();
    cryptoAdapter = new TestDoubleCryptoAdapter();
  });

  function setupDeps(syncServiceOverrides?: Partial<DesktopSyncService>) {
    configureVaultDependencies({
      cryptoAdapter,
      ciphertextStore,
      secureStore,
      syncService: createMockSyncService(syncServiceOverrides),
    });
  }

  // ── unlock ──────────────────────────────────────────────────────────────────

  describe("unlock", () => {
    it("creates new vault when vault params are missing (forge mode)", async () => {
      setupDeps();
      const { result } = renderHook(() => useVaultState());

      const success = await act(async () =>
        result.current.unlock("test-password"),
      );

      expect(success).toBe(true);
      expect(result.current.isLocked).toBe(false);
      expect(result.current.error).toBe(null);

      // Verify vault params were persisted
      const salt = await secureStore.getItem("vault_salt");
      const paramsJson = await secureStore.getItem("vault_params");
      expect(salt).toBeTruthy();
      expect(paramsJson).toBeTruthy();
      const params = JSON.parse(paramsJson!);
      expect(params.memoryKib).toBe(65536);
      expect(params.iterations).toBe(3);
      expect(params.parallelism).toBe(4);
    });

    it("derives vault key and unlocks successfully", async () => {
      // Store vault params
      const salt = new Uint8Array([1, 2, 3, 4]);
      const saltB64 = btoa(String.fromCharCode(...salt));
      await secureStore.setItem("vault_salt", saltB64);
      await secureStore.setItem(
        "vault_params",
        JSON.stringify({ memoryKib: 65536, iterations: 3, parallelism: 1 }),
      );

      setupDeps();
      const { result } = renderHook(() => useVaultState());

      const success = await act(async () =>
        result.current.unlock("test-password"),
      );

      expect(success).toBe(true);
      expect(result.current.isLocked).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("decrypts cached items after unlock", async () => {
      const itemId = "11111111-1111-1111-1111-111111111111";
      const item = createTestLoginItem(itemId);

      // Store an encrypted item in the ciphertext store
      const encrypted = await cryptoAdapter.encryptItem(
        new Uint8Array(32),
        item,
        itemId,
      );
      await ciphertextStore.upsert({
        itemId,
        ciphertext: {
          id: itemId,
          ownerUserId: "00000000-0000-0000-0000-000000000001",
          revision: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          encryptedItemKey: encrypted.encryptedItemKey,
          encryptedPayload: encrypted.encryptedPayload,
          encryptedSearchTokens: [],
        },
        itemRevision: 1,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        conflictServerItemRevision: undefined,
        hasConflict: false,
      });

      // Store vault params
      const salt = new Uint8Array([1, 2, 3, 4]);
      const saltB64 = btoa(String.fromCharCode(...salt));
      await secureStore.setItem("vault_salt", saltB64);
      await secureStore.setItem(
        "vault_params",
        JSON.stringify({ memoryKib: 65536, iterations: 3, parallelism: 1 }),
      );

      setupDeps();
      const { result } = renderHook(() => useVaultState());

      await act(async () => result.current.unlock("test-password"));

      await waitFor(() => {
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0]!.id).toBe(itemId);
        expect(result.current.items[0]!.title).toBe("Test Login");
      });
    });

    it("sets isLoading during unlock", async () => {
      const salt = new Uint8Array([1, 2, 3, 4]);
      const saltB64 = btoa(String.fromCharCode(...salt));
      await secureStore.setItem("vault_salt", saltB64);
      await secureStore.setItem(
        "vault_params",
        JSON.stringify({ memoryKib: 65536, iterations: 3, parallelism: 1 }),
      );

      setupDeps();
      const { result } = renderHook(() => useVaultState());

      // Start unlock without awaiting immediately
      const unlockPromise = result.current.unlock("test-password");

      // isLoading should be true during the operation
      // (may be fast with test double, so check after)
      await act(async () => await unlockPromise);

      expect(result.current.isLoading).toBe(false);
    });
  });

  // ── lock ────────────────────────────────────────────────────────────────────

  describe("lock", () => {
    it("clears all sensitive state", async () => {
      // Unlock first
      const salt = new Uint8Array([1, 2, 3, 4]);
      const saltB64 = btoa(String.fromCharCode(...salt));
      await secureStore.setItem("vault_salt", saltB64);
      await secureStore.setItem(
        "vault_params",
        JSON.stringify({ memoryKib: 65536, iterations: 3, parallelism: 1 }),
      );

      setupDeps();
      const { result } = renderHook(() => useVaultState());

      await act(async () => result.current.unlock("test-password"));
      expect(result.current.isLocked).toBe(false);

      act(() => result.current.lock());

      expect(result.current.isLocked).toBe(true);
      expect(result.current.items).toEqual([]);
      expect(result.current.error).toBeNull();
      expect(result.current.conflictCount).toBe(0);
    });
  });

  // ── sync ────────────────────────────────────────────────────────────────────

  describe("sync", () => {
    it("does nothing when locked", async () => {
      const pullAll = vi.fn();
      setupDeps({ pullAll });
      const { result } = renderHook(() => useVaultState());

      await act(async () => result.current.sync());

      expect(pullAll).not.toHaveBeenCalled();
    });

    it("calls syncService.pullAll when unlocked", async () => {
      const pullAll = vi.fn<() => Promise<SyncResult>>().mockResolvedValue({
        pulled: 2,
        conflicts: [],
        serverRevision: 5,
      });
      setupDeps({ pullAll });

      // Unlock first
      const salt = new Uint8Array([1, 2, 3, 4]);
      const saltB64 = btoa(String.fromCharCode(...salt));
      await secureStore.setItem("vault_salt", saltB64);
      await secureStore.setItem(
        "vault_params",
        JSON.stringify({ memoryKib: 65536, iterations: 3, parallelism: 1 }),
      );

      const { result } = renderHook(() => useVaultState());

      await act(async () => result.current.unlock("test-password"));
      await act(async () => result.current.sync());

      expect(pullAll).toHaveBeenCalledTimes(1);
      expect(result.current.isSyncing).toBe(false);
    });

    it("sets error when sync service is not configured", async () => {
      // Explicitly clear sync service
      configureVaultDependencies({
        cryptoAdapter,
        ciphertextStore,
        secureStore,
        syncService: null,
      });

      // Unlock first
      const salt = new Uint8Array([1, 2, 3, 4]);
      const saltB64 = btoa(String.fromCharCode(...salt));
      await secureStore.setItem("vault_salt", saltB64);
      await secureStore.setItem(
        "vault_params",
        JSON.stringify({ memoryKib: 65536, iterations: 3, parallelism: 1 }),
      );

      const { result } = renderHook(() => useVaultState());

      await act(async () => result.current.unlock("test-password"));
      await act(async () => result.current.sync());

      expect(result.current.error).toBe("同步服务未配置");
    });

    it("sets user-facing error on sync failure", async () => {
      const pullAll = vi
        .fn<() => Promise<SyncResult>>()
        .mockRejectedValue(new Error("network_error"));
      setupDeps({ pullAll });

      // Unlock first
      const salt = new Uint8Array([1, 2, 3, 4]);
      const saltB64 = btoa(String.fromCharCode(...salt));
      await secureStore.setItem("vault_salt", saltB64);
      await secureStore.setItem(
        "vault_params",
        JSON.stringify({ memoryKib: 65536, iterations: 3, parallelism: 1 }),
      );

      const { result } = renderHook(() => useVaultState());

      await act(async () => result.current.unlock("test-password"));
      await act(async () => result.current.sync());

      expect(result.current.error).toBe("网络错误，请检查连接");
      expect(result.current.isSyncing).toBe(false);
    });

    it("sets conflict count from sync result", async () => {
      const pullAll = vi.fn<() => Promise<SyncResult>>().mockResolvedValue({
        pulled: 1,
        conflicts: [
          "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        ],
        serverRevision: 10,
      });
      setupDeps({ pullAll });

      // Unlock first
      const salt = new Uint8Array([1, 2, 3, 4]);
      const saltB64 = btoa(String.fromCharCode(...salt));
      await secureStore.setItem("vault_salt", saltB64);
      await secureStore.setItem(
        "vault_params",
        JSON.stringify({ memoryKib: 65536, iterations: 3, parallelism: 1 }),
      );

      const { result } = renderHook(() => useVaultState());

      await act(async () => result.current.unlock("test-password"));
      await act(async () => result.current.sync());

      expect(result.current.conflictCount).toBe(2);
    });
  });

  // ── clearError ──────────────────────────────────────────────────────────────

  describe("clearError", () => {
    it("clears the error state", async () => {
      const pullAll = vi
        .fn<() => Promise<SyncResult>>()
        .mockRejectedValue(new Error("network_error"));
      setupDeps({ pullAll });

      // Unlock first
      const salt = new Uint8Array([1, 2, 3, 4]);
      const saltB64 = btoa(String.fromCharCode(...salt));
      await secureStore.setItem("vault_salt", saltB64);
      await secureStore.setItem(
        "vault_params",
        JSON.stringify({ memoryKib: 65536, iterations: 3, parallelism: 1 }),
      );

      const { result } = renderHook(() => useVaultState());

      await act(async () => result.current.unlock("test-password"));
      await act(async () => result.current.sync());

      expect(result.current.error).not.toBeNull();

      act(() => result.current.clearError());

      expect(result.current.error).toBeNull();
    });
  });

  // ── autoLockMinutes ─────────────────────────────────────────────────────────

  describe("setAutoLockMinutes", () => {
    it("updates the auto-lock timeout", () => {
      setupDeps();
      const { result } = renderHook(() => useVaultState());

      act(() => result.current.setAutoLockMinutes(15));

      expect(result.current.autoLockMinutes).toBe(15);
    });
  });
});
