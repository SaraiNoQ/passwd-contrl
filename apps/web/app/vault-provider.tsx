"use client";

import {
  createContext,
  FormEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  addItem,
  deleteItem,
  loadEncryptedLocalVault,
  persistUnlockedVault,
  updateItem,
  type EncryptedLocalVault,
  type UnlockedVault,
  type VaultItem
} from "../lib/local-vault";
import { isLogin, isSecureNote, isCreditCard } from "../lib/item-types";
import {
  fetchCurrentUser,
  fetchItemHistory,
  getErrorMessage,
  loginAccount,
  logoutAccount,
  pullVault,
  registerAccount,
  saveRecoveryPacketToServer
} from "../lib/api-client";
import {
  getSyncedLocalVaultItem,
  loadConflictIds,
  loadItemRevisionMap,
  loadLastSyncedAt,
  saveItemRevisionMap
} from "../lib/sync-vault";
import { decryptItemFromSync } from "../lib/local-vault";
import { generateQueryToken } from "../lib/search-tokens";
import { requestJson } from "../lib/crypto-utils";
import type {
  CiphertextEnvelope,
  VaultItemCiphertext,
  VaultSearchResponse
} from "@zero-vault/shared";
import {
  clearVaultSessionFromExtension,
  getExtensionBridgeCapabilities,
  publishVaultSessionToExtension,
  type ExtensionBridgeResult
} from "../lib/extension-bridge";
import { type ItemSyncInfo } from "../lib/item-sync";
import {
  getDeviceId,
  listDevices,
  registerDevice,
  type DeviceInfo
} from "../lib/device-trust";
import {
  handleCreateVault,
  handleUnlockVault,
  handleLoadExistingVault
} from "../lib/vault-auth";
import {
  performSync,
  handleRestoreFromCloud,
  handleResolveKeepLocal,
  handleResolveAcceptRemote,
  handleResolveCreateCopy,
  handleResolveSkip,
  type ItemConflict
} from "../lib/vault-sync";
import {
  handleExportCsv,
  handleExportEncrypted,
  handleExportCsvSelected,
  handleExportEncryptedSelected,
  handleImportPasswords,
  handleImportEncryptedBackup as importEncryptedBackup,
  handleChangeMasterPassword as changeMasterPassword,
  handleDeleteAccount as deleteAccountAction
} from "../lib/vault-settings";
import {
  handleCreateRecoveryCode,
  handleRecoverVault
} from "../lib/vault-recovery";
import {
  generateRecoveryCode,
  createRecoveryPacket,
  saveRecoveryPacket
} from "../lib/recovery";
import {
  handleRefreshDevices,
  handleApproveDevice as approveDeviceAction,
  handleRejectDevice as rejectDeviceAction,
  handleRevokeDevice as revokeDeviceAction
} from "../lib/vault-device";
import type { ItemType, ItemForm } from "../components/credentials/credential-drawer";
import {
  enqueueOfflineMutation,
  dequeueOfflineMutations,
  getOfflineQueueSize
} from "../lib/offline-queue";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SyncEvent = {
  id: string;
  timestamp: string;
  type: "push" | "pull" | "conflict" | "error" | "device-approved" | "device-rejected" | "device-revoked";
  description: string;
  itemCount?: number;
};

type SyncConflictState = {
  localRevision: number;
  remoteRevision?: number;
  message: string;
};

type ExtensionBridgeUiState = {
  configured: boolean;
  runtimeAvailable: boolean;
  communication: string;
  lastPublish: string;
  lastClear: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const NAV_IDS = {
  DASHBOARD: "dashboard",
  CREDENTIALS: "credentials",
  IMPORT: "import",
  SYNC: "sync",
  RECOVERY: "recovery",
  SETTINGS: "settings"
} as const;

const SETTINGS_STORAGE_KEYS = {
  AUTO_LOCK_TIMEOUT: "zero-vault.settings.auto-lock-timeout",
  AUTO_SYNC_ENABLED: "zero-vault.settings.auto-sync-enabled",
  SYNC_INTERVAL: "zero-vault.settings.sync-interval",
  EXTENSION_ID: "zero-vault.settings.extension-id"
} as const;

const DEFAULT_AUTO_LOCK_TIMEOUT = 300;
const DEFAULT_AUTO_SYNC_ENABLED = true;
const DEFAULT_SYNC_INTERVAL = 900;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyItemForm: ItemForm = {
  type: "login",
  title: "",
  origin: "",
  username: "",
  password: "",
  notes: "",
  folder: ""
};

export const generatePassword = (length = 20): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
};

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

export const isWeakPassword = (password: string): boolean => {
  if (password.length < 8) return true;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const variety = (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0);
  return variety < 3;
};

const initialExtensionBridgeState = (): ExtensionBridgeUiState => {
  const capabilities = getExtensionBridgeCapabilities();
  return {
    configured: capabilities.configured,
    runtimeAvailable: capabilities.runtimeAvailable,
    communication: capabilities.runtimeAvailable ? "已就绪" : "未连接",
    lastPublish: "尚未发布",
    lastClear: "尚未清除"
  };
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface VaultContextValue {
  // -- Core vault state --
  encryptedVault: EncryptedLocalVault | null;
  unlockedVault: UnlockedVault | null;
  masterPassword: string;
  setMasterPassword: (v: string) => void;
  accountEmail: string;
  setAccountEmail: (v: string) => void;
  accountPassword: string;
  setAccountPassword: (v: string) => void;
  user: { id: string; email: string; serverRevision: number } | null;
  csrfToken: string;
  itemForm: ItemForm;
  setItemForm: (f: ItemForm | ((prev: ItemForm) => ItemForm)) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  error: string;
  setError: (e: string) => void;
  status: string;
  syncStatus: string;
  syncConflict: SyncConflictState | null;
  extensionBridge: ExtensionBridgeUiState;
  canRestoreFromCloud: boolean;
  showSecrets: boolean;
  importStatus: string;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchLoading: boolean;
  loading: boolean;
  copiedField: string | null;
  deleteConfirmId: string | null;
  setDeleteConfirmId: (id: string | null) => void;
  isOffline: boolean;
  offlineQueueCount: number;

  // -- Item-level sync --
  itemSyncInfos: ItemSyncInfo[];
  itemConflicts: ItemConflict[];
  lastSyncedAt: string | null;

  // -- Recovery --
  showRecoveryModal: boolean;
  recoveryCode: string;
  recoveryConfirmed: boolean;
  setRecoveryConfirmed: (v: boolean) => void;
  showRecoveryEntry: boolean;
  setShowRecoveryEntry: (v: boolean | ((prev: boolean) => boolean)) => void;
  recoveryInputCode: string;
  setRecoveryInputCode: (v: string) => void;
  recoveryPassword: string;
  setRecoveryPassword: (v: string) => void;
  regeneratingRecovery: boolean;
  handleRegenerateRecovery: () => Promise<string>;

  // -- Device trust --
  devices: DeviceInfo[];
  currentDeviceId: string;
  showDeviceSection: boolean;
  setShowDeviceSection: (v: boolean) => void;

  // -- UI state --
  activeNav: string;
  setActiveNav: (id: string) => void;
  drawerOpen: boolean;
  filterMode: string;
  setFilterMode: (m: string) => void;
  /** Currently selected folder filter. Empty string = show uncategorized, null = show all. */
  folderFilter: string | null;
  setFolderFilter: (f: string | null) => void;
  passwordRevealedId: string | null;
  setPasswordRevealedId: (id: string | null) => void;
  showAccountSection: boolean;
  setShowAccountSection: (v: boolean | ((prev: boolean) => boolean)) => void;
  autoLockRemaining: number;
  setAutoLockRemaining: (ms: number) => void;

  // -- Settings --
  autoLockTimeout: number;
  setAutoLockTimeout: (v: number) => void;
  extensionId: string;
  setExtensionId: (v: string) => void;
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (v: boolean) => void;
  syncInterval: number;
  setSyncInterval: (v: number) => void;

  // -- Sync events --
  syncEvents: SyncEvent[];

  // -- Computed --
  isLocked: boolean;
  itemCount: number;
  updatedAt: string;
  weakCount: number;
  duplicateCount: number;
  unsyncedCount: number;
  conflictCount: number;
  filteredItems: VaultItem[];
  hasLocalVault: boolean;

  // -- Actions --
  loadExistingVault: () => void;
  createVault: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  unlockVault: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  lockVault: () => void;
  submitRegister: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  submitLogin: () => Promise<void>;
  submitLogout: () => Promise<void>;
  submitItem: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  confirmDelete: (id: string) => Promise<void>;
  batchDeleteCredentials: (ids: string[]) => Promise<void>;
  batchUpdatePassword: (ids: string[], newPassword: string) => Promise<void>;
  openDrawerForCreate: () => void;
  openDrawerForEdit: (item: VaultItem) => void;
  closeDrawer: () => void;
  handleGeneratePassword: () => void;
  importPasswords: (file: File) => Promise<void>;
  syncNow: () => Promise<void>;
  restoreFromCloud: () => Promise<void>;

  // -- Conflict resolution --
  resolveKeepLocal: (itemId: string) => Promise<void>;
  resolveAcceptRemote: (itemId: string) => Promise<void>;
  resolveCreateCopy: (itemId: string) => Promise<void>;
  resolveSkip: (itemId: string) => void;

  // -- Recovery --
  handleCreateRecoveryCode: () => Promise<void>;
  handleRecoverVault: () => Promise<void>;
  closeRecoveryModal: () => void;

  // -- Device trust --
  refreshDevices: () => Promise<void>;
  handleApproveDevice: (deviceId: string) => Promise<void>;
  handleRejectDevice: (deviceId: string) => Promise<void>;
  handleRevokeDevice: (deviceId: string) => Promise<void>;

  // -- Settings --
  handleChangeMasterPassword: (current: string, newPass: string) => Promise<void>;
  handleDeleteAccount: () => Promise<void>;
  handleExportCsv: () => void;
  handleExportEncrypted: () => void;

  // -- Selection --
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;

  // -- Import/Export --
  importBackupStatus: string;
  handleImportEncryptedBackup: (file: File) => Promise<void>;
  handleExportCsvSelected: () => void;
  handleExportEncryptedSelected: () => Promise<void>;

  // -- Copy --
  handleCopy: (text: string, fieldId: string) => Promise<void>;

  // -- Item history --
  historyVersions: Array<{ revision: number; createdAt: string; item: VaultItem }>;
  historyLoading: boolean;
  historyError: string;
  loadHistory: (itemId: string) => Promise<void>;

  // -- Cloud export --
  cloudExports: Array<{ id: string; createdAt: string; algorithm: string }>;
  cloudExportLoading: boolean;
  cloudExportError: string;
  loadCloudExports: () => Promise<void>;
  createCloudExport: () => Promise<void>;
  deleteCloudExport: (exportId: string) => Promise<void>;

  // -- Navigation --
  NAV_IDS: typeof NAV_IDS;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVaultContext(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVaultContext must be used within VaultProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function VaultProvider({ children }: { children: ReactNode }) {
  // -- Core vault state --
  const [encryptedVault, setEncryptedVault] = useState<EncryptedLocalVault | null>(null);
  const [unlockedVault, setUnlockedVault] = useState<UnlockedVault | null>(null);
  const [masterPassword, setMasterPassword] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [csrfToken, setCsrfToken] = useState("");
  const [user, setUser] = useState<{ id: string; email: string; serverRevision: number } | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("已锁定");
  const [syncStatus, setSyncStatus] = useState("仅本地");
  const [syncConflict, setSyncConflict] = useState<SyncConflictState | null>(null);
  const [extensionBridge, setExtensionBridge] = useState<ExtensionBridgeUiState>(initialExtensionBridgeState);
  const [canRestoreFromCloud, setCanRestoreFromCloud] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [serverSearchIds, setServerSearchIds] = useState<Set<string> | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const autoLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [offlineQueueCount, setOfflineQueueCount] = useState(() => getOfflineQueueSize());

  // -- Item-level sync state --
  const [itemSyncInfos, setItemSyncInfos] = useState<ItemSyncInfo[]>([]);
  const [itemConflicts, setItemConflicts] = useState<ItemConflict[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // -- Recovery state --
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [showRecoveryEntry, setShowRecoveryEntry] = useState(false);
  const [recoveryInputCode, setRecoveryInputCode] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [regeneratingRecovery, setRegeneratingRecovery] = useState(false);

  // -- Device trust state --
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>("");
  const [showDeviceSection, setShowDeviceSection] = useState(false);

  // -- UI state --
  const [activeNav, setActiveNav] = useState<string>(NAV_IDS.DASHBOARD);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterMode, setFilterMode] = useState<string>("all");
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [passwordRevealedId, setPasswordRevealedId] = useState<string | null>(null);
  const [autoLockRemaining, setAutoLockRemaining] = useState<number>(DEFAULT_AUTO_LOCK_TIMEOUT * 1000);
  const autoLockStartRef = useRef<number>(Date.now());
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showAccountSection, setShowAccountSection] = useState(false);

  // -- Settings state --
  const [autoLockTimeout, setAutoLockTimeout] = useState(DEFAULT_AUTO_LOCK_TIMEOUT);
  const [extensionId, setExtensionId] = useState("");
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(DEFAULT_AUTO_SYNC_ENABLED);
  const [syncInterval, setSyncInterval] = useState(DEFAULT_SYNC_INTERVAL);

  // -- Selection state --
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // -- Import/Export state --
  const [importBackupStatus, setImportBackupStatus] = useState("");

  // -- Sync event log --
  const [syncEvents, setSyncEvents] = useState<SyncEvent[]>([]);

  // -- Item history state --
  const [historyVersions, setHistoryVersions] = useState<Array<{ revision: number; createdAt: string; item: VaultItem }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  // -- Cloud export state --
  const [cloudExports, setCloudExports] = useState<Array<{ id: string; createdAt: string; algorithm: string }>>([]);
  const [cloudExportLoading, setCloudExportLoading] = useState(false);
  const [cloudExportError, setCloudExportError] = useState("");

  const addSyncEvent = useCallback((event: Omit<SyncEvent, "id" | "timestamp">) => {
    setSyncEvents((prev) => [
      { ...event, id: crypto.randomUUID(), timestamp: new Date().toISOString() },
      ...prev.slice(0, 49)
    ]);
  }, []);

  // -- Extension bridge helpers --
  const recordExtensionBridgeResult = useCallback((bridgeResult: ExtensionBridgeResult) => {
    const outcome = `${bridgeResult.ok ? "OK" : "Issue"} · ${bridgeResult.message}`;
    setExtensionBridge((current) => ({
      ...current,
      configured: bridgeResult.configured,
      runtimeAvailable: bridgeResult.runtimeAvailable,
      communication: bridgeResult.ok ? "已连接" : "未连接",
      lastPublish: bridgeResult.action === "publish" ? outcome : current.lastPublish,
      lastClear: bridgeResult.action === "clear" ? outcome : current.lastClear
    }));
  }, []);

  const refreshExtensionBridgeCapabilities = useCallback(() => {
    const capabilities = getExtensionBridgeCapabilities();
    setExtensionBridge((current) => ({
      ...current,
      configured: capabilities.configured,
      runtimeAvailable: capabilities.runtimeAvailable,
      communication: capabilities.runtimeAvailable ? current.communication : "未连接"
    }));
  }, []);

  const publishExtensionSession = useCallback(
    (items: VaultItem[]) => {
      refreshExtensionBridgeCapabilities();
      void publishVaultSessionToExtension(items).then(recordExtensionBridgeResult);
    },
    [recordExtensionBridgeResult, refreshExtensionBridgeCapabilities]
  );

  const clearExtensionSession = useCallback(() => {
    refreshExtensionBridgeCapabilities();
    void clearVaultSessionFromExtension().then(recordExtensionBridgeResult);
  }, [recordExtensionBridgeResult, refreshExtensionBridgeCapabilities]);

  // -- Settings persistence --
  const settingsLoadedRef = useRef(false);

  useEffect(() => {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEYS.AUTO_LOCK_TIMEOUT);
    if (stored) {
      const val = Number(stored);
      setAutoLockTimeout(val);
      setAutoLockRemaining(val * 1000);
    }
    const storedExtId = localStorage.getItem(SETTINGS_STORAGE_KEYS.EXTENSION_ID);
    if (storedExtId) setExtensionId(storedExtId);
    const storedAutoSync = localStorage.getItem(SETTINGS_STORAGE_KEYS.AUTO_SYNC_ENABLED);
    if (storedAutoSync !== null) setAutoSyncEnabled(storedAutoSync === "true");
    const storedInterval = localStorage.getItem(SETTINGS_STORAGE_KEYS.SYNC_INTERVAL);
    if (storedInterval) setSyncInterval(Number(storedInterval));
    settingsLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    localStorage.setItem(SETTINGS_STORAGE_KEYS.AUTO_LOCK_TIMEOUT, String(autoLockTimeout));
  }, [autoLockTimeout]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    localStorage.setItem(SETTINGS_STORAGE_KEYS.AUTO_SYNC_ENABLED, String(autoSyncEnabled));
  }, [autoSyncEnabled]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    localStorage.setItem(SETTINGS_STORAGE_KEYS.SYNC_INTERVAL, String(syncInterval));
  }, [syncInterval]);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    localStorage.setItem(SETTINGS_STORAGE_KEYS.EXTENSION_ID, extensionId);
  }, [extensionId]);

  // -- Auto-lock --
  const autoLockMs = autoLockTimeout * 1000;

  const resetAutoLock = useCallback(() => {
    if (autoLockTimer.current) {
      clearTimeout(autoLockTimer.current);
    }
    autoLockStartRef.current = Date.now();
    setAutoLockRemaining(autoLockMs);
    if (unlockedVault) {
      autoLockTimer.current = setTimeout(() => {
        setUnlockedVault(null);
        setShowSecrets(false);
        setPasswordRevealedId(null);
        setDrawerOpen(false);
        setEditingId(null);
        setItemForm(emptyItemForm);
        clearExtensionSession();
        const minutes = autoLockTimeout / 60;
        setStatus(`自动锁定（${minutes}分钟无操作）`);
      }, autoLockMs);
    }
  }, [clearExtensionSession, unlockedVault, autoLockMs, autoLockTimeout]);

  useEffect(() => {
    if (!unlockedVault) {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      return;
    }
    countdownRef.current = setInterval(() => {
      const elapsed = Date.now() - autoLockStartRef.current;
      const remaining = Math.max(0, autoLockMs - elapsed);
      setAutoLockRemaining(remaining);
    }, 1000);
    return () => {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    };
  }, [unlockedVault, autoLockMs]);

  useEffect(() => {
    if (!unlockedVault) return;
    const activity = () => resetAutoLock();
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    window.addEventListener("wheel", activity, { passive: true });
    window.addEventListener("touchstart", activity, { passive: true });
    resetAutoLock();
    return () => {
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("wheel", activity);
      window.removeEventListener("touchstart", activity);
      if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
    };
  }, [unlockedVault, resetAutoLock]);

  // -- Sync (delegated to vault-sync) --
  const syncNow = useCallback(async () => {
    setError("");
    setSyncConflict(null);
    if (!encryptedVault) {
      const message = "请先创建本地密码库后再同步。";
      setSyncStatus("同步需要本地密码库");
      setError(message);
      addSyncEvent({ type: "error", description: message });
      return;
    }
    if (!user || !csrfToken) {
      const message = "请先在左侧账户区注册或登录后再同步。";
      setSyncStatus("同步需要登录");
      setError(message);
      addSyncEvent({ type: "error", description: message });
      return;
    }

    // Replay any queued offline mutations before syncing
    const pendingMutations = dequeueOfflineMutations();
    if (pendingMutations.length > 0) {
      setOfflineQueueCount(0);
      addSyncEvent({ type: "push", description: `重放 ${pendingMutations.length} 条离线变更` });
    }

    setLoading(true);
    addSyncEvent({ type: "pull", description: "开始同步…" });
    try {
      const result = await performSync({ encryptedVault, unlockedVault, user, csrfToken });

      switch (result.status) {
        case "merged": {
          setUnlockedVault(result.mergedVault.unlocked);
          setEncryptedVault(result.mergedVault.encrypted);
          publishExtensionSession(result.mergedVault.unlocked.snapshot.items);
          setUser({ ...user, serverRevision: result.serverRevision });
          setSyncStatus(`已同步 · 版本 ${result.serverRevision}`);
          setCanRestoreFromCloud(false);
          setSyncConflict(null);
          addSyncEvent({ type: "push", description: `同步完成，版本 ${result.serverRevision}` });
          break;
        }
        case "item-synced": {
          setUser({ ...user, serverRevision: result.serverRevision });
          setItemSyncInfos(result.itemInfos);
          setItemConflicts([]);
          setLastSyncedAt(new Date().toISOString());
          setCanRestoreFromCloud(false);
          setSyncConflict(null);
          setSyncStatus(`已同步 · 版本 ${result.serverRevision}`);
          addSyncEvent({ type: "push", description: `同步完成，版本 ${result.serverRevision}`, itemCount: result.appliedCount });
          break;
        }
        case "conflicts": {
          setSyncStatus("检测到冲突");
          setItemConflicts(result.conflicts);
          setItemSyncInfos(result.itemInfos);
          addSyncEvent({ type: "conflict", description: `检测到 ${result.conflicts.length} 个冲突`, itemCount: result.conflicts.length });
          break;
        }
        case "version-conflict": {
          setSyncStatus(`冲突 · 本地 ${result.localRevision}，远端 ${result.remoteRevision}`);
          setSyncConflict({
            localRevision: result.localRevision,
            remoteRevision: result.remoteRevision,
            message: "远端加密密码库在此浏览器上次同步后已变更。"
          });
          addSyncEvent({ type: "conflict", description: `版本冲突 · 本地 ${result.localRevision}，远端 ${result.remoteRevision}` });
          break;
        }
        case "sync-conflict": {
          setSyncStatus("冲突");
          setSyncConflict({
            localRevision: result.localRevision,
            message: "服务器拒绝了此次推送，因为远端版本更新。"
          });
          addSyncEvent({ type: "conflict", description: "服务器拒绝推送，远端版本已更新" });
          break;
        }
        case "error": {
          if (result.message === "sync_conflict") {
            setSyncStatus("冲突");
            setSyncConflict({ localRevision: 0, message: "服务器拒绝了此次推送，因为远端版本更新。" });
            addSyncEvent({ type: "conflict", description: "服务器拒绝推送，远端版本已更新" });
          } else {
            setSyncStatus(isOffline ? "离线" : "同步失败");
            setError(isOffline ? "当前离线，连接后将自动同步。" : `同步失败：${result.message}`);
            addSyncEvent({ type: "error", description: isOffline ? "离线" : `同步失败：${result.message}` });
          }
          break;
        }
      }
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "sync_failed";
      setSyncStatus(isOffline ? "离线" : "同步失败");
      setError(isOffline ? "当前离线，连接后将自动同步。" : `同步失败：${message}`);
      addSyncEvent({ type: "error", description: isOffline ? "离线" : `同步失败：${message}` });
    } finally {
      setLoading(false);
    }
  }, [encryptedVault, unlockedVault, user, csrfToken, isOffline, addSyncEvent, publishExtensionSession]);

  useEffect(() => {
    if (!autoSyncEnabled || !unlockedVault || !user || !csrfToken) return;
    const intervalMs = syncInterval * 1000;
    const timer = setInterval(() => { void syncNow(); }, intervalMs);
    return () => { clearInterval(timer); };
  }, [autoSyncEnabled, syncInterval, unlockedVault, user, csrfToken, syncNow]);

  // -- Initialization --
  useEffect(() => {
    refreshExtensionBridgeCapabilities();

    try {
      setEncryptedVault(loadEncryptedLocalVault());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法加载本地密码库。");
    }

    setLastSyncedAt(loadLastSyncedAt());
    setItemConflicts(
      [...loadConflictIds()].map((id) => ({ itemId: id, reason: "server_revision_advanced", localRevision: undefined, serverRevision: undefined }))
    );

    fetchCurrentUser()
      .then((session) => {
        setUser(session.user);
        setCsrfToken(session.csrfToken);
        setSyncStatus(`已登录 · 版本 ${session.user.serverRevision}`);
        if (!loadEncryptedLocalVault()) {
          pullVault()
            .then((remote) => {
              setCanRestoreFromCloud(getSyncedLocalVaultItem(remote.items) !== null);
            })
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);

    setIsOffline(!navigator.onLine);
  }, [refreshExtensionBridgeCapabilities]);

  // -- Online/offline detection with auto-sync on reconnect --
  useEffect(() => {
    const goOnline = () => {
      setIsOffline(false);
      if (getOfflineQueueSize() > 0) {
        void syncNow();
      }
    };
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [syncNow]);

  // -- Device auto-registration --
  useEffect(() => {
    if (user && csrfToken) {
      void registerDevice(csrfToken);
      void (async () => {
        try {
          const deviceList = await listDevices(csrfToken);
          const currentDeviceId = getDeviceId();
          if (currentDeviceId) setCurrentDeviceId(currentDeviceId);
          setDevices(deviceList);
        } catch { /* ignore */ }
      })();
    }
  }, [user, csrfToken]);

  // -- Computed values --
  const isLocked = !unlockedVault;
  const itemCount = unlockedVault?.snapshot.items.length ?? encryptedVault?.itemCount ?? 0;
  const updatedAt = useMemo(() => {
    const value = unlockedVault?.snapshot.updatedAt ?? encryptedVault?.updatedAt;
    return value
      ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
      : "从未";
  }, [encryptedVault?.updatedAt, unlockedVault?.snapshot.updatedAt]);

  const weakCount = useMemo(() => {
    if (!unlockedVault) return 0;
    return unlockedVault.snapshot.items.filter((item) => isLogin(item) && isWeakPassword(item.password)).length;
  }, [unlockedVault]);

  const duplicateCount = useMemo(() => {
    if (!unlockedVault) return 0;
    const passwordCounts = new Map<string, number>();
    for (const item of unlockedVault.snapshot.items) {
      if (!isLogin(item)) continue;
      const count = passwordCounts.get(item.password) ?? 0;
      passwordCounts.set(item.password, count + 1);
    }
    let duplicates = 0;
    for (const count of passwordCounts.values()) {
      if (count > 1) duplicates += count;
    }
    return duplicates;
  }, [unlockedVault]);

  const unsyncedCount = useMemo(() => {
    if (!unlockedVault) return 0;
    return itemSyncInfos.filter((info) => info.status === "pending").length;
  }, [unlockedVault, itemSyncInfos]);

  const conflictCount = itemConflicts.length;

  const filteredItems = useMemo(() => {
    if (!unlockedVault) return [];
    let items = unlockedVault.snapshot.items;

    // Folder filter (applied before search + filterMode)
    if (folderFilter !== null) {
      if (folderFilter === "") {
        // Uncategorized only
        items = items.filter((item) => !item.folder || !item.folder.trim());
      } else {
        items = items.filter((item) => item.folder?.trim() === folderFilter);
      }
    }

    const q = searchQuery.toLowerCase().trim();
    if (q) {
      // Local text filter
      const localMatches = items.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          (isLogin(item) && (item.origin.toLowerCase().includes(q) || item.username.toLowerCase().includes(q))) ||
          (isSecureNote(item) && (item.noteBody?.toLowerCase().includes(q) ?? false)) ||
          (isCreditCard(item) && (
            (item.cardholderName?.toLowerCase().includes(q) ?? false) ||
            (item.cardNumber?.toLowerCase().includes(q) ?? false) ||
            (item.brand?.toLowerCase().includes(q) ?? false)
          ))
      );

      // If server search returned IDs, merge: local matches ∪ server matches
      if (serverSearchIds && serverSearchIds.size > 0) {
        const localIds = new Set(localMatches.map((i) => i.id));
        const serverMatches = items.filter((i) => serverSearchIds.has(i.id) && !localIds.has(i.id));
        items = [...localMatches, ...serverMatches];
      } else {
        items = localMatches;
      }
    }
    switch (filterMode) {
      case "weak":
        items = items.filter((item) => isLogin(item) && isWeakPassword(item.password));
        break;
      case "duplicate": {
        const passwordCounts = new Map<string, number>();
        for (const item of unlockedVault.snapshot.items) {
          if (!isLogin(item)) continue;
          const count = passwordCounts.get(item.password) ?? 0;
          passwordCounts.set(item.password, count + 1);
        }
        items = items.filter((item) => isLogin(item) && (passwordCounts.get(item.password) ?? 0) > 1);
        break;
      }
      case "unsynced":
        items = items.filter((item) => {
          const info = itemSyncInfos.find((i) => i.itemId === item.id);
          return info?.status === "pending";
        });
        break;
      case "conflict":
        items = items.filter((item) => itemConflicts.some((c) => c.itemId === item.id));
        break;
    }
    return items;
  }, [unlockedVault, searchQuery, filterMode, folderFilter, itemSyncInfos, itemConflicts, serverSearchIds]);

  // -- Encrypted server search (debounced) --
  useEffect(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!unlockedVault || q.length < 2) {
      setServerSearchIds(null);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const terms = q.split(/[\s\-_.,;:!?]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
        if (terms.length === 0) {
          setServerSearchIds(null);
          return;
        }
        const tokens: string[] = [];
        for (const term of terms) {
          const token = await generateQueryToken(unlockedVault, term);
          if (token) tokens.push(token);
        }
        if (tokens.length === 0) {
          setServerSearchIds(null);
          return;
        }
        const response = await requestJson<VaultSearchResponse>("/vault/search", {
          method: "POST",
          headers: { "x-zero-vault-csrf": csrfToken },
          body: JSON.stringify({ tokens }),
        });
        setServerSearchIds(new Set(response.itemIds));
      } catch {
        // Server search is optional; local filtering still works
        setServerSearchIds(null);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, unlockedVault, csrfToken]);

  const hasLocalVault = encryptedVault !== null;

  // -- Copy handler --
  const handleCopy = useCallback(async (text: string, fieldId: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    }
  }, []);

  // =========================================================================
  // Thin wrappers — delegate to pure modules, then update React state
  // =========================================================================

  // -- Create vault (vault-auth) --
  const createVault = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const created = await handleCreateVault(masterPassword);
      setEncryptedVault(created.encrypted);
      setUnlockedVault(created.unlocked);
      publishExtensionSession(created.unlocked.snapshot.items);
      setMasterPassword("");
      setStatus("已解锁");
      setActiveNav(NAV_IDS.CREDENTIALS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建密码库失败。");
    } finally {
      setLoading(false);
    }
  }, [masterPassword, publishExtensionSession]);

  // -- Unlock vault (vault-auth) --
  const unlockVault = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!encryptedVault) return;
    setLoading(true);
    try {
      const unlocked = await handleUnlockVault(masterPassword, encryptedVault);
      setUnlockedVault(unlocked);
      publishExtensionSession(unlocked.snapshot.items);
      setMasterPassword("");
      setStatus("已解锁");
      setActiveNav(NAV_IDS.CREDENTIALS);
    } catch {
      setStatus("已锁定");
      setError("主密码不正确，或本地密码库已损坏。");
    } finally {
      setLoading(false);
    }
  }, [masterPassword, encryptedVault, publishExtensionSession]);

  // -- Lock vault --
  const lockVault = useCallback(() => {
    setUnlockedVault(null);
    setShowSecrets(false);
    setEditingId(null);
    setItemForm(emptyItemForm);
    setSearchQuery("");
    setDrawerOpen(false);
    setPasswordRevealedId(null);
    setFilterMode("all");
    setFolderFilter(null);
    setSelectedIds(new Set());
    setImportBackupStatus("");
    clearExtensionSession();
    if (autoLockTimer.current) {
      clearTimeout(autoLockTimer.current);
    }
    setStatus("已锁定");
    setActiveNav(NAV_IDS.DASHBOARD);
  }, [clearExtensionSession]);

  // -- Register --
  const submitRegister = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (accountPassword.length < 12) {
      setError("账户密码至少需要 12 个字符。");
      return;
    }
    setLoading(true);
    try {
      const { recoveryCode } = await registerAccount(accountEmail, accountPassword);
      setRecoveryCode(recoveryCode);
      setRecoveryConfirmed(false);
      setShowRecoveryModal(true);

      const session = await loginAccount(accountEmail, accountPassword);
      setUser(session.user);
      setCsrfToken(session.csrfToken);
      setAccountPassword("");
      setSyncStatus(`已登录 · 版本 ${session.user.serverRevision}`);
      const remote = await pullVault().catch(() => null);
      setCanRestoreFromCloud(!loadEncryptedLocalVault() && !!remote && getSyncedLocalVaultItem(remote.items) !== null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "注册失败。");
    } finally {
      setLoading(false);
    }
  }, [accountEmail, accountPassword]);

  // -- Login --
  const submitLogin = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const session = await loginAccount(accountEmail, accountPassword);
      setUser(session.user);
      setCsrfToken(session.csrfToken);
      setAccountPassword("");
      setSyncStatus(`已登录 · 版本 ${session.user.serverRevision}`);
      const remote = await pullVault().catch(() => null);
      setCanRestoreFromCloud(!loadEncryptedLocalVault() && !!remote && getSyncedLocalVaultItem(remote.items) !== null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败。");
    } finally {
      setLoading(false);
    }
  }, [accountEmail, accountPassword]);

  // -- Logout --
  const submitLogout = useCallback(async () => {
    if (csrfToken) {
      await logoutAccount(csrfToken).catch(() => undefined);
    }
    setUser(null);
    setCsrfToken("");
    setSyncStatus("仅本地");
    setCanRestoreFromCloud(false);
  }, [csrfToken]);

  // -- Drawer --
  const openDrawerForCreate = useCallback(() => {
    setEditingId(null);
    setItemForm(emptyItemForm);
    setError("");
    setDrawerOpen(true);
  }, []);

  const openDrawerForEdit = useCallback((item: VaultItem) => {
    setEditingId(item.id);
    if (isLogin(item)) {
      setItemForm({
        type: "login",
        title: item.title,
        origin: item.origin,
        username: item.username,
        password: item.password,
        notes: item.notes,
        folder: item.folder ?? "",
        ...(item.totp !== undefined ? { totp: item.totp } : {})
      });
    } else if (isSecureNote(item)) {
      setItemForm({
        type: "secure_note",
        title: item.title,
        origin: "",
        username: "",
        password: "",
        notes: item.notes,
        folder: item.folder ?? "",
        noteBody: item.noteBody ?? ""
      });
    } else if (isCreditCard(item)) {
      setItemForm({
        type: "credit_card",
        title: item.title,
        origin: "",
        username: "",
        password: "",
        notes: item.notes,
        folder: item.folder ?? "",
        cardholderName: item.cardholderName ?? "",
        cardNumber: item.cardNumber ?? "",
        expirationMonth: item.expirationMonth ?? "",
        expirationYear: item.expirationYear ?? "",
        cvv: item.cvv ?? "",
        brand: item.brand ?? ""
      });
    } else {
      // Fallback for any future item types
      const base = item as VaultItem;
      setItemForm({
        ...emptyItemForm,
        title: base.title,
        notes: base.notes,
        folder: base.folder ?? ""
      });
    }
    setError("");
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setEditingId(null);
    setItemForm(emptyItemForm);
    setError("");
  }, []);

  // -- Submit item --
  const submitItem = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!unlockedVault) {
      setError("请先解锁密码库。");
      return;
    }
    // Type-specific validation
    if (itemForm.type === "login") {
      if (!itemForm.origin.startsWith("https://")) {
        setError("自动填充仅支持 HTTPS 站点。");
        return;
      }
      if (!itemForm.password) {
        setError("密码不能为空。");
        return;
      }
    }

    setLoading(true);
    try {
      let nextVault: UnlockedVault;
      const baseUpdates = {
        title: itemForm.title,
        notes: itemForm.notes,
        folder: itemForm.folder
      };

      if (itemForm.type === "login") {
        const loginTitle = itemForm.title || new URL(itemForm.origin).hostname;
        const loginData = {
          type: "login" as const,
          title: loginTitle,
          origin: itemForm.origin,
          username: itemForm.username,
          password: itemForm.password,
          notes: itemForm.notes,
          folder: itemForm.folder,
          customFields: [],
          ...(itemForm.totp ? { totp: itemForm.totp } : {})
        };
        if (editingId) {
          nextVault = updateItem(unlockedVault, editingId, loginData);
        } else {
          nextVault = addItem(unlockedVault, loginData);
        }
      } else if (itemForm.type === "secure_note") {
        const noteData = {
          type: "secure_note" as const,
          ...baseUpdates,
          customFields: [],
          noteBody: itemForm.noteBody ?? ""
        };
        if (editingId) {
          nextVault = updateItem(unlockedVault, editingId, noteData);
        } else {
          nextVault = addItem(unlockedVault, noteData);
        }
      } else if (itemForm.type === "credit_card") {
        const cardData = {
          type: "credit_card" as const,
          ...baseUpdates,
          customFields: [],
          cardholderName: itemForm.cardholderName ?? "",
          cardNumber: itemForm.cardNumber ?? "",
          expirationMonth: itemForm.expirationMonth ?? "",
          expirationYear: itemForm.expirationYear ?? "",
          cvv: itemForm.cvv ?? "",
          brand: itemForm.brand ?? ""
        };
        if (editingId) {
          nextVault = updateItem(unlockedVault, editingId, cardData);
        } else {
          nextVault = addItem(unlockedVault, cardData);
        }
      } else {
        setError("未知的记录类型。");
        return;
      }
      const persisted = await persistUnlockedVault(nextVault);
      setUnlockedVault(persisted.unlocked);
      publishExtensionSession(persisted.unlocked.snapshot.items);
      setEncryptedVault(persisted.encrypted);
      if (isOffline) {
        const itemId = editingId ?? persisted.unlocked.snapshot.items[0]?.id ?? "";
        enqueueOfflineMutation({ type: "upsert", itemId, timestamp: new Date().toISOString(), retryCount: 0 });
        setOfflineQueueCount(getOfflineQueueSize());
      }
      setItemForm(emptyItemForm);
      setEditingId(null);
      setDrawerOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存凭据失败。");
    } finally {
      setLoading(false);
    }
  }, [unlockedVault, itemForm, editingId, publishExtensionSession, isOffline]);

  // -- Delete item --
  const confirmDelete = useCallback(async (id: string) => {
    if (!unlockedVault) return;
    setLoading(true);
    try {
      const nextVault = deleteItem(unlockedVault, id);
      const persisted = await persistUnlockedVault(nextVault);
      setUnlockedVault(persisted.unlocked);
      publishExtensionSession(persisted.unlocked.snapshot.items);
      setEncryptedVault(persisted.encrypted);
      if (isOffline) {
        enqueueOfflineMutation({ type: "delete", itemId: id, timestamp: new Date().toISOString(), retryCount: 0 });
        setOfflineQueueCount(getOfflineQueueSize());
      }
      setDeleteConfirmId(null);
      if (editingId === id) {
        setEditingId(null);
        setItemForm(emptyItemForm);
        setDrawerOpen(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除凭据失败。");
    } finally {
      setLoading(false);
    }
  }, [unlockedVault, editingId, publishExtensionSession, isOffline]);

  // -- Batch delete --
  const batchDeleteCredentials = useCallback(async (ids: string[]) => {
    setError("");
    if (!unlockedVault) { setError("请先解锁密码库。"); return; }
    if (ids.length === 0) return;
    setLoading(true);
    try {
      const idSet = new Set(ids);
      let nextVault = unlockedVault;
      for (const id of idSet) {
        if (nextVault.snapshot.items.some((item) => item.id === id)) {
          nextVault = deleteItem(nextVault, id);
        }
      }
      const persisted = await persistUnlockedVault(nextVault);
      setUnlockedVault(persisted.unlocked);
      publishExtensionSession(persisted.unlocked.snapshot.items);
      setEncryptedVault(persisted.encrypted);
      if (isOffline) {
        const now = new Date().toISOString();
        for (const id of idSet) {
          enqueueOfflineMutation({ type: "delete", itemId: id, timestamp: now, retryCount: 0 });
        }
        setOfflineQueueCount(getOfflineQueueSize());
      }
      setDeleteConfirmId(null);
      if (editingId && idSet.has(editingId)) {
        setEditingId(null);
        setItemForm(emptyItemForm);
        setDrawerOpen(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量删除凭据失败。");
    } finally {
      setLoading(false);
    }
  }, [unlockedVault, editingId, publishExtensionSession, isOffline]);

  // -- Batch update password --
  const batchUpdatePassword = useCallback(async (ids: string[], newPassword: string) => {
    setError("");
    if (!unlockedVault) { setError("请先解锁密码库。"); return; }
    if (ids.length === 0) return;
    setLoading(true);
    try {
      const idSet = new Set(ids);
      let nextVault = unlockedVault;
      for (const id of idSet) {
        const existingItem = nextVault.snapshot.items.find((item) => item.id === id);
        if (existingItem && isLogin(existingItem)) {
          nextVault = updateItem(nextVault, id, { password: newPassword } as Partial<VaultItem>);
        }
      }
      const persisted = await persistUnlockedVault(nextVault);
      setUnlockedVault(persisted.unlocked);
      publishExtensionSession(persisted.unlocked.snapshot.items);
      setEncryptedVault(persisted.encrypted);
      if (isOffline) {
        const now = new Date().toISOString();
        for (const id of idSet) {
          enqueueOfflineMutation({ type: "upsert", itemId: id, timestamp: now, retryCount: 0 });
        }
        setOfflineQueueCount(getOfflineQueueSize());
      }
      setStatus(`已更新 ${ids.length} 个凭据`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量更新密码失败。");
    } finally {
      setLoading(false);
    }
  }, [unlockedVault, publishExtensionSession, isOffline]);

  // -- Generate password --
  const handleGeneratePassword = useCallback(() => {
    setItemForm((form) => ({ ...form, password: generatePassword() }));
  }, []);

  // -- Password import (vault-settings) --
  const importPasswords = useCallback(async (file: File) => {
    setError("");
    setImportStatus("");
    if (!unlockedVault) return;
    setLoading(true);
    try {
      const result = await handleImportPasswords(file, unlockedVault);
      if (result.status === "unknown-format") {
        setError("无法识别文件格式。支持 Bitwarden JSON、1Password CSV、浏览器 CSV 和通用 JSON。");
        return;
      }
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setUnlockedVault(result.updatedVault.unlocked);
      publishExtensionSession(result.updatedVault.unlocked.snapshot.items);
      setEncryptedVault(result.updatedVault.encrypted);
      setImportStatus(
        `已导入 ${result.importedCount} 条，已拒绝 ${result.skippedCount} 条。` +
        `来源：${result.format}。请在导入后删除原文件。`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败。");
    } finally {
      setLoading(false);
    }
  }, [unlockedVault, publishExtensionSession]);

  // -- Restore from cloud (vault-sync) --
  const restoreFromCloud = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const result = await handleRestoreFromCloud({ user });
      if (result.status === "no-user") {
        setError("请先登录。");
      } else if (result.status === "no-remote-vault") {
        setError("服务器上没有可恢复的加密密码库。");
      } else if (result.status === "error") {
        setError(result.message);
      } else {
        setEncryptedVault(result.encrypted);
        setCanRestoreFromCloud(false);
        setSyncStatus(`已恢复加密密码库 · 版本 ${result.serverRevision}`);
        setSyncConflict(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "恢复失败。");
    } finally {
      setLoading(false);
    }
  }, [user]);

  // -- Conflict resolution (vault-sync) --
  const resolveKeepLocal = useCallback(async (itemId: string) => {
    if (!unlockedVault || !user || !csrfToken) return;
    setLoading(true);
    try {
      const result = await handleResolveKeepLocal({ unlockedVault, user, csrfToken, itemId });
      if (result.status === "ok") {
        setItemConflicts((prev) => prev.filter((c) => c.itemId !== itemId));
        setItemSyncInfos((prev) =>
          prev.map((info) => (info.itemId === itemId ? { ...info, status: "synced" as const } : info))
        );
      } else if (result.status === "still-conflicting") {
        setError(result.message);
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "重新推送失败。");
    } finally {
      setLoading(false);
    }
  }, [unlockedVault, user, csrfToken]);

  const resolveAcceptRemote = useCallback(async (itemId: string) => {
    if (!unlockedVault || !csrfToken) return;
    setLoading(true);
    try {
      const result = await handleResolveAcceptRemote({ unlockedVault, csrfToken, itemId });
      if (result.status === "ok") {
        setUnlockedVault(result.mergedVault.unlocked);
        setEncryptedVault(result.mergedVault.encrypted);
        publishExtensionSession(result.mergedVault.unlocked.snapshot.items);
        setItemConflicts((prev) => prev.filter((c) => c.itemId !== itemId));
        setItemSyncInfos((prev) =>
          prev.map((info) => (info.itemId === itemId ? { ...info, status: "synced" as const } : info))
        );
      } else if (result.status === "not-found") {
        setError("远端条目未找到。");
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "接受远端版本失败。");
    } finally {
      setLoading(false);
    }
  }, [unlockedVault, csrfToken, publishExtensionSession]);

  const resolveCreateCopy = useCallback(async (itemId: string) => {
    if (!unlockedVault) return;
    setLoading(true);
    try {
      const result = await handleResolveCreateCopy({ unlockedVault, itemId });
      if (result.status === "ok") {
        setUnlockedVault(result.copiedVault.unlocked);
        setEncryptedVault(result.copiedVault.encrypted);
        publishExtensionSession(result.copiedVault.unlocked.snapshot.items);
        setItemConflicts((prev) => prev.filter((c) => c.itemId !== itemId));
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建副本失败。");
    } finally {
      setLoading(false);
    }
  }, [unlockedVault, publishExtensionSession]);

  const resolveSkip = useCallback((itemId: string) => {
    setItemConflicts((prev) => prev.filter((c) => c.itemId !== itemId));
    handleResolveSkip(itemId);
  }, []);

  // -- Recovery (vault-recovery) --
  const handleCreateRecoveryCodeCb = useCallback(async () => {
    if (!unlockedVault) return;
    try {
      const result = await handleCreateRecoveryCode({ unlockedVault, csrfToken });
      setRecoveryCode(result.code);
      setRecoveryConfirmed(false);
    } catch {
      // Error already handled inside the pure function
    }
  }, [unlockedVault, csrfToken]);

  const handleRecoverVaultCb = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const result = await handleRecoverVault({
        recoveryInputCode,
        recoveryPassword,
        encryptedVault
      });
      if (result.status === "no-code") {
        setError("请输入恢复码。");
      } else if (result.status === "password-too-short") {
        setError("请设置新的主密码（至少 12 个字符）以重新加密密码库。");
        setShowRecoveryEntry(true);
      } else if (result.status === "no-packet") {
        setError("未找到恢复包。恢复包可能尚未上传到服务器，或此设备上没有本地副本。");
      } else if (result.status === "error") {
        setError(result.message);
      } else {
        setEncryptedVault(result.encrypted);
        setUnlockedVault(result.unlocked);
        publishExtensionSession(result.unlocked.snapshot.items);
        setShowRecoveryEntry(false);
        setRecoveryInputCode("");
        setRecoveryPassword("");
        setStatus("已解锁");
        setSyncStatus(`密码库已恢复，包含 ${result.recoveredCount} 条凭据。`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "恢复失败。请检查恢复码。");
    } finally {
      setLoading(false);
    }
  }, [recoveryInputCode, recoveryPassword, encryptedVault, publishExtensionSession]);

  const closeRecoveryModal = useCallback(() => {
    setShowRecoveryModal(false);
    setRecoveryCode("");
    setRecoveryConfirmed(false);
  }, []);

  // -- Regenerate recovery code --
  const handleRegenerateRecovery = useCallback(async (): Promise<string> => {
    if (!unlockedVault) throw new Error("请先解锁密码库。");
    setRegeneratingRecovery(true);
    try {
      const vaultKeyBytes =
        unlockedVault.runtime === "webcrypto-mvp"
          ? new Uint8Array(await crypto.subtle.exportKey("raw", unlockedVault.key))
          : unlockedVault.key;

      const code = generateRecoveryCode();
      const packet = await createRecoveryPacket(code, vaultKeyBytes);
      saveRecoveryPacket(packet);

      if (csrfToken) {
        await saveRecoveryPacketToServer(csrfToken, packet).catch(() => undefined);
      }

      return code;
    } finally {
      setRegeneratingRecovery(false);
    }
  }, [unlockedVault, csrfToken]);

  // -- Item history --
  const loadHistory = useCallback(async (itemId: string) => {
    if (!unlockedVault) return;
    setHistoryLoading(true);
    setHistoryError("");
    setHistoryVersions([]);
    try {
      const response = await fetchItemHistory(itemId);
      const versions: Array<{ revision: number; createdAt: string; item: VaultItem }> = [];
      for (const version of response.versions) {
        try {
          const decrypted = await decryptItemFromSync(
            unlockedVault,
            version.encryptedItemKey as CiphertextEnvelope,
            version.encryptedPayload as CiphertextEnvelope,
            version.id
          );
          versions.push({
            revision: version.revision,
            createdAt: version.updatedAt,
            item: decrypted,
          });
        } catch {
          // Skip versions that cannot be decrypted
        }
      }
      setHistoryVersions(versions);
    } catch (e) {
      setHistoryError(e instanceof Error ? getErrorMessage(e) : "加载历史版本失败。");
    } finally {
      setHistoryLoading(false);
    }
  }, [unlockedVault]);

  // -- Cloud export (vault-settings) --
  const loadCloudExports = useCallback(async () => {
    if (!csrfToken) return;
    try {
      const response = await requestJson<{ exports: Array<{ id: string; createdAt: string; algorithm: string }> }>("/exports");
      setCloudExports(response.exports);
    } catch {
      // Silently fail - cloud exports are optional
    }
  }, [csrfToken]);

  const createCloudExport = useCallback(async () => {
    if (!encryptedVault || !csrfToken) return;
    setCloudExportLoading(true);
    setCloudExportError("");
    try {
      const exportId = crypto.randomUUID();
      await requestJson<{ ok: true }>("/exports/create", {
        method: "POST",
        headers: {
          "x-zero-vault-csrf": csrfToken,
          "X-Export-Id": exportId,
          "X-Export-Algorithm": "XCHACHA20_POLY1305",
          "content-type": "application/octet-stream",
        },
        // The encrypted vault is already a JSON-serialized ciphertext blob.
        // Sending it as application/octet-stream matches the backend's arrayBuffer() reader.
        // The server stores raw bytes — it never parses the content.
        body: JSON.stringify(encryptedVault),
      });
      await loadCloudExports();
    } catch (e) {
      setCloudExportError(e instanceof Error ? getErrorMessage(e) : "上传云端备份失败。");
    } finally {
      setCloudExportLoading(false);
    }
  }, [encryptedVault, csrfToken, loadCloudExports]);

  const deleteCloudExport = useCallback(async (exportId: string) => {
    if (!csrfToken) return;
    try {
      await requestJson<{ ok: true }>(`/exports/${exportId}`, {
        method: "DELETE",
        headers: { "x-zero-vault-csrf": csrfToken },
      });
      setCloudExports((prev) => prev.filter((e) => e.id !== exportId));
    } catch {
      // Silently fail
    }
  }, [csrfToken]);

  // -- GET item-sync hydration (Phase 2.4) --
  useEffect(() => {
    if (!user || !csrfToken) return;
    // Hydrate item revision map from server on login
    (async () => {
      try {
        const response = await requestJson<{ serverRevision: number; items: VaultItemCiphertext[]; deletedItemIds: string[] }>("/vault/item-sync");
        const serverRevisionMap: Record<string, number> = {};
        for (const item of response.items) {
          serverRevisionMap[item.id] = item.revision;
        }
        // Merge server revisions into local map (server wins on conflicts)
        const localMap = loadItemRevisionMap();
        const merged: Record<string, number> = { ...localMap };
        for (const [id, rev] of Object.entries(serverRevisionMap)) {
          if ((merged[id] ?? 0) < rev) {
            merged[id] = rev;
          }
        }
        saveItemRevisionMap(merged);
      } catch {
        // Non-critical: first sync may produce false conflicts but self-corrects
      }
    })();
  }, [user, csrfToken]);

  // -- Device trust (vault-device) --
  const refreshDevicesCb = useCallback(async () => {
    if (!csrfToken) {
      const message = "请先登录后再刷新设备列表。";
      setError(message);
      setSyncStatus("设备刷新需要登录");
      addSyncEvent({ type: "error", description: message });
      return;
    }
    try {
      const result = await handleRefreshDevices({ csrfToken });
      if (result.status === "ok") {
        if (result.currentDeviceId) setCurrentDeviceId(result.currentDeviceId);
        setDevices(result.devices);
      } else if (result.status === "error") {
        setError(`设备列表刷新失败：${result.message}`);
        setSyncStatus("设备列表刷新失败");
        addSyncEvent({ type: "error", description: `设备列表刷新失败：${result.message}` });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "设备列表刷新失败。";
      setError(`设备列表刷新失败：${message}`);
      setSyncStatus("设备列表刷新失败");
      addSyncEvent({ type: "error", description: `设备列表刷新失败：${message}` });
    }
  }, [addSyncEvent, csrfToken]);

  const handleApproveDeviceCb = useCallback(async (deviceId: string) => {
    if (!csrfToken) {
      const message = "请先登录后再批准设备。";
      setError(message); setSyncStatus("设备操作需要登录");
      addSyncEvent({ type: "error", description: message });
      return;
    }
    setError("");
    try {
      const result = await approveDeviceAction({ csrfToken, deviceId, unlockedVault, devices });
      if (result.status === "ok") {
        setSyncStatus("设备已批准");
        addSyncEvent({ type: "device-approved", description: "设备已批准" });
      } else if (result.status === "key-share-failed") {
        addSyncEvent({ type: "error", description: result.message });
      } else {
        const message = result.status === "not-logged-in" ? "设备操作需要登录" : result.message;
        setError(`批准设备失败：${message}`);
        setSyncStatus("批准设备失败");
        addSyncEvent({ type: "error", description: `批准设备失败：${message}` });
      }
      await refreshDevicesCb();
    } catch (e) {
      const message = e instanceof Error ? e.message : "approve_failed";
      setError(`批准设备失败：${message}`);
      setSyncStatus("批准设备失败");
      addSyncEvent({ type: "error", description: `批准设备失败：${message}` });
    }
  }, [csrfToken, unlockedVault, devices, refreshDevicesCb, addSyncEvent]);

  const handleRejectDeviceCb = useCallback(async (deviceId: string) => {
    if (!csrfToken) {
      const message = "请先登录后再拒绝设备。";
      setError(message); setSyncStatus("设备操作需要登录");
      addSyncEvent({ type: "error", description: message });
      return;
    }
    setError("");
    try {
      const result = await rejectDeviceAction({ csrfToken, deviceId });
      if (result.status === "ok") {
        setSyncStatus("设备已拒绝");
        addSyncEvent({ type: "device-rejected", description: "设备已拒绝" });
      } else {
        const message = result.status === "not-logged-in" ? "设备操作需要登录" : result.message;
        setError(`拒绝设备失败：${message}`);
        setSyncStatus("拒绝设备失败");
        addSyncEvent({ type: "error", description: `拒绝设备失败：${message}` });
      }
      await refreshDevicesCb();
    } catch (e) {
      const message = e instanceof Error ? e.message : "reject_failed";
      setError(`拒绝设备失败：${message}`);
      setSyncStatus("拒绝设备失败");
      addSyncEvent({ type: "error", description: `拒绝设备失败：${message}` });
    }
  }, [csrfToken, refreshDevicesCb, addSyncEvent]);

  const handleRevokeDeviceCb = useCallback(async (deviceId: string) => {
    if (!csrfToken) {
      const message = "请先登录后再撤销设备。";
      setError(message); setSyncStatus("设备操作需要登录");
      addSyncEvent({ type: "error", description: message });
      return;
    }
    setError("");
    try {
      const result = await revokeDeviceAction({ csrfToken, deviceId });
      if (result.status === "ok") {
        setSyncStatus("设备已撤销");
        addSyncEvent({ type: "device-revoked", description: "设备已撤销" });
      } else {
        const message = result.status === "not-logged-in" ? "设备操作需要登录" : result.message;
        setError(`撤销设备失败：${message}`);
        setSyncStatus("撤销设备失败");
        addSyncEvent({ type: "error", description: `撤销设备失败：${message}` });
      }
      await refreshDevicesCb();
    } catch (e) {
      const message = e instanceof Error ? e.message : "revoke_failed";
      setError(`撤销设备失败：${message}`);
      setSyncStatus("撤销设备失败");
      addSyncEvent({ type: "error", description: `撤销设备失败：${message}` });
    }
  }, [csrfToken, refreshDevicesCb, addSyncEvent]);

  // -- Settings handlers (vault-settings) --
  const handleChangeMasterPassword = useCallback(async (current: string, newPass: string) => {
    if (!encryptedVault) throw new Error("没有本地密码库");
    const result = await changeMasterPassword({
      currentPassword: current,
      newPassword: newPass,
      encryptedVault,
      unlockedVault
    });
    if (result.status === "wrong-current-password") {
      throw new Error("当前密码不正确");
    }
    if (result.status === "error") {
      throw new Error(result.message);
    }
    setEncryptedVault(result.encrypted);
    setUnlockedVault(result.unlocked);
    publishExtensionSession(result.unlocked.snapshot.items);
  }, [encryptedVault, unlockedVault, publishExtensionSession]);

  const handleDeleteAccount = useCallback(async () => {
    await deleteAccountAction(csrfToken);
    setEncryptedVault(null);
    setUnlockedVault(null);
    setUser(null);
    setCsrfToken("");
    setStatus("已锁定");
    setActiveNav(NAV_IDS.DASHBOARD);
    window.location.reload();
  }, [csrfToken]);

  // -- Export (vault-settings) --
  const handleExportCsvCb = useCallback(() => {
    if (!unlockedVault) return;
    handleExportCsv(unlockedVault);
  }, [unlockedVault]);

  const handleExportEncryptedCb = useCallback(() => {
    if (!encryptedVault) return;
    handleExportEncrypted(encryptedVault);
  }, [encryptedVault]);

  const handleExportCsvSelectedCb = useCallback(() => {
    if (!unlockedVault) return;
    handleExportCsvSelected(unlockedVault, selectedIds);
  }, [unlockedVault, selectedIds]);

  const handleExportEncryptedSelectedCb = useCallback(async () => {
    if (!unlockedVault) return;
    await handleExportEncryptedSelected(unlockedVault, selectedIds);
  }, [unlockedVault, selectedIds]);

  // -- Import encrypted backup (vault-settings) --
  const handleImportEncryptedBackup = useCallback(async (file: File) => {
    setError("");
    setImportBackupStatus("");
    try {
      const result = await importEncryptedBackup(file);
      if (result.status === "invalid") {
        setError("无效的加密备份文件。请确认文件是 Obscura 加密备份格式。");
        return;
      }
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setEncryptedVault(result.encrypted);
      // Lock vault since encrypted data changed
      if (unlockedVault) {
        lockVault();
      }
      setSelectedIds(new Set());
      setImportBackupStatus("备份已导入，请使用主密码解锁");
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入加密备份失败。");
    }
  }, [unlockedVault, lockVault]);

  // -- Load existing vault (vault-auth) --
  const loadExistingVault = useCallback(() => {
    setEncryptedVault(handleLoadExistingVault());
  }, []);

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------

  const value: VaultContextValue = {
    encryptedVault, unlockedVault, masterPassword, setMasterPassword,
    accountEmail, setAccountEmail, accountPassword, setAccountPassword,
    user, csrfToken,
    itemForm, setItemForm, editingId, setEditingId,
    error, setError, status, syncStatus, syncConflict,
    extensionBridge, canRestoreFromCloud, showSecrets,
    importStatus, searchQuery, setSearchQuery, searchLoading,
    loading, copiedField, deleteConfirmId, setDeleteConfirmId, isOffline, offlineQueueCount,
    itemSyncInfos, itemConflicts, lastSyncedAt,
    showRecoveryModal, recoveryCode, recoveryConfirmed, setRecoveryConfirmed,
    showRecoveryEntry, setShowRecoveryEntry, recoveryInputCode, setRecoveryInputCode,
    recoveryPassword, setRecoveryPassword, regeneratingRecovery,
    handleRegenerateRecovery,
    devices, currentDeviceId, showDeviceSection, setShowDeviceSection,
    activeNav, setActiveNav, drawerOpen,
    filterMode, setFilterMode, folderFilter, setFolderFilter, passwordRevealedId, setPasswordRevealedId,
    showAccountSection, setShowAccountSection,
    autoLockRemaining, setAutoLockRemaining,
    autoLockTimeout, setAutoLockTimeout, extensionId, setExtensionId,
    autoSyncEnabled, setAutoSyncEnabled, syncInterval, setSyncInterval,
    syncEvents,
    isLocked, itemCount, updatedAt, weakCount, duplicateCount, unsyncedCount, conflictCount,
    filteredItems, hasLocalVault,
    loadExistingVault, createVault, unlockVault, lockVault,
    submitRegister, submitLogin, submitLogout,
    submitItem, confirmDelete, batchDeleteCredentials, batchUpdatePassword,
    openDrawerForCreate, openDrawerForEdit, closeDrawer,
    handleGeneratePassword, importPasswords, syncNow, restoreFromCloud,
    resolveKeepLocal, resolveAcceptRemote, resolveCreateCopy, resolveSkip,
    handleCreateRecoveryCode: handleCreateRecoveryCodeCb,
    handleRecoverVault: handleRecoverVaultCb,
    closeRecoveryModal,
    refreshDevices: refreshDevicesCb,
    handleApproveDevice: handleApproveDeviceCb,
    handleRejectDevice: handleRejectDeviceCb,
    handleRevokeDevice: handleRevokeDeviceCb,
    handleChangeMasterPassword, handleDeleteAccount,
    handleExportCsv: handleExportCsvCb,
    handleExportEncrypted: handleExportEncryptedCb,
    selectedIds, setSelectedIds,
    importBackupStatus,
    handleImportEncryptedBackup,
    handleExportCsvSelected: handleExportCsvSelectedCb,
    handleExportEncryptedSelected: handleExportEncryptedSelectedCb,
    handleCopy,
    historyVersions, historyLoading, historyError, loadHistory,
    cloudExports, cloudExportLoading, cloudExportError, loadCloudExports, createCloudExport, deleteCloudExport,
    NAV_IDS
  };

  return (
    <VaultContext.Provider value={value}>
      {children}
    </VaultContext.Provider>
  );
}
