/**
 * Vault state management for mobile app.
 *
 * Manages vault unlock, item decryption, sync, and locking.
 * Plaintext items exist only in React state while unlocked.
 * Locking clears all plaintext from memory.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { VaultItem, VaultItemCiphertext, CiphertextEnvelope } from "@zero-vault/shared";
import { TestDoubleCryptoAdapter, type MobileCryptoAdapter } from "../lib/crypto/mobile-crypto-adapter";
import { InMemoryCiphertextStore, type MobileCiphertextStore, type StoredItem } from "../lib/storage/mobile-ciphertext-store";
import { InMemorySecureStore, type MobileSecureStore } from "../lib/storage/mobile-secure-store";
import { MobileSyncService } from "../lib/sync/mobile-sync-service";
import { getApiClient } from "./auth-state";

// Singleton instances — configurable for production
let cryptoAdapter: MobileCryptoAdapter = new TestDoubleCryptoAdapter();
let ciphertextStore: MobileCiphertextStore = new InMemoryCiphertextStore();
let secureStore: MobileSecureStore = new InMemorySecureStore();

export function configureVaultDependencies(deps: {
  crypto?: MobileCryptoAdapter;
  ciphertextStore?: MobileCiphertextStore;
  secureStore?: MobileSecureStore;
}) {
  if (deps.crypto) cryptoAdapter = deps.crypto;
  if (deps.ciphertextStore) ciphertextStore = deps.ciphertextStore;
  if (deps.secureStore) secureStore = deps.secureStore;
}

// ── Vault state hook ─────────────────────────────────────────────────────

export interface VaultState {
  items: VaultItem[];
  isLocked: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  lastSyncedAt: string | null;
  conflictCount: number;
  autoLockMinutes: number;
  unlock: (masterPassword: string) => Promise<boolean>;
  lock: () => void;
  sync: () => Promise<void>;
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
  const mountedRef = useRef(true);
  const autoLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
    };
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

  const unlock = useCallback(async (masterPassword: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      // Get stored vault params from secure store
      const saltB64 = await secureStore.getItem("vault_salt");
      const paramsJson = await secureStore.getItem("vault_params");

      if (!saltB64 || !paramsJson) {
        throw new Error("未找到本地密码库，请先登录并同步");
      }

      const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
      const params = JSON.parse(paramsJson) as {
        memoryKib: number;
        iterations: number;
        parallelism: number;
      };

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
  }, [resetAutoLock]);

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
            stored.itemId
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

  const sync = useCallback(async () => {
    if (isLocked || !vaultKey) return;
    setIsSyncing(true);
    setError(null);

    try {
      const client = getApiClient();
      if (!client) {
        throw new Error("API 客户端未配置");
      }

      const syncService = new MobileSyncService(client, ciphertextStore);
      const result = await syncService.pullAll();

      // Decrypt the newly cached items
      await loadDecryptedItems(vaultKey);

      if (mountedRef.current) {
        setLastSyncedAt(result.lastSyncedAt);
        setConflictCount(result.conflictCount);
        setIsSyncing(false);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        const msg = err instanceof Error ? err.message : "同步失败";
        setError(msg === "unauthorized" ? "请先登录" : msg);
        setIsSyncing(false);
      }
    }
  }, [isLocked, vaultKey, loadDecryptedItems]);

  const clearError = useCallback(() => setError(null), []);

  return {
    items,
    isLocked,
    isLoading,
    isSyncing,
    error,
    lastSyncedAt,
    conflictCount,
    autoLockMinutes,
    unlock,
    lock: lockVault,
    sync,
    clearError,
    setAutoLockMinutes,
  };
}
