import { useCallback, useEffect, useRef, useState } from "react";
import { AppState as NativeAppState } from "react-native";
import type {
  ItemLevelSyncConflict,
  TrustedDevice,
  VaultItem,
  CloudExportMetadata,
} from "@zero-vault/shared";
import {
  recoveryPacketV2Schema,
  recoverySigningPublicKeySchema,
  recoveryV2RotationRequestSchema,
  vaultItemCiphertextSchema,
} from "@zero-vault/shared";
import {
  acknowledgePendingNativeRecovery,
  createNativeEncryptedBackup,
  importNativeCryptoCoreBackup,
  prepareNativeRecoveryRotation,
  restoreNativeEncryptedBackup,
  type LocalDeviceSecurityState,
} from "@zero-vault/zero-vault-native";
import {
  LOCAL_ENCRYPTED_BACKUP_FORMAT,
  type LocalEncryptedBackup,
} from "../lib/local-encrypted-backup";
import {
  NativeCryptoUnavailableAdapter,
  type MobileCryptoAdapter,
  type PasswordGeneratorOptions,
  type TotpCode,
} from "../lib/crypto/mobile-crypto-adapter";
import {
  type MobileCiphertextStore,
  type StoredItem,
  type StoredSyncConflict,
} from "../lib/storage/mobile-ciphertext-store";
import type { MobileSecureStore } from "../lib/storage/mobile-secure-store";
import { MobileSyncService } from "../lib/sync/mobile-sync-service";
import { getApiClient } from "./auth-state";

let cryptoAdapter: MobileCryptoAdapter = new NativeCryptoUnavailableAdapter();
let ciphertextStoreFactory: ((accountId: string) => MobileCiphertextStore) | null = null;
let activeCiphertextStore: { accountId: string; store: MobileCiphertextStore } | null = null;
let vaultPreferenceStore: MobileSecureStore | null = null;
const AUTO_LOCK_MINUTES_KEY = "vault_auto_lock_minutes_v1";
const ALLOWED_AUTO_LOCK_MINUTES = [1, 5, 15, 30, 60] as const;

export function configureVaultDependencies(deps: {
  crypto: MobileCryptoAdapter;
  ciphertextStoreFactory: (accountId: string) => MobileCiphertextStore;
  /** Stores only small security preferences; vault secrets never use JavaScript storage. */
  secureStore?: MobileSecureStore;
}) {
  cryptoAdapter = deps.crypto;
  ciphertextStoreFactory = deps.ciphertextStoreFactory;
  vaultPreferenceStore = deps.secureStore ?? null;
  activeCiphertextStore = null;
}

function storeFor(accountId: string | null): MobileCiphertextStore {
  if (!accountId) throw new Error("account_required");
  if (!ciphertextStoreFactory) throw new Error("mobile_storage_not_configured");
  if (!activeCiphertextStore || activeCiphertextStore.accountId !== accountId) {
    activeCiphertextStore = { accountId, store: ciphertextStoreFactory(accountId) };
  }
  return activeCiphertextStore.store;
}

export interface VaultState {
  items: VaultItem[];
  devices: TrustedDevice[];
  conflicts: VaultConflictView[];
  isLocked: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  lastSyncedAt: string | null;
  conflictCount: number;
  pendingMutationCount: number;
  autoLockMinutes: number;
  localDeviceSecurityState: LocalDeviceSecurityState | null;
  localDeviceSecurityFailure: "RECOVERY_REQUIRED" | "NATIVE_UNAVAILABLE" | null;
  unlock: () => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  enableBiometric: () => Promise<boolean>;
  refreshLocalDeviceSecurityState: () => Promise<LocalDeviceSecurityState | null>;
  lock: () => void;
  sync: () => Promise<boolean>;
  saveItem: (item: VaultItem) => Promise<boolean>;
  deleteItem: (itemId: string) => Promise<boolean>;
  createItemId: () => Promise<string>;
  generatePassword: (options: PasswordGeneratorOptions) => Promise<string>;
  generateTotp: (secretOrUri: string) => Promise<TotpCode>;
  loadItemHistory: (itemId: string) => Promise<VaultHistoryVersion[]>;
  refreshDevices: () => Promise<TrustedDevice[]>;
  approveDevice: (deviceId: string) => Promise<void>;
  rejectDevice: (deviceId: string) => Promise<void>;
  revokeDevice: (deviceId: string) => Promise<void>;
  listCloudBackups: () => Promise<CloudExportMetadata[]>;
  createCloudBackup: () => Promise<CloudExportMetadata[]>;
  restoreCloudBackup: (exportId: string) => Promise<void>;
  deleteCloudBackup: (exportId: string) => Promise<CloudExportMetadata[]>;
  createLocalEncryptedBackup: () => Promise<LocalEncryptedBackup>;
  restoreLocalEncryptedBackup: (backup: LocalEncryptedBackup) => Promise<void>;
  importCryptoCoreBackup: (backupJson: string, password: string) => Promise<number>;
  resolveConflict: (itemId: string, resolution: "local" | "server" | "duplicate" | "skip") => Promise<void>;
  rotateRecoveryCode: () => Promise<string>;
  acknowledgeRecoveryCode: () => Promise<boolean>;
  clearError: () => void;
  setAutoLockMinutes: (minutes: number) => Promise<boolean>;
  recordActivity: () => void;
}

export interface VaultHistoryVersion {
  revision: number;
  createdAt: string;
  item: VaultItem;
}

export interface VaultConflictItemSummary {
  type: VaultItem["type"];
  title: string;
  updatedAt: string;
  folder?: string;
  customFieldCount: number;
  origin?: string;
  username?: string;
  cardholderName?: string;
  brand?: string;
  cardLastFour?: string;
}

export type VaultConflictVersionPreview =
  | { kind: "item"; summary: VaultConflictItemSummary }
  | { kind: "deleted" }
  | { kind: "missing" }
  | { kind: "unavailable"; reason: "ciphertext_missing" | "invalid_ciphertext" | "decryption_failed" };

export interface VaultConflictView extends Pick<
  ItemLevelSyncConflict,
  "itemId" | "operation" | "reason" | "clientBaseRevision" | "serverRevision" | "serverItemRevision"
> {
  localVersion: VaultConflictVersionPreview;
  serverVersion: VaultConflictVersionPreview;
}

export function useVaultStateController(
  accountId: string | null,
  csrfToken: string | null = null,
): VaultState {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [conflicts, setConflicts] = useState<VaultConflictView[]>([]);
  const [isLocked, setIsLocked] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pendingMutationCount, setPendingMutationCount] = useState(0);
  const [autoLockMinutes, setAutoLockMinutesState] = useState(5);
  const [localDeviceSecurityState, setLocalDeviceSecurityState] =
    useState<LocalDeviceSecurityState | null>(null);
  const [localDeviceSecurityFailure, setLocalDeviceSecurityFailure] =
    useState<"RECOVERY_REQUIRED" | "NATIVE_UNAVAILABLE" | null>(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const previousAccountRef = useRef(accountId);
  const sessionHandleRef = useRef<string | null>(null);
  const syncPromiseRef = useRef<Promise<boolean> | null>(null);
  const vaultOperationTailRef = useRef<Promise<void>>(Promise.resolve());
  const autoLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enqueueVaultOperation = useCallback(<T>(
    operation: (queuedGeneration: number) => Promise<T>,
  ): Promise<T> => {
    const queuedGeneration = generationRef.current;
    const result = vaultOperationTailRef.current
      .catch(() => undefined)
      .then(() => operation(queuedGeneration));
    vaultOperationTailRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const refreshLocalDeviceSecurityState = useCallback(async (): Promise<LocalDeviceSecurityState | null> => {
    if (!accountId) {
      if (mountedRef.current) {
        setLocalDeviceSecurityState(null);
        setLocalDeviceSecurityFailure(null);
      }
      return null;
    }
    if (mountedRef.current) {
      setLocalDeviceSecurityState(null);
      setLocalDeviceSecurityFailure(null);
    }
    try {
      const state = await cryptoAdapter.getLocalDeviceSecurityState(accountId);
      if (mountedRef.current) {
        setLocalDeviceSecurityState(state);
        setLocalDeviceSecurityFailure(null);
      }
      return state;
    } catch (cause) {
      if (mountedRef.current) {
        setLocalDeviceSecurityState(null);
        setLocalDeviceSecurityFailure(isRecoverableLocalDeviceSecurityFailure(cause)
          ? "RECOVERY_REQUIRED"
          : "NATIVE_UNAVAILABLE");
        setError(userFacingVaultError(cause));
      }
      return null;
    }
  }, [accountId]);

  const lockVault = useCallback(() => {
    generationRef.current += 1;
    cryptoAdapter.lock();
    sessionHandleRef.current = null;
    syncPromiseRef.current = null;
    setItems([]);
    setDevices([]);
    setConflicts([]);
    setIsLocked(true);
    setIsLoading(false);
    setIsSyncing(false);
    setError(null);
    setPendingMutationCount(0);
    if (autoLockTimerRef.current) {
      clearTimeout(autoLockTimerRef.current);
      autoLockTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      cryptoAdapter.lock();
      sessionHandleRef.current = null;
      if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
    };
  }, [lockVault]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const stored = await vaultPreferenceStore?.getItem(AUTO_LOCK_MINUTES_KEY);
        const parsed = Number(stored);
        if (
          active &&
          ALLOWED_AUTO_LOCK_MINUTES.includes(parsed as (typeof ALLOWED_AUTO_LOCK_MINUTES)[number])
        ) {
          setAutoLockMinutesState(parsed);
        }
      } catch {
        if (active) setAutoLockMinutesState(5);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (previousAccountRef.current !== accountId) {
      previousAccountRef.current = accountId;
      activeCiphertextStore = null;
      lockVault();
    }
  }, [accountId, lockVault]);

  useEffect(() => {
    void refreshLocalDeviceSecurityState();
  }, [refreshLocalDeviceSecurityState]);

  useEffect(() => {
    const subscription = NativeAppState.addEventListener("change", (state) => {
      if (state === "active") void refreshLocalDeviceSecurityState();
    });
    return () => subscription.remove();
  }, [refreshLocalDeviceSecurityState]);

  const resetAutoLockTimer = useCallback(() => {
    if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current);
    autoLockTimerRef.current = null;
    if (
      !isLocked &&
      sessionHandleRef.current &&
      NativeAppState.currentState === "active"
    ) {
      autoLockTimerRef.current = setTimeout(lockVault, autoLockMinutes * 60_000);
    }
  }, [autoLockMinutes, isLocked, lockVault]);

  useEffect(() => {
    resetAutoLockTimer();
    return () => {
      if (autoLockTimerRef.current) {
        clearTimeout(autoLockTimerRef.current);
        autoLockTimerRef.current = null;
      }
    };
  }, [resetAutoLockTimer]);

  const recordActivity = useCallback(() => {
    resetAutoLockTimer();
  }, [resetAutoLockTimer]);

  const loadDecryptedItems = useCallback(async (sessionHandle: string, generation: number) => {
    const store = storeFor(accountId);
    const storedItems = await store.getAll();
    const decrypted: VaultItem[] = [];
    for (const stored of storedItems) {
      assertActiveGeneration(generation, generationRef.current);
      const item = await cryptoAdapter.decryptItem(
        sessionHandle,
        stored.ciphertext.encryptedItemKey,
        stored.ciphertext.encryptedPayload,
        stored.itemId,
      );
      decrypted.push(item);
    }
    const metadata = await store.getSyncMetadata();
    const pending = await store.listPendingMutations();
    const nativeConflicts = await store.listConflicts();
    const conflicts = await materializeConflicts(
      nativeConflicts,
      pending,
      sessionHandle,
      accountId,
      () => assertActiveGeneration(generation, generationRef.current),
    );
    return {
      items: decrypted.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      lastSyncedAt: metadata.lastSyncedAt,
      pendingCount: pending.length,
      conflicts,
    };
  }, [accountId]);

  const commitLoadedState = useCallback((loaded: Awaited<ReturnType<typeof loadDecryptedItems>>) => {
    if (!mountedRef.current) return;
    setItems(loaded.items);
    setLastSyncedAt(loaded.lastSyncedAt);
    setPendingMutationCount(loaded.pendingCount);
    setConflicts(loaded.conflicts);
  }, []);

  const unlockUsing = useCallback(async (mode: "device" | "biometric"): Promise<boolean> => {
    if (!accountId || NativeAppState.currentState !== "active") return false;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setIsLoading(true);
    setError(null);
    try {
      if (!(await cryptoAdapter.hasVaultKey(accountId))) throw new Error("device_vault_key_missing");
      const handle = mode === "device"
        ? await cryptoAdapter.unlock(accountId)
        : await cryptoAdapter.unlockWithBiometric(accountId);
      if (generation !== generationRef.current || NativeAppState.currentState !== "active") {
        cryptoAdapter.lock();
        return false;
      }
      const loaded = await loadDecryptedItems(handle, generation);
      assertActiveGeneration(generation, generationRef.current);
      sessionHandleRef.current = handle;
      commitLoadedState(loaded);
      if (mountedRef.current) {
        setIsLocked(false);
        setIsLoading(false);
      }
      return true;
    } catch (cause) {
      cryptoAdapter.lock();
      sessionHandleRef.current = null;
      if (mode === "biometric") await refreshLocalDeviceSecurityState();
      if (mountedRef.current) {
        setItems([]);
        setIsLocked(true);
        setIsLoading(false);
        setError(userFacingVaultError(cause));
      }
      return false;
    }
  }, [accountId, commitLoadedState, loadDecryptedItems, refreshLocalDeviceSecurityState]);

  const unlock = useCallback(() => unlockUsing("device"), [unlockUsing]);
  const unlockWithBiometric = useCallback(() => unlockUsing("biometric"), [unlockUsing]);

  const enableBiometric = useCallback(async (): Promise<boolean> => {
    if (!accountId || isLocked) return false;
    const generation = generationRef.current;
    try {
      await cryptoAdapter.enableBiometric(accountId);
      assertActiveGeneration(generation, generationRef.current);
      await refreshLocalDeviceSecurityState();
      return true;
    } catch (cause) {
      if (cause instanceof Error && cause.message === "operation_cancelled") return false;
      if (
        generation === generationRef.current &&
        mountedRef.current &&
        NativeAppState.currentState === "active"
      ) {
        setError(userFacingVaultError(cause));
      }
      return false;
    }
  }, [accountId, isLocked, refreshLocalDeviceSecurityState]);

  const saveItem = useCallback((item: VaultItem): Promise<boolean> => enqueueVaultOperation(async (generation) => {
    if (generation !== generationRef.current) return false;
    const handle = sessionHandleRef.current;
    if (!accountId || !handle || isLocked) return false;
    setIsLoading(true);
    setError(null);
    try {
      const store = storeFor(accountId);
      const existing = await store.getById(item.id);
      const baseItemRevision = existing?.itemRevision ?? 0;
      const ciphertext = await cryptoAdapter.encryptItem(handle, item, accountId, baseItemRevision);
      const now = new Date().toISOString();
      await store.enqueueUpsert(
        {
          itemId: item.id,
          ciphertext,
          itemRevision: baseItemRevision,
          lastSyncedAt: now,
          hasConflict: false,
        },
        baseItemRevision,
        await cryptoAdapter.createItemId(),
      );
      assertActiveGeneration(generation, generationRef.current);
      if (mountedRef.current) {
        setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
        setPendingMutationCount((await store.listPendingMutations()).length);
        setIsLoading(false);
      }
      return true;
    } catch (cause) {
      if (cause instanceof Error && cause.message === "operation_cancelled") return false;
      if (
        generation === generationRef.current &&
        mountedRef.current &&
        NativeAppState.currentState === "active"
      ) {
        setError(userFacingVaultError(cause));
        setIsLoading(false);
      }
      return false;
    }
  }), [accountId, enqueueVaultOperation, isLocked]);

  const deleteItem = useCallback((itemId: string): Promise<boolean> => enqueueVaultOperation(async (generation) => {
    if (generation !== generationRef.current) return false;
    const handle = sessionHandleRef.current;
    if (!accountId || !handle || isLocked) return false;
    setIsLoading(true);
    setError(null);
    try {
      const store = storeFor(accountId);
      const existing = await store.getById(itemId);
      if (!existing) throw new Error("item_not_found");
      await store.enqueueDelete(
        itemId,
        existing.itemRevision,
        await cryptoAdapter.createItemId(),
        new Date().toISOString(),
      );
      assertActiveGeneration(generation, generationRef.current);
      if (mountedRef.current) {
        setItems((current) => current.filter((item) => item.id !== itemId));
        setPendingMutationCount((await store.listPendingMutations()).length);
        setIsLoading(false);
      }
      return true;
    } catch (cause) {
      if (cause instanceof Error && cause.message === "operation_cancelled") return false;
      if (
        generation === generationRef.current &&
        mountedRef.current &&
        NativeAppState.currentState === "active"
      ) {
        setError(userFacingVaultError(cause));
        setIsLoading(false);
      }
      return false;
    }
  }), [accountId, enqueueVaultOperation, isLocked]);

  const sync = useCallback((): Promise<boolean> => {
    const handle = sessionHandleRef.current;
    if (!accountId || !csrfToken || !handle || isLocked) return Promise.resolve(false);
    if (syncPromiseRef.current) return syncPromiseRef.current;
    const client = getApiClient();
    if (!client) {
      if (mountedRef.current) setError(userFacingVaultError(new Error("api_client_not_configured")));
      return Promise.resolve(false);
    }
    let operation!: Promise<boolean>;
    operation = enqueueVaultOperation(async (generation) => {
      try {
        const currentHandle = sessionHandleRef.current;
        if (
          generation !== generationRef.current ||
          !currentHandle ||
          currentHandle !== handle ||
          isLocked
        ) return false;
        setIsSyncing(true);
        setError(null);
        const service = new MobileSyncService(client, storeFor(accountId), accountId, csrfToken);
        await service.synchronize();
        const loaded = await loadDecryptedItems(currentHandle, generation);
        assertActiveGeneration(generation, generationRef.current);
        commitLoadedState(loaded);
        return true;
      } catch (cause) {
        if (
          generation === generationRef.current &&
          !(cause instanceof Error && cause.message === "operation_cancelled") &&
          mountedRef.current
        ) {
          setError(userFacingVaultError(cause));
        }
        return false;
      } finally {
        if (syncPromiseRef.current === operation) syncPromiseRef.current = null;
        if (generation === generationRef.current && mountedRef.current) setIsSyncing(false);
      }
    });
    syncPromiseRef.current = operation;
    return operation;
  }, [accountId, commitLoadedState, csrfToken, enqueueVaultOperation, isLocked, loadDecryptedItems]);

  const loadItemHistory = useCallback(async (itemId: string): Promise<VaultHistoryVersion[]> => {
    const handle = sessionHandleRef.current;
    const client = getApiClient();
    if (!accountId || !client || !handle || isLocked) throw new Error("unlocked_vault_required");
    const generation = generationRef.current;
    const response = await client.fetchItemHistory(itemId);
    if (
      response.itemId !== itemId ||
      response.versions.some((version) => version.id !== itemId || version.ownerUserId !== accountId)
    ) {
      throw new Error("history_identity_mismatch");
    }
    const versions: VaultHistoryVersion[] = [];
    for (const version of response.versions) {
      assertActiveGeneration(generation, generationRef.current);
      const item = await cryptoAdapter.decryptItem(
        handle,
        version.encryptedItemKey,
        version.encryptedPayload,
        version.id,
      );
      versions.push({ revision: version.revision, createdAt: version.updatedAt, item });
    }
    assertActiveGeneration(generation, generationRef.current);
    return versions;
  }, [accountId, isLocked]);

  const refreshDevices = useCallback(async (): Promise<TrustedDevice[]> => {
    const client = getApiClient();
    if (!client || !csrfToken) throw new Error("authenticated_device_management_required");
    const generation = generationRef.current;
    const next = await client.listDevices();
    assertActiveGeneration(generation, generationRef.current);
    if (mountedRef.current) setDevices(next);
    return next;
  }, [csrfToken]);

  const approveDevice = useCallback(async (deviceId: string): Promise<void> => {
    const handle = sessionHandleRef.current;
    const client = getApiClient();
    if (!client || !csrfToken || !handle || isLocked) throw new Error("unlocked_device_required");
    const target = devices.find((device) => device.id === deviceId) ??
      (await client.listDevices()).find((device) => device.id === deviceId);
    if (!target || target.status !== "pending" || !target.fingerprint) throw new Error("pending_device_not_found");
    const packet = await cryptoAdapter.createDeviceVaultKeyPacket(handle, target);
    await client.approveDevice(csrfToken, target.id, packet);
  }, [csrfToken, devices, isLocked]);

  const rejectDevice = useCallback(async (deviceId: string): Promise<void> => {
    const client = getApiClient();
    if (!client || !csrfToken) throw new Error("authenticated_device_management_required");
    await client.rejectDevice(csrfToken, deviceId);
  }, [csrfToken]);

  const revokeDevice = useCallback(async (deviceId: string): Promise<void> => {
    const client = getApiClient();
    if (!client || !csrfToken) throw new Error("authenticated_device_management_required");
    await client.revokeDevice(csrfToken, deviceId);
  }, [csrfToken]);

  const listCloudBackups = useCallback(async (): Promise<CloudExportMetadata[]> => {
    const client = getApiClient();
    if (!client || !csrfToken) throw new Error("authenticated_cloud_backup_required");
    return client.listCloudBackups();
  }, [csrfToken]);

  const createCloudBackup = useCallback((): Promise<CloudExportMetadata[]> => enqueueVaultOperation(async (generation) => {
    assertActiveGeneration(generation, generationRef.current);
    const client = getApiClient();
    if (!client || !csrfToken || !accountId || isLocked || !sessionHandleRef.current) {
      throw new Error("unlocked_cloud_backup_required");
    }
    const backupId = await cryptoAdapter.createItemId();
    const encryptedSnapshot = await createNativeEncryptedBackup(accountId, backupId);
    assertActiveGeneration(generation, generationRef.current);
    await client.createCloudBackup(csrfToken, backupId, encryptedSnapshot);
    assertActiveGeneration(generation, generationRef.current);
    return client.listCloudBackups();
  }), [accountId, csrfToken, enqueueVaultOperation, isLocked]);

  const restoreCloudBackup = useCallback((exportId: string): Promise<void> => enqueueVaultOperation(async (generation) => {
    assertActiveGeneration(generation, generationRef.current);
    const client = getApiClient();
    if (!client || !csrfToken || !accountId || isLocked || !sessionHandleRef.current) {
      throw new Error("unlocked_cloud_backup_required");
    }
    const encryptedSnapshot = await client.downloadCloudBackup(exportId);
    assertActiveGeneration(generation, generationRef.current);
    await restoreNativeEncryptedBackup(accountId, exportId, encryptedSnapshot);
    assertActiveGeneration(generation, generationRef.current);
    lockVault();
  }), [accountId, csrfToken, enqueueVaultOperation, isLocked, lockVault]);

  const deleteCloudBackup = useCallback(async (exportId: string): Promise<CloudExportMetadata[]> => {
    const client = getApiClient();
    if (!client || !csrfToken) throw new Error("authenticated_cloud_backup_required");
    await client.deleteCloudBackup(csrfToken, exportId);
    return client.listCloudBackups();
  }, [csrfToken]);

  const createLocalEncryptedBackup = useCallback((): Promise<LocalEncryptedBackup> => enqueueVaultOperation(async (generation) => {
    assertActiveGeneration(generation, generationRef.current);
    if (!accountId || isLocked || !sessionHandleRef.current) {
      throw new Error("unlocked_local_backup_required");
    }
    const backupId = await cryptoAdapter.createItemId();
    const encryptedSnapshot = await createNativeEncryptedBackup(accountId, backupId);
    assertActiveGeneration(generation, generationRef.current);
    return {
      format: LOCAL_ENCRYPTED_BACKUP_FORMAT,
      version: 1,
      accountId,
      backupId,
      createdAt: new Date().toISOString(),
      encryptedSnapshot,
    };
  }), [accountId, enqueueVaultOperation, isLocked]);

  const restoreLocalEncryptedBackup = useCallback((backup: LocalEncryptedBackup): Promise<void> => enqueueVaultOperation(async (generation) => {
    assertActiveGeneration(generation, generationRef.current);
    if (!accountId || !sessionHandleRef.current) {
      throw new Error("unlocked_local_backup_required");
    }
    if (backup.accountId !== accountId) throw new Error("backup_account_mismatch");
    await restoreNativeEncryptedBackup(accountId, backup.backupId, backup.encryptedSnapshot);
    assertActiveGeneration(generation, generationRef.current);
    lockVault();
  }), [accountId, enqueueVaultOperation, lockVault]);

  const importCryptoCoreBackup = useCallback((
    backupJson: string,
    password: string,
  ): Promise<number> => enqueueVaultOperation(async (generation) => {
    assertActiveGeneration(generation, generationRef.current);
    const handle = sessionHandleRef.current;
    if (!accountId || !handle) throw new Error("unlocked_local_backup_required");
    const result = await importNativeCryptoCoreBackup(accountId, backupJson, password);
    assertActiveGeneration(generation, generationRef.current);
    const loaded = await loadDecryptedItems(handle, generation);
    assertActiveGeneration(generation, generationRef.current);
    commitLoadedState(loaded);
    return result.importedCount;
  }), [accountId, commitLoadedState, enqueueVaultOperation, loadDecryptedItems]);

  const resolveConflict = useCallback((
    itemId: string,
    resolution: "local" | "server" | "duplicate" | "skip",
  ): Promise<void> => enqueueVaultOperation(async (generation) => {
    assertActiveGeneration(generation, generationRef.current);
    const handle = sessionHandleRef.current;
    if (!accountId || !handle || isLocked) throw new Error("unlocked_vault_required");
    const store = storeFor(accountId);
    if (resolution === "skip") {
      await store.resolveConflict(itemId, "skip");
    } else if (resolution === "local") {
      await store.resolveConflict(itemId, "keep_local");
    } else if (resolution === "server") {
      await store.resolveConflict(itemId, "accept_remote");
    } else {
      const pending = (await store.listPendingMutations()).find((mutation) => mutation.itemId === itemId);
      const stored = await store.getById(itemId);
      if (!stored || pending?.operation === "delete") throw new Error("local_conflict_item_missing");
      const source = await cryptoAdapter.decryptItem(
        handle,
        stored.ciphertext.encryptedItemKey,
        stored.ciphertext.encryptedPayload,
        itemId,
      );
      assertActiveGeneration(generation, generationRef.current);
      const now = new Date().toISOString();
      const copy = {
        ...source,
        id: await cryptoAdapter.createItemId(),
        title: `${source.title || "未命名"}（本地副本）`,
        createdAt: now,
        updatedAt: now,
      } as VaultItem;
      const ciphertext = await cryptoAdapter.encryptItem(handle, copy, accountId, 0);
      const replacement: StoredItem = {
        itemId: copy.id,
        ciphertext,
        itemRevision: 0,
        lastSyncedAt: now,
        hasConflict: false,
      };
      await store.resolveConflict(itemId, "create_copy", replacement, await cryptoAdapter.createItemId());
    }
    assertActiveGeneration(generation, generationRef.current);
    const loaded = await loadDecryptedItems(handle, generation);
    assertActiveGeneration(generation, generationRef.current);
    commitLoadedState(loaded);
  }), [accountId, commitLoadedState, enqueueVaultOperation, isLocked, loadDecryptedItems]);

  const rotateRecoveryCode = useCallback(async (): Promise<string> => {
    const handle = sessionHandleRef.current;
    const client = getApiClient();
    if (!accountId || !csrfToken || !client || !handle || isLocked) {
      throw new Error("unlocked_device_required");
    }
    const generation = generationRef.current;
    try {
      const session = await client.fetchCurrentUser();
      if (session.user.id !== accountId) throw new Error("device_identity_mismatch");
      const rotation = await prepareNativeRecoveryRotation(session.user.email, handle);
      await client.rotateRecoveryV2(csrfToken, recoveryV2RotationRequestSchema.parse({
        encryptedRecoveryPacket: recoveryPacketV2Schema.parse(rotation.recoveryPacket),
        recoverySigningPublicKey: recoverySigningPublicKeySchema.parse(rotation.signingPublicKey),
      }));
      assertActiveGeneration(generation, generationRef.current);
      return rotation.recoveryCode;
    } catch (cause) {
      if (
        !(cause instanceof Error && cause.message === "operation_cancelled") &&
        mountedRef.current &&
        NativeAppState.currentState === "active"
      ) {
        setError(userFacingVaultError(cause));
      }
      throw cause;
    }
  }, [accountId, csrfToken, isLocked]);

  const acknowledgeRecoveryCode = useCallback(async (): Promise<boolean> => {
    const client = getApiClient();
    if (!accountId || !client) return false;
    try {
      const session = await client.fetchCurrentUser();
      if (session.user.id !== accountId) throw new Error("device_identity_mismatch");
      await acknowledgePendingNativeRecovery(session.user.email);
      return true;
    } catch (cause) {
      if (mountedRef.current) setError(userFacingVaultError(cause));
      return false;
    }
  }, [accountId]);

  const clearError = useCallback(() => setError(null), []);
  const setAutoLockMinutes = useCallback(async (minutes: number): Promise<boolean> => {
    if (
      !ALLOWED_AUTO_LOCK_MINUTES.includes(minutes as (typeof ALLOWED_AUTO_LOCK_MINUTES)[number]) ||
      !vaultPreferenceStore
    ) {
      return false;
    }
    try {
      await vaultPreferenceStore.setItem(AUTO_LOCK_MINUTES_KEY, String(minutes));
      if (mountedRef.current) setAutoLockMinutesState(minutes);
      return true;
    } catch {
      if (mountedRef.current) {
        setAutoLockMinutesState(5);
        setError("自动锁定设置未能安全保存，已恢复为 5 分钟");
      }
      return false;
    }
  }, []);

  return {
    items,
    devices,
    conflicts,
    isLocked,
    isLoading,
    isSyncing,
    error,
    lastSyncedAt,
    conflictCount: conflicts.length,
    pendingMutationCount,
    autoLockMinutes,
    localDeviceSecurityState,
    localDeviceSecurityFailure,
    unlock,
    unlockWithBiometric,
    enableBiometric,
    refreshLocalDeviceSecurityState,
    lock: lockVault,
    sync,
    saveItem,
    deleteItem,
    createItemId: () => cryptoAdapter.createItemId(),
    generatePassword: (options) => cryptoAdapter.generatePassword(options),
    generateTotp: (secretOrUri) => cryptoAdapter.generateTotp(secretOrUri),
    loadItemHistory,
    refreshDevices,
    approveDevice,
    rejectDevice,
    revokeDevice,
    listCloudBackups,
    createCloudBackup,
    restoreCloudBackup,
    deleteCloudBackup,
    createLocalEncryptedBackup,
    restoreLocalEncryptedBackup,
    importCryptoCoreBackup,
    resolveConflict,
    rotateRecoveryCode,
    acknowledgeRecoveryCode,
    clearError,
    setAutoLockMinutes,
    recordActivity,
  };
}

function assertActiveGeneration(expected: number, actual: number): void {
  if (expected !== actual || NativeAppState.currentState !== "active") {
    throw new Error("operation_cancelled");
  }
}

async function materializeConflicts(
  conflicts: StoredSyncConflict[],
  pending: Awaited<ReturnType<MobileCiphertextStore["listPendingMutations"]>>,
  sessionHandle: string,
  accountId: string | null,
  assertActive: () => void,
): Promise<VaultConflictView[]> {
  if (!accountId) throw new Error("account_required");
  const views: VaultConflictView[] = [];
  for (const conflict of conflicts) {
    if (conflict.status !== "UNRESOLVED") continue;
    assertActive();
    const mutation = pending.find((entry) => entry.itemId === conflict.itemId);
    const operation = mutation?.operation ?? "upsert";
    const localVersion: VaultConflictVersionPreview = operation === "delete"
      ? { kind: "deleted" }
      : conflict.localCiphertextEnvelopeJson
        ? await decryptConflictVersion(
            conflict.localCiphertextEnvelopeJson,
            conflict.itemId,
            accountId,
            sessionHandle,
            assertActive,
            mutation?.baseItemRevision,
          )
        : mutation
          ? { kind: "unavailable", reason: "ciphertext_missing" }
          : { kind: "missing" };
    const serverVersion: VaultConflictVersionPreview = conflict.remoteCiphertextEnvelopeJson
      ? conflict.serverItemRevision == null
        ? { kind: "unavailable", reason: "invalid_ciphertext" }
        : await decryptConflictVersion(
            conflict.remoteCiphertextEnvelopeJson,
            conflict.itemId,
            accountId,
            sessionHandle,
            assertActive,
            conflict.serverItemRevision,
          )
      : conflict.serverItemRevision == null
        ? { kind: "missing" }
        : { kind: "deleted" };
    assertActive();
    views.push({
      itemId: conflict.itemId,
      operation,
      reason: conflict.reason,
      clientBaseRevision: mutation?.baseItemRevision ?? 0,
      serverRevision: conflict.serverRevision,
      ...(conflict.serverItemRevision == null ? {} : { serverItemRevision: conflict.serverItemRevision }),
      localVersion,
      serverVersion,
    });
  }
  return views;
}

async function decryptConflictVersion(
  envelopeJson: string,
  itemId: string,
  accountId: string,
  sessionHandle: string,
  assertActive: () => void,
  expectedRevision?: number,
): Promise<VaultConflictVersionPreview> {
  let parsedEnvelope: unknown;
  try {
    parsedEnvelope = JSON.parse(envelopeJson);
  } catch {
    return { kind: "unavailable", reason: "invalid_ciphertext" };
  }
  const parsed = vaultItemCiphertextSchema.safeParse(parsedEnvelope);
  if (!parsed.success) return { kind: "unavailable", reason: "invalid_ciphertext" };
  const ciphertext = parsed.data;
  if (
    ciphertext.id !== itemId ||
    ciphertext.ownerUserId !== accountId ||
    (expectedRevision !== undefined && ciphertext.revision !== expectedRevision)
  ) {
    return { kind: "unavailable", reason: "invalid_ciphertext" };
  }
  try {
    assertActive();
    const item = await cryptoAdapter.decryptItem(
      sessionHandle,
      ciphertext.encryptedItemKey,
      ciphertext.encryptedPayload,
      itemId,
    );
    assertActive();
    return { kind: "item", summary: summarizeConflictItem(item) };
  } catch {
    assertActive();
    return { kind: "unavailable", reason: "decryption_failed" };
  }
}

function summarizeConflictItem(item: VaultItem): VaultConflictItemSummary {
  // Security allowlist: never retain passwords, CVV, TOTP, notes, or custom-field values in previews.
  const folder = clipped(item.folder, 80);
  const common = {
    type: item.type,
    title: clipped(item.title, 120) ?? "未命名条目",
    updatedAt: item.updatedAt,
    customFieldCount: item.customFields.length,
    ...(folder ? { folder } : {}),
  };
  if (item.type === "login") {
    const origin = safeOriginHost(item.origin);
    const username = clipped(item.username, 128);
    return {
      ...common,
      ...(origin ? { origin } : {}),
      ...(username ? { username } : {}),
    };
  }
  if (item.type === "credit_card") {
    const digits = item.cardNumber.replace(/\D/gu, "");
    const cardholderName = clipped(item.cardholderName, 80);
    const brand = clipped(item.brand, 32);
    return {
      ...common,
      ...(cardholderName ? { cardholderName } : {}),
      ...(brand ? { brand } : {}),
      ...(digits.length >= 4 ? { cardLastFour: digits.slice(-4) } : {}),
    };
  }
  return common;
}

function clipped(value: string, maxLength: number): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function safeOriginHost(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  try {
    const url = new URL(/^[A-Za-z][A-Za-z\d+.-]*:\/\//u.test(normalized) ? normalized : `https://${normalized}`);
    return url.protocol === "http:" || url.protocol === "https:" ? clipped(url.host, 160) : undefined;
  } catch {
    return undefined;
  }
}

function isRecoverableLocalDeviceSecurityFailure(cause: unknown): boolean {
  const code = typeof cause === "object" && cause !== null && "code" in cause
    ? String((cause as { code: unknown }).code)
    : cause instanceof Error ? cause.message : "";
  return new Set([
    "DEVICE_NOT_INITIALIZED",
    "DEVICE_IDENTITY_MISMATCH",
    "DEVICE_CREDENTIAL_MISSING",
    "KEY_INVALIDATED",
    "CIPHERTEXT_TAMPERED",
  ]).has(code.toUpperCase());
}

function userFacingVaultError(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : "unknown";
  const nativeCode = typeof cause === "object" && cause !== null && "code" in cause
    ? String((cause as { code: unknown }).code)
    : code;
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "请重新输入主密码完成安全验证",
    AUTH_CANCELLED: "生物识别已取消，密码库仍保持锁定",
    AUTH_FAILED: "生物识别未授权本机密钥，密码库仍保持锁定",
    BIOMETRIC_REQUIRED: "此设备已要求使用生物识别解锁",
    BIOMETRIC_UNAVAILABLE: "此设备尚未启用生物识别解锁",
    KEY_INVALIDATED: "生物识别密钥已失效，请重新注册此设备",
    DEVICE_NOT_INITIALIZED: "本机设备身份缺失，请使用恢复码或可信设备重新绑定",
    DEVICE_IDENTITY_MISMATCH: "本机设备身份校验失败，请勿继续批准或解锁",
    DEVICE_CREDENTIAL_MISSING: "本机设备凭据缺失，请重新绑定此设备",
    CIPHERTEXT_TAMPERED: "本机安全材料校验失败，已禁止解锁",
    NATIVE_UNAVAILABLE: "本机安全模块不可用，已禁止密码降级",
    native_crypto_unavailable: "本机安全模块不可用，已禁止密码降级",
    invalid_native_device_security_state: "本机安全模块返回了不兼容状态，已禁止解锁",
    DEVICE_PENDING: "此设备仍在等待批准和密码库密钥分发",
    device_vault_key_missing: "此设备尚未收到密码库密钥",
    unauthorized: "会话已失效，请重新登录",
    network_error: "网络连接失败，离线变更仍安全保存在本机",
    operation_cancelled: "操作已取消",
  };
  return messages[nativeCode] ?? messages[code] ?? "密码库操作失败，未执行不安全降级";
}
