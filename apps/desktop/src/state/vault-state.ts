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
  RecoveryPacketEnvelope,
  TrustedDevice,
} from "@zero-vault/shared";
import {
  TestDoubleCryptoAdapter,
  type DesktopCryptoAdapter,
} from "../lib/crypto/desktop-crypto-adapter";
import {
  InMemoryCiphertextStore,
  type StoredItem,
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
  device_not_found: "设备不存在或已被移除",
  encrypted_vault_key_required: "缺少设备密钥密文",
};

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "发生了未知错误";
  return ERROR_MESSAGES[error.message] ?? error.message;
}

export type DesktopActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface DesktopExportFile {
  filename: string;
  mimeType: string;
  contents: string;
}

function actionOk<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

function actionFail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: getErrorMessage(error) };
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64urlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

interface WrappedVaultKey {
  version: 1;
  nonce: string;
  ciphertext: string;
}

async function wrapVaultKey(
  keyEncryptionKey: Uint8Array,
  vaultKey: Uint8Array,
): Promise<WrappedVaultKey> {
  const importedKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyEncryptionKey.slice().buffer as ArrayBuffer,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: new TextEncoder().encode("zero-vault.local-key-wrap.v1"),
    },
    importedKey,
    vaultKey.slice().buffer as ArrayBuffer,
  );
  return {
    version: 1,
    nonce: bytesToBase64url(nonce),
    ciphertext: bytesToBase64url(new Uint8Array(ciphertext)),
  };
}

async function unwrapVaultKey(
  keyEncryptionKey: Uint8Array,
  envelope: WrappedVaultKey,
): Promise<Uint8Array> {
  const importedKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyEncryptionKey.slice().buffer as ArrayBuffer,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64urlToBytes(envelope.nonce).slice().buffer as ArrayBuffer,
      additionalData: new TextEncoder()
        .encode("zero-vault.local-key-wrap.v1")
        .slice().buffer as ArrayBuffer,
    },
    importedKey,
    base64urlToBytes(envelope.ciphertext).slice().buffer as ArrayBuffer,
  );
  const vaultKey = new Uint8Array(plaintext);
  if (vaultKey.length !== 32) throw new Error("本地密钥包损坏");
  return vaultKey;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// ── Vault state hook ──────────────────────────────────────────────────────────

export interface VaultState {
  items: VaultItem[];
  isLocked: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  isDeviceLoading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
  conflictCount: number;
  storedItems: StoredItem[];
  conflictIds: Set<string>;
  devices: TrustedDevice[];
  currentDeviceId: string;
  vaultKey: Uint8Array | null;
  cryptoAdapter: DesktopCryptoAdapter;
  recoveryPacket: RecoveryPacketEnvelope | null;
  autoLockMinutes: number;
  hasLocalVault: boolean;
  unlock: (masterPassword: string) => Promise<boolean>;
  recoverWithVaultKey: (key: Uint8Array) => Promise<void>;
  lock: () => void;
  sync: () => Promise<DesktopActionResult<SyncResult>>;
  refreshSyncSnapshot: () => Promise<void>;
  resolveConflict: (
    itemId: string,
    strategy: "keep_local" | "accept_remote" | "create_copy" | "skip",
  ) => Promise<DesktopActionResult>;
  refreshDevices: () => Promise<void>;
  registerDevice: (
    csrfToken: string,
    name: string,
    publicKey: string,
    privateKey?: string,
  ) => Promise<DesktopActionResult>;
  approveDevice: (
    csrfToken: string,
    deviceId: string,
    encryptedVaultKey: string,
  ) => Promise<DesktopActionResult>;
  rejectDevice: (csrfToken: string, deviceId: string) => Promise<DesktopActionResult>;
  revokeDevice: (csrfToken: string, deviceId: string) => Promise<DesktopActionResult>;
  refreshRecoveryPacket: () => Promise<void>;
  createRecoveryPacket: (
    csrfToken: string,
    recoveryCode: string,
  ) => Promise<DesktopActionResult>;
  addItem: (
    item: VaultItem,
    csrfToken: string,
    ownerUserId: string,
  ) => Promise<DesktopActionResult<VaultItem>>;
  updateItem: (
    item: VaultItem,
    csrfToken: string,
    ownerUserId: string,
  ) => Promise<DesktopActionResult<VaultItem>>;
  deleteItem: (
    itemId: string,
    csrfToken: string,
    ownerUserId: string,
  ) => Promise<DesktopActionResult<string>>;
  changeMasterPassword: (
    currentPassword: string,
    newPassword: string,
    csrfToken: string,
    ownerUserId: string,
  ) => Promise<DesktopActionResult>;
  exportCsv: () => DesktopActionResult<DesktopExportFile>;
  exportEncryptedBackup: () => Promise<DesktopActionResult<DesktopExportFile>>;
  deleteAccount: (csrfToken: string) => Promise<DesktopActionResult>;
  clearError: () => void;
  setAutoLockMinutes: (minutes: number) => void;
}

export function useVaultState(): VaultState {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [isLocked, setIsLocked] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDeviceLoading, setIsDeviceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [conflictCount, setConflictCount] = useState(0);
  const [storedItems, setStoredItems] = useState<StoredItem[]>([]);
  const [conflictIds, setConflictIdsState] = useState<Set<string>>(new Set());
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState("");
  const [recoveryPacket, setRecoveryPacket] =
    useState<RecoveryPacketEnvelope | null>(null);
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
    setStoredItems([]);
    setConflictIdsState(new Set());
    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    resetAutoLock();
    return () => {
      if (autoLockTimerRef.current) {
        clearTimeout(autoLockTimerRef.current);
        autoLockTimerRef.current = null;
      }
    };
  }, [resetAutoLock]);

  useEffect(() => {
    if (isLocked) return;

    const handleActivity = () => resetAutoLock();
    const handleBlur = () => lockVault();
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("pointerdown", handleActivity);
    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("pointerdown", handleActivity);
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("blur", handleBlur);
    };
  }, [isLocked, lockVault, resetAutoLock]);

  const refreshSyncSnapshot = useCallback(async () => {
    const [stored, lastSync, conflicts] = await Promise.all([
      ciphertextStore.getAll(),
      ciphertextStore.getLastSyncedAt(),
      ciphertextStore.getConflictIds(),
    ]);

    if (mountedRef.current) {
      setStoredItems(stored);
      setLastSyncedAt(lastSync);
      setConflictIdsState(new Set(conflicts));
      setConflictCount(conflicts.size);
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
        } catch (error) {
          throw new Error(
            error instanceof Error && error.message
              ? "主密码不正确或本地密文已损坏"
              : "主密码不正确或本地密文已损坏",
          );
        }
      }

      if (mountedRef.current) {
        setItems(decrypted);
      }
      await refreshSyncSnapshot();
    } catch {
      // Failed to load cached items — not critical
    }
  }, [refreshSyncSnapshot]);

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

          const keyEncryptionKey = await cryptoAdapter.deriveVaultKey(
            masterPassword,
            salt,
            params,
          );
          const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
          const wrappedKey = await wrapVaultKey(keyEncryptionKey, key);

          // Persist vault params to secure store
          const saltB64New = btoa(String.fromCharCode(...salt));
          await secureStore.setItem("vault_salt", saltB64New);
          await secureStore.setItem("vault_params", JSON.stringify(params));
          await secureStore.setItem("wrapped_vault_key", JSON.stringify(wrappedKey));

          if (mountedRef.current) {
            setHasLocalVault(true);
            setVaultKey(key);
            setIsLocked(false);
            setIsLoading(false);
            setStoredItems([]);
            setConflictIdsState(new Set());
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

        const keyEncryptionKey = await cryptoAdapter.deriveVaultKey(
          masterPassword,
          salt,
          params,
        );
        const wrappedKeyJson = await secureStore.getItem("wrapped_vault_key");
        const key = wrappedKeyJson
          ? await unwrapVaultKey(
              keyEncryptionKey,
              JSON.parse(wrappedKeyJson) as WrappedVaultKey,
            )
          : keyEncryptionKey;

        // Load cached ciphertext and decrypt
        await loadDecryptedItems(key);
        if (mountedRef.current) {
          setVaultKey(key);
          setIsLocked(false);
          setIsLoading(false);
        }
        return true;
      } catch (err: unknown) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "解锁失败");
          setIsLoading(false);
        }
        return false;
      }
    },
    [loadDecryptedItems],
  );

  const recoverWithVaultKey = useCallback(
    async (key: Uint8Array): Promise<void> => {
      if (mountedRef.current) {
        setVaultKey(key);
        setIsLocked(false);
        setError(null);
      }
      await loadDecryptedItems(key);
    },
    [loadDecryptedItems],
  );

  const sync = useCallback(async (): Promise<DesktopActionResult<SyncResult>> => {
    if (isLocked || !vaultKey) {
      return actionFail(new Error("密码库已锁定，请先解锁"));
    }

    const service = syncService;
    if (!service) {
      if (mountedRef.current) {
        setError("同步服务未配置");
      }
      return actionFail(new Error("同步服务未配置"));
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
      return actionOk(result);
    } catch (err: unknown) {
      const result = actionFail(err);
      if (mountedRef.current) {
        setError(result.error);
        setIsSyncing(false);
      }
      return result;
    }
  }, [isLocked, vaultKey, loadDecryptedItems]);

  const resolveConflict = useCallback(
    async (
      itemId: string,
      strategy: "keep_local" | "accept_remote" | "create_copy" | "skip",
    ): Promise<DesktopActionResult> => {
      const service = syncService;
      if (!service) {
        setError("同步服务未配置");
        return actionFail(new Error("同步服务未配置"));
      }

      setIsLoading(true);
      setError(null);
      try {
        await service.resolveConflict(itemId, strategy);
        await refreshSyncSnapshot();
        return actionOk(undefined);
      } catch (err: unknown) {
        const result = actionFail(err);
        if (mountedRef.current) setError(result.error);
        return result;
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    },
    [refreshSyncSnapshot],
  );

  const refreshDevices = useCallback(async (): Promise<void> => {
    const client = apiClient;
    if (!client) return;

    setIsDeviceLoading(true);
    try {
      const [deviceList, storedDeviceId] = await Promise.all([
        client.listDevices(),
        secureStore.getItem("device_id"),
      ]);
      if (mountedRef.current) {
        setDevices(deviceList.devices);
        setCurrentDeviceId(storedDeviceId ?? "");
      }
    } catch (err: unknown) {
      if (mountedRef.current) setError(getErrorMessage(err));
    } finally {
      if (mountedRef.current) setIsDeviceLoading(false);
    }
  }, []);

  const registerDevice = useCallback(
    async (
      csrfToken: string,
      name: string,
      publicKey: string,
      privateKey?: string,
    ): Promise<DesktopActionResult> => {
      const client = apiClient;
      if (!client) {
        setError("API 客户端未配置");
        return actionFail(new Error("API 客户端未配置"));
      }

      setIsDeviceLoading(true);
      setError(null);
      try {
        const response = await client.registerDevice(csrfToken, { name, publicKey });
        const registered = response as TrustedDevice;
        await secureStore.setItem("device_id", registered.id);
        await secureStore.setItem("device_public_key", publicKey);
        if (privateKey) {
          await secureStore.setItem(`device_private_key_${registered.id}`, privateKey);
        }
        await refreshDevices();
        return actionOk(undefined);
      } catch (err: unknown) {
        const result = actionFail(err);
        if (mountedRef.current) setError(result.error);
        return result;
      } finally {
        if (mountedRef.current) setIsDeviceLoading(false);
      }
    },
    [refreshDevices],
  );

  const approveDevice = useCallback(
    async (
      csrfToken: string,
      deviceId: string,
      encryptedVaultKey: string,
    ): Promise<DesktopActionResult> => {
      const client = apiClient;
      if (!client) {
        setError("API 客户端未配置");
        return actionFail(new Error("API 客户端未配置"));
      }

      setIsDeviceLoading(true);
      setError(null);
      try {
        await client.approveDevice(csrfToken, deviceId);
        await client.shareVaultKey(csrfToken, deviceId, encryptedVaultKey);
        await refreshDevices();
        return actionOk(undefined);
      } catch (err: unknown) {
        const result = actionFail(err);
        if (mountedRef.current) setError(result.error);
        return result;
      } finally {
        if (mountedRef.current) setIsDeviceLoading(false);
      }
    },
    [refreshDevices],
  );

  const rejectDevice = useCallback(
    async (csrfToken: string, deviceId: string): Promise<DesktopActionResult> => {
      const client = apiClient;
      if (!client) {
        setError("API 客户端未配置");
        return actionFail(new Error("API 客户端未配置"));
      }

      setIsDeviceLoading(true);
      setError(null);
      try {
        await client.rejectDevice(csrfToken, deviceId);
        await refreshDevices();
        return actionOk(undefined);
      } catch (err: unknown) {
        const result = actionFail(err);
        if (mountedRef.current) setError(result.error);
        return result;
      } finally {
        if (mountedRef.current) setIsDeviceLoading(false);
      }
    },
    [refreshDevices],
  );

  const revokeDevice = useCallback(
    async (csrfToken: string, deviceId: string): Promise<DesktopActionResult> => {
      const client = apiClient;
      if (!client) {
        setError("API 客户端未配置");
        return actionFail(new Error("API 客户端未配置"));
      }

      setIsDeviceLoading(true);
      setError(null);
      try {
        await client.revokeDevice(csrfToken, deviceId);
        await refreshDevices();
        return actionOk(undefined);
      } catch (err: unknown) {
        const result = actionFail(err);
        if (mountedRef.current) setError(result.error);
        return result;
      } finally {
        if (mountedRef.current) setIsDeviceLoading(false);
      }
    },
    [refreshDevices],
  );

  const refreshRecoveryPacket = useCallback(async (): Promise<void> => {
    const client = apiClient;
    if (!client) return;

    try {
      const response = await client.downloadRecoveryPacket();
      if (mountedRef.current) {
        setRecoveryPacket(response.encryptedRecoveryPacket);
      }
    } catch {
      if (mountedRef.current) setRecoveryPacket(null);
    }
  }, []);

  const createRecoveryPacket = useCallback(
    async (csrfToken: string, recoveryCode: string): Promise<DesktopActionResult> => {
      if (!vaultKey) {
        setError("密码库已锁定，请先解锁");
        return actionFail(new Error("密码库已锁定，请先解锁"));
      }

      const client = apiClient;
      if (!client) {
        setError("API 客户端未配置");
        return actionFail(new Error("API 客户端未配置"));
      }

      setIsLoading(true);
      setError(null);
      try {
        const recoveryKey = await cryptoAdapter.deriveRecoveryKey(recoveryCode);
        const importedKey = await globalThis.crypto.subtle.importKey(
          "raw",
          recoveryKey.slice().buffer as ArrayBuffer,
          "AES-GCM",
          false,
          ["encrypt"],
        );
        const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
        const aad = new TextEncoder().encode("zero-vault.recovery.v1");
        const ciphertext = await globalThis.crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv: nonce.buffer as ArrayBuffer,
            additionalData: aad,
          },
          importedKey,
          vaultKey.slice().buffer as ArrayBuffer,
        );
        const packet: RecoveryPacketEnvelope = {
          alg: "AES_256_GCM",
          nonce: bytesToBase64url(nonce),
          ciphertext: bytesToBase64url(new Uint8Array(ciphertext)),
        };

        await client.uploadRecoveryPacket(csrfToken, {
          encryptedRecoveryPacket: packet,
        });
        if (mountedRef.current) setRecoveryPacket(packet);
        return actionOk(undefined);
      } catch (err: unknown) {
        const result = actionFail(err);
        if (mountedRef.current) setError(result.error);
        return result;
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    },
    [vaultKey],
  );

  // ── CRUD operations ───────────────────────────────────────────────────────

  const addItem = useCallback(
    async (
      item: VaultItem,
      csrfToken: string,
      ownerUserId: string,
    ): Promise<DesktopActionResult<VaultItem>> => {
      if (isLocked || !vaultKey) {
        setError("密码库已锁定，请先解锁");
        return actionFail(new Error("密码库已锁定，请先解锁"));
      }

      const client = apiClient;
      if (!client) {
        setError("API 客户端未配置");
        return actionFail(new Error("API 客户端未配置"));
      }

      setIsLoading(true);
      setError(null);

      try {
        const now = new Date().toISOString();
        const encrypted = await cryptoAdapter.encryptItem(vaultKey, item, item.id);
        const baseRevision = await ciphertextStore.getServerRevision();

        const upsert: ItemLevelEncryptedUpsert = {
          id: item.id,
          ownerUserId,
          revision: 0,
          createdAt: now,
          updatedAt: now,
          encryptedItemKey: encrypted.encryptedItemKey,
          encryptedPayload: encrypted.encryptedPayload,
          encryptedSearchTokens: [],
          baseItemRevision: 0,
        };

        const response = await client.createItem(csrfToken, upsert, baseRevision);

        if (response.conflicts.length > 0) {
          const conflictIds = await ciphertextStore.getConflictIds();
          for (const conflict of response.conflicts) conflictIds.add(conflict.itemId);
          await ciphertextStore.setConflictIds(conflictIds);
          await ciphertextStore.setServerRevision(response.serverRevision);
          await ciphertextStore.upsert({
            itemId: item.id,
            ciphertext: {
              id: item.id,
              ownerUserId,
              revision: 0,
              createdAt: now,
              updatedAt: now,
              encryptedItemKey: encrypted.encryptedItemKey,
              encryptedPayload: encrypted.encryptedPayload,
              encryptedSearchTokens: [],
            },
            itemRevision: 0,
            lastSyncedAt: now,
            hasConflict: true,
          });
          await refreshSyncSnapshot();
          const result = actionFail(new Error("sync_conflict"));
          if (mountedRef.current) setError(result.error);
          return result;
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
            ownerUserId,
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
        await ciphertextStore.setServerRevision(response.serverRevision);
        await ciphertextStore.setLastSyncedAt(now);
        await refreshSyncSnapshot();

        // Update plaintext items in state
        if (mountedRef.current) {
          setItems((prev) => [...prev, item]);
          setLastSyncedAt(now);
        }
        return actionOk(item);
      } catch (err: unknown) {
        const result = actionFail(err);
        if (mountedRef.current) {
          setError(result.error);
        }
        return result;
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [isLocked, vaultKey, refreshSyncSnapshot],
  );

  const updateItem = useCallback(
    async (
      item: VaultItem,
      csrfToken: string,
      ownerUserId: string,
    ): Promise<DesktopActionResult<VaultItem>> => {
      if (isLocked || !vaultKey) {
        setError("密码库已锁定，请先解锁");
        return actionFail(new Error("密码库已锁定，请先解锁"));
      }

      const client = apiClient;
      if (!client) {
        setError("API 客户端未配置");
        return actionFail(new Error("API 客户端未配置"));
      }

      setIsLoading(true);
      setError(null);

      try {
        const now = new Date().toISOString();
        const encrypted = await cryptoAdapter.encryptItem(vaultKey, item, item.id);

        // Get current revision for conflict detection
        const existing = await ciphertextStore.getById(item.id);
        const currentRevision = existing?.itemRevision ?? 0;
        const baseRevision = await ciphertextStore.getServerRevision();

        const upsert: ItemLevelEncryptedUpsert = {
          id: item.id,
          ownerUserId,
          revision: currentRevision + 1,
          createdAt: existing?.ciphertext.createdAt ?? now,
          updatedAt: now,
          encryptedItemKey: encrypted.encryptedItemKey,
          encryptedPayload: encrypted.encryptedPayload,
          encryptedSearchTokens: [],
          baseItemRevision: currentRevision,
        };

        const response = await client.updateItem(csrfToken, upsert, baseRevision);

        if (response.conflicts.length > 0) {
          const conflictIds = await ciphertextStore.getConflictIds();
          for (const conflict of response.conflicts) conflictIds.add(conflict.itemId);
          await ciphertextStore.setConflictIds(conflictIds);
          await ciphertextStore.setServerRevision(response.serverRevision);
          await ciphertextStore.upsert({
            itemId: item.id,
            ciphertext: {
              id: item.id,
              ownerUserId,
              revision: currentRevision,
              createdAt: existing?.ciphertext.createdAt ?? now,
              updatedAt: now,
              encryptedItemKey: encrypted.encryptedItemKey,
              encryptedPayload: encrypted.encryptedPayload,
              encryptedSearchTokens: [],
            },
            itemRevision: currentRevision,
            lastSyncedAt: now,
            hasConflict: true,
          });
          await refreshSyncSnapshot();
          const result = actionFail(new Error("sync_conflict"));
          if (mountedRef.current) setError(result.error);
          return result;
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
            ownerUserId,
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
        await ciphertextStore.setServerRevision(response.serverRevision);
        await ciphertextStore.setLastSyncedAt(now);
        await refreshSyncSnapshot();

        // Update plaintext items in state
        if (mountedRef.current) {
          setItems((prev) =>
            prev.map((existing) => (existing.id === item.id ? item : existing)),
          );
          setLastSyncedAt(now);
        }
        return actionOk(item);
      } catch (err: unknown) {
        const result = actionFail(err);
        if (mountedRef.current) {
          setError(result.error);
        }
        return result;
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [isLocked, vaultKey, refreshSyncSnapshot],
  );

  const deleteItem = useCallback(
    async (
      itemId: string,
      csrfToken: string,
      ownerUserId: string,
    ): Promise<DesktopActionResult<string>> => {
      if (isLocked) {
        setError("密码库已锁定，请先解锁");
        return actionFail(new Error("密码库已锁定，请先解锁"));
      }

      const client = apiClient;
      if (!client) {
        setError("API 客户端未配置");
        return actionFail(new Error("API 客户端未配置"));
      }

      setIsLoading(true);
      setError(null);

      try {
        const existing = await ciphertextStore.getById(itemId);
        const currentRevision = existing?.itemRevision ?? 0;
        const baseRevision = await ciphertextStore.getServerRevision();

        const response = await client.deleteItem(
          csrfToken,
          itemId,
          currentRevision,
          ownerUserId,
          baseRevision,
        );

        if (response.conflicts.length > 0) {
          const conflictIds = await ciphertextStore.getConflictIds();
          for (const conflict of response.conflicts) conflictIds.add(conflict.itemId);
          await ciphertextStore.setConflictIds(conflictIds);
          await ciphertextStore.setServerRevision(response.serverRevision);
          if (existing) await ciphertextStore.upsert({ ...existing, hasConflict: true });
          await refreshSyncSnapshot();
          const result = actionFail(new Error("sync_conflict"));
          if (mountedRef.current) setError(result.error);
          return result;
        }

        // Remove from ciphertext store
        await ciphertextStore.delete(itemId);
        await ciphertextStore.setServerRevision(response.serverRevision);
        await ciphertextStore.setLastSyncedAt(new Date().toISOString());
        await refreshSyncSnapshot();

        // Remove from plaintext items in state
        if (mountedRef.current) {
          setItems((prev) => prev.filter((item) => item.id !== itemId));
          setLastSyncedAt(new Date().toISOString());
        }
        return actionOk(itemId);
      } catch (err: unknown) {
        const result = actionFail(err);
        if (mountedRef.current) {
          setError(result.error);
        }
        return result;
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [isLocked, refreshSyncSnapshot],
  );

  const changeMasterPassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
      _csrfToken: string,
      _ownerUserId: string,
    ): Promise<DesktopActionResult> => {
      if (isLocked || !vaultKey) {
        return actionFail(new Error("密码库已锁定，请先解锁"));
      }

      setIsLoading(true);
      setError(null);
      try {
        const [saltB64, paramsJson, wrappedKeyJson] = await Promise.all([
          secureStore.getItem("vault_salt"),
          secureStore.getItem("vault_params"),
          secureStore.getItem("wrapped_vault_key"),
        ]);
        if (!saltB64 || !paramsJson) {
          throw new Error("密码库参数缺失");
        }

        const params = JSON.parse(paramsJson) as typeof DEFAULT_KDF_PARAMS;
        const salt = Uint8Array.from(atob(saltB64), (character) =>
          character.charCodeAt(0),
        );
        const currentKeyEncryptionKey = await cryptoAdapter.deriveVaultKey(
          currentPassword,
          salt,
          params,
        );
        const verifiedVaultKey = wrappedKeyJson
          ? await unwrapVaultKey(
              currentKeyEncryptionKey,
              JSON.parse(wrappedKeyJson) as WrappedVaultKey,
            )
          : currentKeyEncryptionKey;
        if (!equalBytes(verifiedVaultKey, vaultKey)) {
          throw new Error("当前密码不正确");
        }

        const newSalt = globalThis.crypto.getRandomValues(new Uint8Array(32));
        const newParams = { ...DEFAULT_KDF_PARAMS };
        const newKeyEncryptionKey = await cryptoAdapter.deriveVaultKey(
          newPassword,
          newSalt,
          newParams,
        );
        const wrappedVaultKey = await wrapVaultKey(newKeyEncryptionKey, vaultKey);

        await secureStore.setItem(
          "vault_salt",
          btoa(String.fromCharCode(...newSalt)),
        );
        await secureStore.setItem("vault_params", JSON.stringify(newParams));
        await secureStore.setItem(
          "wrapped_vault_key",
          JSON.stringify(wrappedVaultKey),
        );
        return actionOk(undefined);
      } catch (err: unknown) {
        const result = actionFail(
          err instanceof DOMException ? new Error("当前密码不正确") : err,
        );
        if (mountedRef.current) setError(result.error);
        return result;
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    },
    [isLocked, vaultKey],
  );

  const exportCsv = useCallback((): DesktopActionResult<DesktopExportFile> => {
    if (isLocked) return actionFail(new Error("密码库已锁定，请先解锁"));

    const headers = [
      "type",
      "title",
      "origin",
      "username",
      "password",
      "note",
      "cardholder_name",
      "card_number",
      "expiration_month",
      "expiration_year",
      "cvv",
      "folder",
    ];
    const rows = items.map((item) => {
      const values =
        item.type === "login"
          ? [
              item.type,
              item.title,
              item.origin,
              item.username,
              item.password,
              item.notes,
              "",
              "",
              "",
              "",
              "",
              item.folder,
            ]
          : item.type === "secure_note"
            ? [
                item.type,
                item.title,
                "",
                "",
                "",
                item.noteBody,
                "",
                "",
                "",
                "",
                "",
                item.folder,
              ]
            : [
                item.type,
                item.title,
                "",
                "",
                "",
                item.notes,
                item.cardholderName,
                item.cardNumber,
                item.expirationMonth,
                item.expirationYear,
                item.cvv,
                item.folder,
              ];
      return values.map(escapeCsv).join(",");
    });
    return actionOk({
      filename: `obscura-vault-${new Date().toISOString().slice(0, 10)}.csv`,
      mimeType: "text/csv;charset=utf-8",
      contents: [headers.map(escapeCsv).join(","), ...rows].join("\r\n"),
    });
  }, [isLocked, items]);

  const exportEncryptedBackup = useCallback(
    async (): Promise<DesktopActionResult<DesktopExportFile>> => {
      if (isLocked) return actionFail(new Error("密码库已锁定，请先解锁"));
      try {
        const [stored, serverRevision, lastSync, salt, params, wrappedVaultKey] =
          await Promise.all([
            ciphertextStore.getAll(),
            ciphertextStore.getServerRevision(),
            ciphertextStore.getLastSyncedAt(),
            secureStore.getItem("vault_salt"),
            secureStore.getItem("vault_params"),
            secureStore.getItem("wrapped_vault_key"),
          ]);
        const backup = {
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          kdf: {
            salt,
            params: params ? JSON.parse(params) : null,
            wrappedVaultKey: wrappedVaultKey ? JSON.parse(wrappedVaultKey) : null,
          },
          sync: { serverRevision, lastSyncedAt: lastSync },
          items: stored,
        };
        return actionOk({
          filename: `obscura-encrypted-backup-${new Date().toISOString().slice(0, 10)}.json`,
          mimeType: "application/json",
          contents: JSON.stringify(backup, null, 2),
        });
      } catch (err: unknown) {
        return actionFail(err);
      }
    },
    [isLocked],
  );

  const deleteAccount = useCallback(
    async (csrfToken: string): Promise<DesktopActionResult> => {
      const client = apiClient;
      if (!client) return actionFail(new Error("API 客户端未配置"));

      setIsLoading(true);
      setError(null);
      try {
        await client.deleteAccount(csrfToken);
        const knownDeviceIds = new Set([
          currentDeviceId,
          ...devices.map((device) => device.id),
        ]);
        await ciphertextStore.clear();
        await Promise.all([
          secureStore.deleteItem("vault_salt"),
          secureStore.deleteItem("vault_params"),
          secureStore.deleteItem("wrapped_vault_key"),
          secureStore.deleteItem("device_id"),
          secureStore.deleteItem("device_public_key"),
          ...Array.from(knownDeviceIds)
            .filter(Boolean)
            .map((deviceId) =>
              secureStore.deleteItem(`device_private_key_${deviceId}`),
            ),
        ]);
        lockVault();
        setHasLocalVault(false);
        setDevices([]);
        setCurrentDeviceId("");
        setRecoveryPacket(null);
        return actionOk(undefined);
      } catch (err: unknown) {
        const result = actionFail(err);
        if (mountedRef.current) setError(result.error);
        return result;
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    },
    [currentDeviceId, devices, lockVault],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      items,
      isLocked,
      isLoading,
      isSyncing,
      isDeviceLoading,
      error,
      lastSyncedAt,
      conflictCount,
      storedItems,
      conflictIds,
      devices,
      currentDeviceId,
      vaultKey,
      cryptoAdapter,
      recoveryPacket,
      autoLockMinutes,
      hasLocalVault,
      unlock,
      recoverWithVaultKey,
      lock: lockVault,
      sync,
      refreshSyncSnapshot,
      resolveConflict,
      refreshDevices,
      registerDevice,
      approveDevice,
      rejectDevice,
      revokeDevice,
      refreshRecoveryPacket,
      createRecoveryPacket,
      addItem,
      updateItem,
      deleteItem,
      changeMasterPassword,
      exportCsv,
      exportEncryptedBackup,
      deleteAccount,
      clearError,
      setAutoLockMinutes,
    }),
    [
      items, isLocked, isLoading, isSyncing, isDeviceLoading, error,
      lastSyncedAt, conflictCount, storedItems, conflictIds, devices,
      currentDeviceId, vaultKey, recoveryPacket, autoLockMinutes, hasLocalVault,
      unlock, recoverWithVaultKey, lockVault, sync, refreshSyncSnapshot,
      resolveConflict, refreshDevices, registerDevice, approveDevice,
      rejectDevice, revokeDevice, refreshRecoveryPacket, createRecoveryPacket,
      addItem, updateItem, deleteItem,
      changeMasterPassword, exportCsv, exportEncryptedBackup, deleteAccount,
      clearError, setAutoLockMinutes,
    ],
  );
}
