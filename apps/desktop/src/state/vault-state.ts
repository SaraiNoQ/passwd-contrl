/**
 * Vault state management for the desktop app.
 *
 * Manages vault unlock, item decryption, sync, and locking.
 * Plaintext items exist only in React state while unlocked.
 * Locking clears all plaintext from memory.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import type {
  VaultItem,
  CiphertextEnvelope,
  ItemLevelEncryptedUpsert,
  ItemLevelSyncPlan,
  ItemLevelSyncResponse,
} from "@zero-vault/shared";
import {
  TestDoubleCryptoAdapter,
  type DesktopCryptoAdapter,
} from "../lib/crypto/desktop-crypto-adapter";
import {
  InMemoryCiphertextStore,
  type DesktopCiphertextStore,
} from "../lib/storage/desktop-ciphertext-store";
import {
  InMemorySecureStore,
  type DesktopSecureStore,
} from "../lib/storage/desktop-secure-store";
import {
  DesktopSyncServiceImpl,
  type DesktopSyncService,
  type SyncResult,
} from "../lib/sync/desktop-sync-service";
import type { DesktopApiClient } from "../lib/api/desktop-api-client";

// ── Dependency injection ──────────────────────────────────────────────────────

let cryptoAdapter: DesktopCryptoAdapter = new TestDoubleCryptoAdapter();
let ciphertextStore: DesktopCiphertextStore = new InMemoryCiphertextStore();
let secureStore: DesktopSecureStore = new InMemorySecureStore();
let syncService: DesktopSyncService | null = null;
let apiClient: DesktopApiClient | null = null;

export function configureVaultDependencies(deps: {
  cryptoAdapter?: DesktopCryptoAdapter;
  ciphertextStore?: DesktopCiphertextStore;
  secureStore?: DesktopSecureStore;
  apiClient?: DesktopApiClient;
  syncService?: DesktopSyncService | null;
}) {
  if (deps.cryptoAdapter) cryptoAdapter = deps.cryptoAdapter;
  if (deps.ciphertextStore) ciphertextStore = deps.ciphertextStore;
  if (deps.secureStore) secureStore = deps.secureStore;
  if (deps.apiClient) apiClient = deps.apiClient;
  if (deps.syncService !== undefined) {
    syncService = deps.syncService;
  } else if (deps.apiClient) {
    syncService = new DesktopSyncServiceImpl(
      deps.apiClient,
      ciphertextStore,
      cryptoAdapter,
    );
  }
}

// ── Error message mapping (zh-CN) ────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  network_error: "网络错误，请检查连接",
  request_timeout: "请求超时",
  unauthorized: "登录已过期，请重新登录",
  forbidden: "访问被拒绝",
  sync_conflict: "同步冲突，请手动解决",
};

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "发生了未知错误";
  return ERROR_MESSAGES[error.message] ?? error.message;
}

// ── Vault state hook ──────────────────────────────────────────────────────────

export interface VaultState {
  items: VaultItem[];
  isLocked: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  lastSyncedAt: string | null;
  conflictCount: number;
  autoLockMinutes: number;
  hasLocalVault: boolean;
  unlock: (masterPassword: string) => Promise<boolean>;
  lock: () => void;
  sync: () => Promise<void>;
  addItem: (item: VaultItem, csrfToken: string) => Promise<void>;
  updateItem: (item: VaultItem, csrfToken: string) => Promise<void>;
  deleteItem: (itemId: string, csrfToken: string) => Promise<void>;
  clearError: () => void;
  setAutoLockMinutes: (minutes: number) => void;
}

export function useVaultState(): VaultState {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [isLocked, setIsLocked] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [conflictCount, setConflictCount] = useState(0);
  const [autoLockMinutes, setAutoLockMinutes] = useState(5);
  const [vaultKey, setVaultKey] = useState<Uint8Array | null>(null);
  const [hasLocalVault, setHasLocalVault] = useState(false);
  const [vaultChecked, setVaultChecked] = useState(false);
  const mountedRef = useRef(true);
  const autoLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
    };
  }, []);

  // Detect existing vault on mount
  useEffect(() => {
    void (async () => {
      try {
        const salt = await secureStore.getItem("vault_salt");
        if (mountedRef.current) {
          setHasLocalVault(!!salt);
          setVaultChecked(true);
        }
      } catch {
        if (mountedRef.current) {
          setHasLocalVault(false);
          setVaultChecked(true);
        }
      }
    })();
  }, []);

  // Reset auto-lock timer on activity
  const resetAutoLock = useCallback(() => {
    if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
    if (!isLocked && vaultKey) {
      autoLockTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          lockVault();
        }
      }, autoLockMinutes * 60 * 1000);
    }
  }, [isLocked, vaultKey, autoLockMinutes]);

  const lockVault = useCallback(() => {
    cryptoAdapter.lock();
    setItems([]);
    setVaultKey(null);
    setIsLocked(true);
    setError(null);
    setConflictCount(0);
    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }
  }, []);

  const loadDecryptedItems = useCallback(async (key: Uint8Array) => {
    try {
      const storedItems = await ciphertextStore.getAll();
      const decrypted: VaultItem[] = [];

      for (const stored of storedItems) {
        try {
          const item = await cryptoAdapter.decryptItem(
            key,
            stored.ciphertext.encryptedItemKey as CiphertextEnvelope,
            stored.ciphertext.encryptedPayload as CiphertextEnvelope,
            stored.itemId,
          );
          decrypted.push(item);
        } catch {
          // Skip items that cannot be decrypted
        }
      }

      if (mountedRef.current) {
        setItems(decrypted);
        const ts = await ciphertextStore.getLastSyncedAt();
        setLastSyncedAt(ts);
        const conflicts = await ciphertextStore.getConflictIds();
        setConflictCount(conflicts.size);
      }
    } catch {
      // Failed to load cached items — not critical
    }
  }, []);

  const DEFAULT_KDF_PARAMS = {
    memoryKib: 65536,
    iterations: 3,
    parallelism: 4,
  };

  const unlock = useCallback(
    async (masterPassword: string): Promise<boolean> => {
      setIsLoading(true);
      setError(null);

      try {
        const saltB64 = await secureStore.getItem("vault_salt");
        const isFirstTime = !saltB64;

        let salt: Uint8Array;
        let params: { memoryKib: number; iterations: number; parallelism: number };

        if (isFirstTime) {
          // FORGE MODE: first-time vault creation
          salt = new Uint8Array(32);
          crypto.getRandomValues(salt);
          params = { ...DEFAULT_KDF_PARAMS };

          const key = await cryptoAdapter.deriveVaultKey(masterPassword, salt, params);

          // Persist vault params to secure store
          const saltB64New = btoa(String.fromCharCode(...salt));
          await secureStore.setItem("vault_salt", saltB64New);
          await secureStore.setItem("vault_params", JSON.stringify(params));

          if (mountedRef.current) {
            setHasLocalVault(true);
            setVaultKey(key);
            setIsLocked(false);
            setIsLoading(false);
            resetAutoLock();
          }

          // No cached ciphertext yet — start with empty vault
          return true;
        }

        // UNLOCK MODE: existing vault
        const paramsJson = await secureStore.getItem("vault_params");
        if (!paramsJson) {
          throw new Error("密码库数据损坏，请重置后重试");
        }

        salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
        params = JSON.parse(paramsJson) as typeof DEFAULT_KDF_PARAMS;

        const key = await cryptoAdapter.deriveVaultKey(masterPassword, salt, params);

        if (mountedRef.current) {
          setVaultKey(key);
          setIsLocked(false);
          setIsLoading(false);
          resetAutoLock();
        }

        // Load cached ciphertext and decrypt
        await loadDecryptedItems(key);
        return true;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "解锁失败");
          setIsLoading(false);
        }
        return false;
      }
    },
    [resetAutoLock, loadDecryptedItems],
  );

  const sync = useCallback(async () => {
    if (isLocked || !vaultKey) return;

    const service = syncService;
    if (!service) {
      if (mountedRef.current) {
        setError("同步服务未配置");
      }
      return;
    }

    setIsSyncing(true);
    setError(null);

    try {
      const result = await service.pullAll();

      // Decrypt the newly cached items
      await loadDecryptedItems(vaultKey);

      if (mountedRef.current) {
        setLastSyncedAt(new Date().toISOString());
        setConflictCount(result.conflicts.length);
        setIsSyncing(false);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError(getErrorMessage(err));
        setIsSyncing(false);
      }
    }
  }, [isLocked, vaultKey, loadDecryptedItems]);

  // ── CRUD operations ───────────────────────────────────────────────────────

  const addItem = useCallback(
    async (item: VaultItem, csrfToken: string): Promise<void> => {
      if (isLocked || !vaultKey) {
        setError("密码库已锁定，请先解锁");
        return;
      }

      const client = apiClient;
      if (!client) {
        setError("API 客户端未配置");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const now = new Date().toISOString();
        const encrypted = await cryptoAdapter.encryptItem(vaultKey, item, item.id);

        const upsert: ItemLevelEncryptedUpsert = {
          id: item.id,
          ownerUserId: "", // resolved server-side from session
          revision: 0,
          createdAt: now,
          updatedAt: now,
          encryptedItemKey: encrypted.encryptedItemKey,
          encryptedPayload: encrypted.encryptedPayload,
          encryptedSearchTokens: [],
          baseItemRevision: 0,
        };

        const response = await client.createItem(csrfToken, upsert);

        if (response.conflicts.length > 0) {
          throw new Error("sync_conflict");
        }

        // Store ciphertext locally
        const storedRevision =
          response.applied.upsertedItemIds.includes(item.id)
            ? (response.serverRevision ?? 1)
            : 1;
        await ciphertextStore.upsert({
          itemId: item.id,
          ciphertext: {
            id: item.id,
            ownerUserId: "",
            revision: storedRevision,
            createdAt: now,
            updatedAt: now,
            encryptedItemKey: encrypted.encryptedItemKey,
            encryptedPayload: encrypted.encryptedPayload,
            encryptedSearchTokens: [],
          },
          itemRevision: storedRevision,
          lastSyncedAt: now,
          hasConflict: false,
        });

        // Update plaintext items in state
        if (mountedRef.current) {
          setItems((prev) => [...prev, item]);
          setLastSyncedAt(now);
        }
      } catch (err: unknown) {
        if (mountedRef.current) {
          setError(getErrorMessage(err));
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [isLocked, vaultKey],
  );

  const updateItem = useCallback(
    async (item: VaultItem, csrfToken: string): Promise<void> => {
      if (isLocked || !vaultKey) {
        setError("密码库已锁定，请先解锁");
        return;
      }

      const client = apiClient;
      if (!client) {
        setError("API 客户端未配置");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const now = new Date().toISOString();
        const encrypted = await cryptoAdapter.encryptItem(vaultKey, item, item.id);

        // Get current revision for conflict detection
        const existing = await ciphertextStore.getById(item.id);
        const currentRevision = existing?.itemRevision ?? 0;

        const upsert: ItemLevelEncryptedUpsert = {
          id: item.id,
          ownerUserId: "",
          revision: currentRevision + 1,
          createdAt: existing?.ciphertext.createdAt ?? now,
          updatedAt: now,
          encryptedItemKey: encrypted.encryptedItemKey,
          encryptedPayload: encrypted.encryptedPayload,
          encryptedSearchTokens: [],
          baseItemRevision: currentRevision,
        };

        const response = await client.updateItem(csrfToken, upsert);

        if (response.conflicts.length > 0) {
          throw new Error("sync_conflict");
        }

        // Update ciphertext store
        const storedRevision =
          response.applied.upsertedItemIds.includes(item.id)
            ? (response.serverRevision ?? currentRevision + 1)
            : currentRevision + 1;
        await ciphertextStore.upsert({
          itemId: item.id,
          ciphertext: {
            id: item.id,
            ownerUserId: "",
            revision: storedRevision,
            createdAt: existing?.ciphertext.createdAt ?? now,
            updatedAt: now,
            encryptedItemKey: encrypted.encryptedItemKey,
            encryptedPayload: encrypted.encryptedPayload,
            encryptedSearchTokens: [],
          },
          itemRevision: storedRevision,
          lastSyncedAt: now,
          hasConflict: false,
        });

        // Update plaintext items in state
        if (mountedRef.current) {
          setItems((prev) =>
            prev.map((existing) => (existing.id === item.id ? item : existing)),
          );
          setLastSyncedAt(now);
        }
      } catch (err: unknown) {
        if (mountedRef.current) {
          setError(getErrorMessage(err));
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [isLocked, vaultKey],
  );

  const deleteItem = useCallback(
    async (itemId: string, csrfToken: string): Promise<void> => {
      if (isLocked) {
        setError("密码库已锁定，请先解锁");
        return;
      }

      const client = apiClient;
      if (!client) {
        setError("API 客户端未配置");
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const existing = await ciphertextStore.getById(itemId);
        const currentRevision = existing?.itemRevision ?? 0;

        const response = await client.deleteItem(csrfToken, itemId, currentRevision);

        if (response.conflicts.length > 0) {
          throw new Error("sync_conflict");
        }

        // Remove from ciphertext store
        await ciphertextStore.delete(itemId);

        // Remove from plaintext items in state
        if (mountedRef.current) {
          setItems((prev) => prev.filter((item) => item.id !== itemId));
          setLastSyncedAt(new Date().toISOString());
        }
      } catch (err: unknown) {
        if (mountedRef.current) {
          setError(getErrorMessage(err));
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [isLocked],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      items,
      isLocked,
      isLoading,
      isSyncing,
      error,
      lastSyncedAt,
      conflictCount,
      autoLockMinutes,
      hasLocalVault,
      unlock,
      lock: lockVault,
      sync,
      addItem,
      updateItem,
      deleteItem,
      clearError,
      setAutoLockMinutes,
    }),
    [
      items, isLocked, isLoading, isSyncing, error,
      lastSyncedAt, conflictCount, autoLockMinutes, hasLocalVault,
      unlock, lockVault, sync, addItem, updateItem, deleteItem,
      clearError, setAutoLockMinutes,
    ],
  );
}
