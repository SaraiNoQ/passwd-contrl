"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, KeyRound, LayoutDashboard, RefreshCw, Settings, Shield } from "lucide-react";
import { Sidebar } from "../components/shell/sidebar";
import { LockedState } from "../components/shell/locked-state";
import TopBar from "../components/shell/top-bar";
import { CredentialList } from "../components/credentials/credential-list";
import { CredentialDrawer } from "../components/credentials/credential-drawer";
import { RecoverySetup, RecoveryModal } from "../components/recovery";
import CsvImport from "../components/import/csv-import";
import { SettingsPage } from "../components/settings/settings-page";
import SyncPanel, { type SyncEvent } from "../components/sync/sync-panel";
import SyncDevicePanel from "../components/sync/sync-device-panel";
import ConflictResolutionPanel from "../components/sync/conflict-resolution-panel";
import { Toast } from "../components/ui/toast";
import { Button } from "../components/ui/button";
import {
  addCredential,
  createEmptyLocalVault,
  persistUnlockedVault,
  saveEncryptedLocalVault,
  unlockLocalVaultWithRecoveredKey,
  type EncryptedLocalVault,
  type UnlockedVault,
  type VaultCredential,
  type VaultItem
} from "../lib/local-vault";
import { isLogin } from "../lib/item-types";
import {
  fetchRecoveryPacket,
  getErrorMessage,
  pullVault,
  pushItemLevelSync,
  pushVault,
} from "../lib/api-client";
import {
  encryptedVaultToSyncRequest,
  loadLocalServerRevision,
  saveLocalServerRevision,
  loadItemRevisionMap,
  saveItemRevisionMap,
  loadConflictIds,
  saveConflictIds,
  loadLastSyncedAt,
  mergeRemoteItems,
  performItemLevelSync
} from "../lib/sync-vault";
import { buildItemLevelSyncPlan, extractConflicts, type ItemSyncInfo } from "../lib/item-sync";
import {
  loadRecoveryPacket,
  recoverVaultKey,
} from "../lib/recovery";
import {
  getDeviceId,
  registerDevice,
  listDevices,
  approveDevice,
  rejectDevice,
  revokeDevice,
  encryptVaultKeyForDevice,
  shareVaultKeyWithDevice,
  type DeviceInfo
} from "../lib/device-trust";
import {
  useSettings,
  useVault,
  useAuth,
  useRecovery,
  useAutoLock,
  useExtensionBridge,
  isWeakPassword,
  type ItemForm,
  type ExtensionBridgeUiState
} from "../hooks";
import { useOfflineSync } from "../hooks/useOfflineSync";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// UI-only types and constants
// ---------------------------------------------------------------------------

type SyncConflictState = {
  localRevision: number;
  remoteRevision?: number;
  message: string;
};

type NavItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
};

const useSidebarNav = (unlocked: boolean): NavItem[] =>
  useMemo(
    () => [
      { id: "dashboard", label: "密钥总览", icon: <LayoutDashboard size={18} />, enabled: true },
      { id: "credentials", label: "密文账本", icon: <KeyRound size={18} />, enabled: unlocked },
      { id: "import", label: "迁移铸入", icon: <Download size={18} />, enabled: unlocked },
      { id: "sync", label: "区块中继", icon: <RefreshCw size={18} />, enabled: unlocked },
      { id: "recovery", label: "离线分片", icon: <Shield size={18} />, enabled: unlocked },
      { id: "settings", label: "工坊控制台", icon: <Settings size={18} />, enabled: unlocked }
    ],
    [unlocked]
  );

const NAV_IDS = {
  DASHBOARD: "dashboard",
  CREDENTIALS: "credentials",
  IMPORT: "import",
  SYNC: "sync",
  RECOVERY: "recovery",
  SETTINGS: "settings"
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VaultApp() {
  // --- Hooks ---
  const settings = useSettings();
  const vault = useVault();
  const recovery = useRecovery();
  const auth = useAuth(settings, recovery);
  const ext = useExtensionBridge();

  // Destructure stable functions from hooks for useCallback deps
  const { lockVault: vaultLockVault } = vault;
  const { clearSession: extClearSession } = ext;

  // --- UI-only state (not in hooks) ---
  const [error, setError] = useState("");
  const [status, setStatus] = useState("已锁定");
  const [syncConflict, setSyncConflict] = useState<SyncConflictState | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Item-level sync state
  const [itemSyncInfos, setItemSyncInfos] = useState<ItemSyncInfo[]>([]);
  const [itemConflicts, setItemConflicts] = useState<{ itemId: string; reason: string; localRevision: number | undefined; serverRevision: number | undefined }[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Device trust state
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>("");
  const [showDeviceSection, setShowDeviceSection] = useState(false);

  // UI state
  const [activeNav, setActiveNav] = useState<string>(NAV_IDS.DASHBOARD);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterMode, setFilterMode] = useState<string>("all");
  const [passwordRevealedId, setPasswordRevealedId] = useState<string | null>(null);
  const [showAccountSection, setShowAccountSection] = useState(false);

  // Sync event log
  const [syncEvents, setSyncEvents] = useState<SyncEvent[]>([]);

  const addSyncEvent = useCallback((event: Omit<SyncEvent, "id" | "timestamp">) => {
    setSyncEvents((prev) => [
      { ...event, id: crypto.randomUUID(), timestamp: new Date().toISOString() },
      ...prev.slice(0, 49)
    ]);
  }, []);

  // Derived values from hooks
  const isUnlocked = !vault.isLocked;
  const isLocked = vault.isLocked;
  const sidebarNav = useSidebarNav(isUnlocked);
  const conflictCount = itemConflicts.length;

  const unsyncedCount = useMemo(() => {
    if (!vault.unlockedVault) return 0;
    return itemSyncInfos.filter((info) => info.status === "pending").length;
  }, [vault.unlockedVault, itemSyncInfos]);

  // Filtered items
  const filteredItems = useMemo(() => {
    if (!vault.unlockedVault) return [];
    let items = vault.unlockedVault.snapshot.items;

    // Apply search filter
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      items = items.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          (isLogin(item) && (item.origin.toLowerCase().includes(q) || item.username.toLowerCase().includes(q)))
      );
    }

    // Apply category filter
    switch (filterMode) {
      case "weak":
        items = items.filter((item) => isLogin(item) && isWeakPassword(item.password));
        break;
      case "duplicate": {
        const passwordCounts = new Map<string, number>();
        for (const item of vault.unlockedVault.snapshot.items) {
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
  }, [vault.unlockedVault, searchQuery, filterMode, itemSyncInfos, itemConflicts]);

  // --- Full lock handler (wires vault lock + extension clear + UI reset) ---
  const handleFullLock = useCallback(() => {
    vaultLockVault();
    extClearSession();
    setShowSecrets(false);
    setSearchQuery("");
    setDrawerOpen(false);
    setPasswordRevealedId(null);
    setFilterMode("all");
    setStatus("已锁定");
    setActiveNav(NAV_IDS.DASHBOARD);
  }, [vaultLockVault, extClearSession]);

  // --- Auto-lock hook ---
  const autoLock = useAutoLock(
    settings.autoLockTimeout,
    isUnlocked,
    handleFullLock
  );

  // ===========================================================================
  // Wrappers around hook actions (add loading/error UI + extension publish)
  // ===========================================================================

  // --- Vault create / unlock wrappers ---

  const handleCreateVault = async (e: FormEvent<HTMLFormElement>) => {
    setError("");
    setLoading(true);
    setStatusMessage("正在创建密码库...");
    try {
      const created = await vault.createVault(e);
      ext.publishSession(created.unlocked.snapshot.items);
      setStatus("已解锁");
      setActiveNav(NAV_IDS.CREDENTIALS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建密码库失败。");
    } finally {
      setLoading(false);
      setStatusMessage("");
    }
  };

  const handleUnlock = async (e: FormEvent<HTMLFormElement>) => {
    setError("");
    if (!vault.encryptedVault) return;
    setLoading(true);
    setStatusMessage("正在解锁...");
    try {
      const unlocked = await vault.unlockVault(e);
      if (!unlocked) return;
      ext.publishSession(unlocked.snapshot.items);
      setStatus("已解锁");
      setActiveNav(NAV_IDS.CREDENTIALS);
    } catch {
      setStatus("已锁定");
      setError("主密码不正确，或本地密码库已损坏。");
    } finally {
      setLoading(false);
      setStatusMessage("");
    }
  };

  // --- Auth wrappers ---

  const handleRegister = async (e: FormEvent<HTMLFormElement>) => {
    setError("");
    setLoading(true);
    setStatusMessage("正在连接...");
    try {
      await auth.submitRegister(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败。");
    } finally {
      setLoading(false);
      setStatusMessage("");
    }
  };

  const handleLogin = async () => {
    setError("");
    setLoading(true);
    setStatusMessage("正在连接...");
    try {
      await auth.submitLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败。");
    } finally {
      setLoading(false);
      setStatusMessage("");
    }
  };

  const handleLogout = async () => {
    await auth.submitLogout();
  };

  // --- Credential CRUD wrappers ---

  const handleSubmitItem = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (!vault.unlockedVault) {
      setError("请先解锁密码库。");
      return;
    }
    if (!vault.itemForm.origin.startsWith("https://")) {
      setError("自动填充仅支持 HTTPS 站点。");
      return;
    }
    if (!vault.itemForm.password) {
      setError("密码不能为空。");
      return;
    }

    setLoading(true);
    try {
      const editingId = vault.editingId;
      const persisted = editingId
        ? await vault.editItem(editingId, vault.itemForm)
        : await vault.addItem(vault.itemForm);
      ext.publishSession(persisted.unlocked.snapshot.items);
      setDrawerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存凭据失败。");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!vault.unlockedVault) return;
    setLoading(true);
    try {
      const persisted = await vault.removeItem(id);
      ext.publishSession(persisted.unlocked.snapshot.items);
      setDeleteConfirmId(null);
      if (vault.editingId === id) {
        setDrawerOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除凭据失败。");
    } finally {
      setLoading(false);
    }
  };

  const handleBatchDelete = async (ids: string[]) => {
    setError("");
    if (!vault.unlockedVault) {
      setError("请先解锁密码库。");
      return;
    }
    if (ids.length === 0) return;

    setLoading(true);
    try {
      const persisted = await vault.batchRemove(ids);
      if (persisted) {
        ext.publishSession(persisted.unlocked.snapshot.items);
      }
      setDeleteConfirmId(null);
      const idSet = new Set(ids);
      if (vault.editingId && idSet.has(vault.editingId)) {
        setDrawerOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量删除凭据失败。");
    } finally {
      setLoading(false);
    }
  };

  // --- CSV import wrapper ---

  const handleImportCsv = async (file: File) => {
    setError("");
    setLoading(true);
    try {
      const persisted = await vault.importCsv(file);
      ext.publishSession(persisted.unlocked.snapshot.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV 导入失败。");
    } finally {
      setLoading(false);
    }
  };

  // --- Cloud restore wrapper ---

  const handleRestoreFromCloud = async () => {
    setError("");
    setLoading(true);
    try {
      await auth.restoreFromCloud();
      syncConflict && setSyncConflict(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复失败。");
    } finally {
      setLoading(false);
    }
  };

  // --- Settings wrappers ---

  const handleChangeMasterPassword = async (current: string, newPass: string) => {
    await vault.changeMasterPassword(current, newPass);
    if (vault.unlockedVault) {
      ext.publishSession(vault.unlockedVault.snapshot.items);
    }
  };

  const handleAccountDeletion = async () => {
    await auth.handleDeleteAccount();
    window.location.reload();
  };

  // --- Recovery wrapper ---

  const handleGenerateRecovery = async () => {
    if (!vault.unlockedVault) return;
    const vaultKeyBytes =
      vault.unlockedVault.runtime === "webcrypto-mvp"
        ? new Uint8Array(await crypto.subtle.exportKey("raw", vault.unlockedVault.key))
        : vault.unlockedVault.key;
    await recovery.handleCreateRecoveryCode(vaultKeyBytes, auth.csrfToken);
  };

  // --- Drawer helpers (wire vault.itemForm / vault.editingId) ---

  const openDrawerForCreate = () => {
    vault.setEditingId(null);
    vault.setItemForm(vault.emptyItemForm);
    setError("");
    setDrawerOpen(true);
  };

  const openDrawerForEdit = (item: VaultItem) => {
    vault.setEditingId(item.id);
    if (isLogin(item)) {
      vault.setItemForm({
        title: item.title,
        origin: item.origin,
        username: item.username,
        password: item.password,
        notes: item.notes,
        folder: item.folder ?? "",
        totp: item.totp ?? ""
      });
    } else {
      vault.setItemForm({
        title: item.title,
        origin: "",
        username: "",
        password: "",
        notes: item.notes,
        folder: item.folder ?? "",
        totp: ""
      });
    }
    setError("");
    setDrawerOpen(true);
  };

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    vault.setEditingId(null);
    vault.setItemForm(vault.emptyItemForm);
    setError("");
  }, [vault.setEditingId, vault.setItemForm, vault.emptyItemForm]);

  const handleDrawerFormChange = useCallback((field: string, value: string) => {
    vault.setItemForm((form) => ({ ...form, [field]: value }));
  }, [vault.setItemForm]);

  const handleDrawerCopyPassword = () => {
    if (vault.itemForm.password) {
      void handleCopy(vault.itemForm.password, "drawer-password");
    }
  };

  // --- Copy helper ---

  const handleCopy = async (text: string, fieldId: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const formatDateTime = (iso: string) =>
    new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  // ===========================================================================
  // Inline functions (no hooks yet): sync, conflicts, recovery, device trust
  // ===========================================================================

  // --- Sync ---

  const syncNow = async () => {
    setError("");
    setSyncConflict(null);
    if (!vault.encryptedVault) {
      const message = "请先创建本地密码库后再同步。";
      auth.setSyncStatus("同步需要本地密码库");
      setError(message);
      addSyncEvent({ type: "error", description: message });
      return;
    }
    if (!auth.user || !auth.csrfToken) {
      const message = "请先在左侧账户区注册或登录后再同步。";
      auth.setSyncStatus("同步需要登录");
      setError(message);
      addSyncEvent({ type: "error", description: message });
      return;
    }

    setLoading(true);
    setStatusMessage("正在同步...");
    addSyncEvent({ type: "pull", description: "开始同步…" });
    try {
      const remote = await pullVault();
      addSyncEvent({ type: "pull", description: `拉取远端数据完成，版本 ${remote.serverRevision}` });
      const baseRevision = loadLocalServerRevision();

      // Merge remote items into local vault if we have one unlocked
      if (vault.unlockedVault && remote.items.length > 0) {
        const { vault: merged } = await mergeRemoteItems(vault.unlockedVault, remote.items);
        const persisted = await persistUnlockedVault(merged);
        vault.replaceVault(persisted.unlocked);
        vault.replaceEncryptedVault(persisted.encrypted);
        ext.publishSession(persisted.unlocked.snapshot.items);
      }

      // Try item-level sync first
      if (vault.unlockedVault) {
        try {
          const result = await performItemLevelSync(
            vault.unlockedVault,
            auth.user.id,
            (plan) => pushItemLevelSync(auth.csrfToken, plan)
          );

          if (result.protocol === "item_level_v1") {
            if (result.hasConflicts) {
              auth.setSyncStatus("检测到冲突");
              const conflicts = extractConflicts(result.response);
              setItemConflicts(
                conflicts.map((c) => ({
                  itemId: c.itemId,
                  reason: c.reason,
                  localRevision: c.clientBaseRevision,
                  serverRevision: c.serverItemRevision
                }))
              );
              setItemSyncInfos(result.itemInfos);
              addSyncEvent({ type: "conflict", description: `检测到 ${conflicts.length} 个冲突`, itemCount: conflicts.length });
            } else {
              auth.setSyncStatus(`已同步 · 版本 ${result.response.serverRevision}`);
              auth.setUser({ ...auth.user, serverRevision: result.response.serverRevision });
              setItemSyncInfos(result.itemInfos);
              setItemConflicts([]);
              setLastSyncedAt(new Date().toISOString());
              auth.setCanRestoreFromCloud(false);
              setSyncConflict(null);
              const appliedCount = result.response.applied.upsertedItemIds.length + result.response.applied.deletedItemIds.length;
              addSyncEvent({ type: "push", description: `同步完成，版本 ${result.response.serverRevision}`, itemCount: appliedCount });
            }
            offlineSync.dequeueAll();
            return;
          }
        } catch {
          // Item-level sync failed, fall through to legacy
        }
      }

      // Legacy whole-envelope sync fallback
      if (remote.serverRevision !== baseRevision) {
        auth.setSyncStatus(`冲突 · 本地 ${baseRevision}，远端 ${remote.serverRevision}`);
        setSyncConflict({
          localRevision: baseRevision,
          remoteRevision: remote.serverRevision,
          message: "远端加密密码库在此浏览器上次同步后已变更。"
        });
        addSyncEvent({ type: "conflict", description: `版本冲突 · 本地 ${baseRevision}，远端 ${remote.serverRevision}` });
        return;
      }

      const result = await pushVault(auth.csrfToken, encryptedVaultToSyncRequest(vault.encryptedVault!, auth.user.id, baseRevision));
      saveLocalServerRevision(result.serverRevision);
      auth.setUser({ ...auth.user, serverRevision: result.serverRevision });
      auth.setSyncStatus(`已同步 · 版本 ${result.serverRevision}`);
      auth.setCanRestoreFromCloud(false);
      addSyncEvent({ type: "push", description: `同步完成，版本 ${result.serverRevision}` });
      offlineSync.dequeueAll();
    } catch (syncError) {
      const message = getErrorMessage(syncError);
      if (syncError instanceof Error && syncError.message === "sync_conflict") {
        auth.setSyncStatus("冲突");
        setSyncConflict({
          localRevision: loadLocalServerRevision(),
          message: "服务器拒绝了此次推送，因为远端版本更新。"
        });
        addSyncEvent({ type: "conflict", description: "服务器拒绝推送，远端版本已更新" });
      } else {
        const online = offlineSync.isOnline;
        auth.setSyncStatus(online ? "同步失败" : "离线");
        setError(online ? `同步失败：${message}` : "当前离线，连接后将自动同步。");
        addSyncEvent({ type: "error", description: online ? `同步失败：${message}` : "离线" });

        // Enqueue all items for retry when back online
        if (vault.unlockedVault) {
          for (const item of vault.unlockedVault.snapshot.items) {
            offlineSync.enqueueItem(item.id, "upsert");
          }
        }
      }
    } finally {
      setLoading(false);
      setStatusMessage("");
    }
  };

  // Offline sync hook — placed after syncNow so it receives the function as a parameter
  const offlineSync = useOfflineSync(syncNow);

  // --- Conflict resolution ---

  const resolveKeepLocal = async (itemId: string) => {
    if (!vault.unlockedVault || !auth.user || !auth.csrfToken) return;
    const item = vault.unlockedVault.snapshot.items.find((i) => i.id === itemId);
    if (!item) return;

    setLoading(true);
    try {
      const revisionMap = loadItemRevisionMap();
      const baseRevision = revisionMap[itemId] ?? 0;
      const { plan } = await buildItemLevelSyncPlan(
        { ...vault.unlockedVault, snapshot: { ...vault.unlockedVault.snapshot, items: [item] } },
        auth.user.id,
        { [itemId]: baseRevision },
        new Set(),
        loadLocalServerRevision()
      );
      const response = await pushItemLevelSync(auth.csrfToken, plan);
      const conflicts = response.conflicts ?? [];
      if (conflicts.length === 0) {
        const updatedMap = { ...revisionMap, [itemId]: response.serverRevision };
        saveItemRevisionMap(updatedMap);
        setItemConflicts((prev) => prev.filter((c) => c.itemId !== itemId));
        setItemSyncInfos((prev) =>
          prev.map((info) => (info.itemId === itemId ? { ...info, status: "synced" as const } : info))
        );
      } else {
        setError(`服务器仍然报告 "${item.title}" 存在冲突。`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新推送失败。");
    } finally {
      setLoading(false);
    }
  };

  const resolveAcceptRemote = async (itemId: string) => {
    if (!vault.unlockedVault || !auth.csrfToken) return;
    setLoading(true);
    try {
      const remote = await pullVault();
      const remoteItem = remote.items.find((i) => i.id === itemId);
      if (!remoteItem) {
        setError("远端条目未找到。");
        return;
      }
      const { mergeRemoteItems: merge } = await import("../lib/sync-vault");
      const { vault: merged } = await merge(vault.unlockedVault, [remoteItem]);
      const persisted = await persistUnlockedVault(merged);
      vault.replaceVault(persisted.unlocked);
      vault.replaceEncryptedVault(persisted.encrypted);
      ext.publishSession(persisted.unlocked.snapshot.items);
      setItemConflicts((prev) => prev.filter((c) => c.itemId !== itemId));
      setItemSyncInfos((prev) =>
        prev.map((info) => (info.itemId === itemId ? { ...info, status: "synced" as const } : info))
      );
      const conflictIds = loadConflictIds();
      conflictIds.delete(itemId);
      saveConflictIds(conflictIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "接受远端版本失败。");
    } finally {
      setLoading(false);
    }
  };

  const resolveCreateCopy = async (itemId: string) => {
    if (!vault.unlockedVault) return;
    const item = vault.unlockedVault.snapshot.items.find((i) => i.id === itemId);
    if (!item || !isLogin(item)) return;

    setLoading(true);
    try {
      const copy = addCredential(vault.unlockedVault, {
        title: `${item.title} (副本)`,
        origin: item.origin,
        username: item.username,
        password: item.password,
        notes: item.notes
      });
      const persisted = await persistUnlockedVault(copy);
      vault.replaceVault(persisted.unlocked);
      vault.replaceEncryptedVault(persisted.encrypted);
      ext.publishSession(persisted.unlocked.snapshot.items);
      setItemConflicts((prev) => prev.filter((c) => c.itemId !== itemId));
      const conflictIds = loadConflictIds();
      conflictIds.delete(itemId);
      saveConflictIds(conflictIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建副本失败。");
    } finally {
      setLoading(false);
    }
  };

  const resolveSkip = (itemId: string) => {
    setItemConflicts((prev) => prev.filter((c) => c.itemId !== itemId));
    const conflictIds = loadConflictIds();
    conflictIds.delete(itemId);
    saveConflictIds(conflictIds);
  };

  // --- Recovery ---

  const handleRecoverVault = async () => {
    setError("");
    if (!recovery.recoveryInputCode) {
      setError("请输入恢复码。");
      return;
    }

    setLoading(true);
    try {
      // Try localStorage first, then server
      let packet = loadRecoveryPacket();
      if (!packet) {
        packet = await fetchRecoveryPacket();
      }
      if (!packet) {
        setError("未找到恢复包。恢复包可能尚未上传到服务器，或此设备上没有本地副本。");
        return;
      }
      const vaultKeyBytes = await recoverVaultKey(recovery.recoveryInputCode, packet);

      if (recovery.recoveryPassword.length < 12) {
        setError("请设置新的主密码（至少 12 个字符）以重新加密密码库。");
        recovery.setShowRecoveryEntry(true);
        return;
      }

      let recoveredItems: VaultItem[] = [];
      if (vault.encryptedVault) {
        const recoveredLocalVault = await unlockLocalVaultWithRecoveredKey(vault.encryptedVault, vaultKeyBytes);
        recoveredItems = recoveredLocalVault.snapshot.items;
      } else {
        // Fallback: pull vault items from server and decrypt with recovered key.
        const remote = await pullVault();
        if (remote.items.length > 0) {
          const tempVault: UnlockedVault = {
            runtime: "crypto-core-wasm",
            key: vaultKeyBytes,
            kdf: { alg: "ARGON2ID_V13", memoryKib: 19456, iterations: 2, parallelism: 1, salt: "" },
            snapshot: { schemaVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items: [] }
          };
          const { vault: merged } = await mergeRemoteItems(tempVault, remote.items);
          recoveredItems = merged.snapshot.items;
        }
      }

      // Create a new vault with the new master password
      const created = await createEmptyLocalVault(recovery.recoveryPassword);
      let restoredVault = created.unlocked;
      for (const item of recoveredItems) {
        if (!isLogin(item)) continue;
        restoredVault = addCredential(restoredVault, {
          title: item.title,
          origin: item.origin,
          username: item.username,
          password: item.password,
          notes: item.notes
        });
      }
      const persisted = await persistUnlockedVault(restoredVault);
      saveEncryptedLocalVault(persisted.encrypted);
      vault.replaceEncryptedVault(persisted.encrypted);
      vault.replaceVault(persisted.unlocked);
      ext.publishSession(persisted.unlocked.snapshot.items);
      recovery.setShowRecoveryEntry(false);
      recovery.setRecoveryInputCode("");
      recovery.setRecoveryPassword("");
      setStatus("已解锁");
      auth.setSyncStatus(`密码库已恢复，包含 ${recoveredItems.length} 条凭据。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复失败。请检查恢复码。");
    } finally {
      setLoading(false);
    }
  };

  // --- Device trust ---

  const refreshDevices = useCallback(async () => {
    if (!auth.csrfToken) {
      const message = "请先登录后再刷新设备列表。";
      setError(message);
      auth.setSyncStatus("设备刷新需要登录");
      addSyncEvent({ type: "error", description: message });
      return;
    }
    try {
      const deviceList = await listDevices(auth.csrfToken);
      const currentDeviceId = getDeviceId();
      if (currentDeviceId) setCurrentDeviceId(currentDeviceId);
      setDevices(deviceList);
    } catch (err) {
      const message = getErrorMessage(err);
      setError(`设备列表刷新失败：${message}`);
      auth.setSyncStatus("设备列表刷新失败");
      addSyncEvent({ type: "error", description: `设备列表刷新失败：${message}` });
    }
  }, [addSyncEvent, auth.csrfToken]);

  const handleApproveDevice = async (deviceId: string) => {
    if (!auth.csrfToken) {
      const message = "请先登录后再批准设备。";
      setError(message);
      auth.setSyncStatus("设备操作需要登录");
      addSyncEvent({ type: "error", description: message });
      return;
    }

    setError("");
    try {
      const result = await approveDevice(auth.csrfToken, deviceId);
      if (!result.ok) {
        throw new Error("approve_failed");
      }

      // Share the vault key with the newly approved device
      if (vault.unlockedVault) {
        try {
          const approvedDevice = devices.find((d) => d.id === deviceId);
          if (approvedDevice) {
            const vaultKeyBytes =
              vault.unlockedVault.runtime === "webcrypto-mvp"
                ? new Uint8Array(await crypto.subtle.exportKey("raw", vault.unlockedVault.key))
                : vault.unlockedVault.key;
            const encryptedBlob = await encryptVaultKeyForDevice(approvedDevice.publicKey, vaultKeyBytes);
            await shareVaultKeyWithDevice(auth.csrfToken, deviceId, encryptedBlob);
          }
        } catch {
          addSyncEvent({ type: "error", description: "设备已批准，但密钥共享失败。请稍后重试设备同步。" });
        }
      }

      auth.setSyncStatus("设备已批准");
      addSyncEvent({ type: "device-approved", description: "设备已批准" });
      await refreshDevices();
    } catch (err) {
      const message = getErrorMessage(err);
      setError(`批准设备失败：${message}`);
      auth.setSyncStatus("批准设备失败");
      addSyncEvent({ type: "error", description: `批准设备失败：${message}` });
    }
  };

  const handleRejectDevice = async (deviceId: string) => {
    if (!auth.csrfToken) {
      const message = "请先登录后再拒绝设备。";
      setError(message);
      auth.setSyncStatus("设备操作需要登录");
      addSyncEvent({ type: "error", description: message });
      return;
    }

    setError("");
    try {
      const result = await rejectDevice(auth.csrfToken, deviceId);
      if (!result.ok) {
        throw new Error("reject_failed");
      }
      auth.setSyncStatus("设备已拒绝");
      addSyncEvent({ type: "device-rejected", description: "设备已拒绝" });
      await refreshDevices();
    } catch (err) {
      const message = getErrorMessage(err);
      setError(`拒绝设备失败：${message}`);
      auth.setSyncStatus("拒绝设备失败");
      addSyncEvent({ type: "error", description: `拒绝设备失败：${message}` });
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    if (!auth.csrfToken) {
      const message = "请先登录后再撤销设备。";
      setError(message);
      auth.setSyncStatus("设备操作需要登录");
      addSyncEvent({ type: "error", description: message });
      return;
    }

    setError("");
    try {
      const result = await revokeDevice(auth.csrfToken, deviceId);
      if (!result.ok) {
        throw new Error("revoke_failed");
      }
      auth.setSyncStatus("设备已撤销");
      addSyncEvent({ type: "device-revoked", description: "设备已撤销" });
      await refreshDevices();
    } catch (err) {
      const message = getErrorMessage(err);
      setError(`撤销设备失败：${message}`);
      auth.setSyncStatus("撤销设备失败");
      addSyncEvent({ type: "error", description: `撤销设备失败：${message}` });
    }
  };

  // ===========================================================================
  // Effects
  // ===========================================================================

  // Mount: load vault, bootstrap session, load sync state
  useEffect(() => {
    ext.refreshCapabilities();
    vault.loadExistingVault();
    auth.bootstrapSession();

    setLastSyncedAt(loadLastSyncedAt());
    setItemConflicts(
      [...loadConflictIds()].map((id) => ({ itemId: id, reason: "server_revision_advanced", localRevision: undefined, serverRevision: undefined }))
    );
    // Online/offline monitoring is handled by useOfflineSync hook
  }, [ext.refreshCapabilities, vault.loadExistingVault, auth.bootstrapSession]);

  // Auto-sync interval
  useEffect(() => {
    if (!settings.autoSyncEnabled || !vault.unlockedVault || !auth.user || !auth.csrfToken) return;

    const intervalMs = settings.syncInterval * 1000;
    const timer = setInterval(() => {
      void syncNow();
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [settings.autoSyncEnabled, settings.syncInterval, vault.unlockedVault, auth.user, auth.csrfToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-register device on sign-in
  useEffect(() => {
    if (auth.user && auth.csrfToken) {
      void registerDevice(auth.csrfToken);
      void refreshDevices();
    }
  }, [auth.user, auth.csrfToken, refreshDevices]);

  // ===========================================================================
  // JSX
  // ===========================================================================

  // --- Sidebar ---
  const sidebarElement = (
    <Sidebar
      unlocked={isUnlocked}
      activeNav={activeNav}
      onNavChange={setActiveNav}
      sidebarNav={sidebarNav}
      extensionBridge={ext.state}
      syncStatus={auth.syncStatus}
      isOffline={!offlineSync.isOnline}
      onLockVault={handleFullLock}
      user={auth.user}
      showAccountSection={showAccountSection}
      onToggleAccountSection={() => setShowAccountSection((v) => !v)}
      canRestoreFromCloud={auth.canRestoreFromCloud}
      encryptedVault={vault.encryptedVault}
      onRestoreFromCloud={handleRestoreFromCloud}
      onSyncNow={syncNow}
      onLogout={handleLogout}
      loading={loading}
      accountEmail={auth.accountEmail}
      onAccountEmailChange={auth.setAccountEmail}
      accountPassword={auth.accountPassword}
      onAccountPasswordChange={auth.setAccountPassword}
      onRegister={(e) => void handleRegister(e as FormEvent<HTMLFormElement>)}
      onLogin={handleLogin}
      folders={[]}
      folderItemCounts={new Map()}
      allCount={0}
      uncategorizedCount={0}
      selectedFolder={null}
      onFolderSelect={() => {}}
      credentialsNavId={NAV_IDS.CREDENTIALS}
    />
  );

  // --- Locked state ---
  const lockedStateElement = (
    <LockedState
      hasLocalVault={vault.hasLocalVault}
      masterPassword={vault.masterPassword}
      onMasterPasswordChange={vault.setMasterPassword}
      onSubmit={(e) => void (vault.hasLocalVault ? handleUnlock : handleCreateVault)(e as FormEvent<HTMLFormElement>)}
      loading={loading}
      statusMessage={statusMessage}
      extensionBridge={ext.state}
      showRecoveryEntry={recovery.showRecoveryEntry}
      onToggleRecoveryEntry={() => recovery.setShowRecoveryEntry((v) => !v)}
      recoveryInputCode={recovery.recoveryInputCode}
      onRecoveryInputCodeChange={recovery.setRecoveryInputCode}
      recoveryPassword={recovery.recoveryPassword}
      onRecoveryPasswordChange={recovery.setRecoveryPassword}
      onRecoverVault={() => void handleRecoverVault()}
      error={error}
    />
  );

  // --- Offline sync banner ---
  const offlineSyncBanner = offlineSync.showRetrySuccess ? (
    <div className="success-banner" role="status">
      <RefreshCw size={16} />
      <span>链路已恢复，待投递区块已完成回执。</span>
      <button
        className="banner-close-button"
        type="button"
        onClick={offlineSync.dismissRetrySuccess}
        aria-label="关闭同步成功提示"
      >
        &times;
      </button>
    </div>
  ) : null;

  const pendingMutationsBanner =
    !offlineSync.isOnline ? (
      <div className="error-banner" role="alert">
        <AlertTriangle size={16} />
        <span>当前离线，{offlineSync.pendingCount > 0 ? `${offlineSync.pendingCount} 枚区块待投递。` : ""}连接后将自动中继。</span>
      </div>
    ) : offlineSync.pendingCount > 0 ? (
      <div className="error-banner" role="alert">
        <RefreshCw size={16} />
        <span>{offlineSync.pendingCount} 枚区块待投递。上次中继失败，将自动重试。</span>
        <Button variant="secondary" className="banner-action" type="button" onClick={offlineSync.retryNow}>
          立即重试
        </Button>
      </div>
    ) : offlineSync.failedCount > 0 ? (
      <div className="error-banner" role="alert">
        <AlertTriangle size={16} />
        <span>{offlineSync.failedCount} 枚区块投递失败，已达最大重试次数。</span>
        <Button variant="secondary" className="banner-action" type="button" onClick={offlineSync.clearFailed}>
          清空队列
        </Button>
      </div>
    ) : null;

  // --- Credential list (unlocked) ---
  const credentialListContent = (
    <>
      {/* Stats cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-card-label">密文条目</span>
          <span className="stat-card-value">{vault.itemCount}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">最近铸写</span>
          <span className="stat-card-value stat-card-value--muted">{vault.updatedAt}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-label">区块回执</span>
          <span className={`stat-card-value ${
            auth.syncStatus.includes("已同步") ? "stat-card-value--success" :
            auth.syncStatus.includes("冲突") ? "stat-card-value--warning" :
            "stat-card-value--muted"
          } stat-card-value--compact`}>
            {auth.syncStatus}
          </span>
        </div>
        {lastSyncedAt ? (
          <div className="stat-card">
            <span className="stat-card-label">上次上链</span>
            <span className="stat-card-value stat-card-value--muted">
              {formatDateTime(lastSyncedAt)}
            </span>
          </div>
        ) : null}
      </div>

      {offlineSyncBanner}

      {pendingMutationsBanner}

      {error ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      {/* Import section */}
      {activeNav === NAV_IDS.IMPORT ? (
        <CsvImport loading={loading} importStatus={vault.importStatus} onImport={handleImportCsv} />
      ) : null}

      {/* Conflict panel */}
      {itemConflicts.length > 0 && vault.unlockedVault ? (
        <ConflictResolutionPanel
          conflicts={itemConflicts.map((c) => {
            const localItem = vault.unlockedVault!.snapshot.items.find((i) => i.id === c.itemId);
            return {
              itemId: c.itemId,
              title: localItem?.title ?? "未知条目",
              reason: c.reason,
              localRevision: c.localRevision,
              serverRevision: c.serverRevision
            };
          })}
          onResolve={(itemId, action) => {
            switch (action) {
              case "keep-local": void resolveKeepLocal(itemId); break;
              case "accept-remote": void resolveAcceptRemote(itemId); break;
              case "create-copy": void resolveCreateCopy(itemId); break;
              case "skip": resolveSkip(itemId); break;
            }
          }}
          onResolveAll={(action) => {
            for (const c of itemConflicts) {
              switch (action) {
                case "keep-local": void resolveKeepLocal(c.itemId); break;
                case "accept-remote": void resolveAcceptRemote(c.itemId); break;
                case "create-copy": void resolveCreateCopy(c.itemId); break;
                case "skip": resolveSkip(c.itemId); break;
              }
            }
          }}
          loading={loading}
        />
      ) : null}

      {/* Recovery section */}
      {activeNav === NAV_IDS.RECOVERY && vault.unlockedVault ? (
        <RecoverySetup loading={loading} onGenerateRecoveryCode={handleGenerateRecovery} />
      ) : null}

      {/* Device section */}
      {activeNav === NAV_IDS.SYNC && auth.user ? (
        <SyncDevicePanel
          vault={vault.unlockedVault ?? vault.encryptedVault}
          onSync={syncNow}
          onApproveDevice={handleApproveDevice}
          onRejectDevice={handleRejectDevice}
          onRevokeDevice={handleRevokeDevice}
          syncStatus={auth.syncStatus}
          lastSyncedAt={lastSyncedAt}
          itemSyncInfos={itemSyncInfos}
          devices={devices}
          currentDeviceId={currentDeviceId}
          loading={loading}
          isOffline={!offlineSync.isOnline}
          onRefreshDevices={refreshDevices}
        />
      ) : null}

      {/* Sync panel */}
      {activeNav === NAV_IDS.SYNC ? (
        <SyncPanel
          syncStatus={auth.syncStatus}
          lastSyncedAt={lastSyncedAt}
          itemSyncInfos={itemSyncInfos}
          syncEvents={syncEvents}
          loading={loading}
          isOffline={!offlineSync.isOnline}
          onSync={syncNow}
        />
      ) : null}

      {/* Extension bridge details */}
      {activeNav === NAV_IDS.SYNC ? (
        <div className="extension-panel">
          <h3>扩展连接</h3>
          {!ext.state.configured || !ext.state.runtimeAvailable ? (
            <div className="extension-unavailable">
              未检测到浏览器扩展。自动填充已禁用。
            </div>
          ) : null}
          <div className="extension-status-grid">
            <div className="extension-status-cell">
              <span>扩展 ID</span>
              <strong>{ext.state.configured ? "已配置" : "缺失"}</strong>
            </div>
            <div className="extension-status-cell">
              <span>通信状态</span>
              <strong>{ext.state.runtimeAvailable ? ext.state.communication : "不可用"}</strong>
            </div>
            <div className="extension-status-cell">
              <span>上次发布</span>
              <strong>{ext.state.lastPublish}</strong>
            </div>
            <div className="extension-status-cell">
              <span>上次清空</span>
              <strong>{ext.state.lastClear}</strong>
            </div>
          </div>
        </div>
      ) : null}

      {/* Settings page */}
      {activeNav === NAV_IDS.SETTINGS && vault.unlockedVault ? (
        <SettingsPage
          autoLockTimeout={settings.autoLockTimeout}
          onAutoLockTimeoutChange={settings.setAutoLockTimeout}
          extensionId={settings.extensionId}
          onExtensionIdChange={settings.setExtensionId}
          onChangeMasterPassword={handleChangeMasterPassword}
          onDeleteAccount={handleAccountDeletion}
          onExportCsv={vault.exportCsv}
          onExportEncrypted={vault.exportEncrypted}
          autoSyncEnabled={settings.autoSyncEnabled}
          onAutoSyncEnabledChange={settings.setAutoSyncEnabled}
          syncInterval={settings.syncInterval}
          onSyncIntervalChange={settings.setSyncInterval}
          loading={loading}
          onExportCsvSelected={() => {}}
          onExportEncryptedSelected={() => {}}
          selectedCount={0}
          onImportEncryptedBackup={async () => {}}
          importBackupStatus=""
        />
      ) : null}

      {/* Credential list */}
      <CredentialList
        items={filteredItems}
        searchQuery={searchQuery}
        filterMode={filterMode}
        onFilterModeChange={setFilterMode}
        folderFilter={null}
        passwordRevealedId={passwordRevealedId}
        onTogglePasswordReveal={(id) => setPasswordRevealedId(passwordRevealedId === id ? null : id)}
        onCopyUsername={(id, username) => void handleCopy(username, `user-${id}`)}
        onCopyPassword={(id, password) => void handleCopy(password, `pass-${id}`)}
        onEdit={openDrawerForEdit}
        onAdd={openDrawerForCreate}
        onDelete={handleDeleteItem}
        deleteConfirmId={deleteConfirmId}
        onDeleteConfirm={setDeleteConfirmId}
        onDeleteCancel={() => setDeleteConfirmId(null)}
        onBatchDelete={(ids) => void handleBatchDelete(ids)}
        loading={loading}
      />
    </>
  );

  // --- Copy toast ---
  const copyToast = copiedField ? (
    <div className="vault-toast-stack">
      <Toast variant="success" message="已复制到设备剪贴板" duration={0} />
    </div>
  ) : null;

  // --- Main render ---
  return (
    <div className="app-shell">
      {sidebarElement}

      <div className="app-main">
        {isLocked ? null : (
          <TopBar
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            syncStatus={auth.syncStatus}
            autoLockRemaining={autoLock.autoLockRemaining}
            onSyncNow={syncNow}
            loading={loading}
            statusMessage={statusMessage}
          />
        )}

        <div className={isLocked ? "main-content-centered" : "main-content"}>
          {isLocked ? lockedStateElement : credentialListContent}
        </div>
      </div>

      <CredentialDrawer
        isOpen={drawerOpen}
        onClose={closeDrawer}
        editingId={vault.editingId}
        itemForm={vault.itemForm}
        onFormChange={handleDrawerFormChange}
        onSave={(e) => void handleSubmitItem(e as FormEvent<HTMLFormElement>)}
        onDelete={() => {
          if (vault.editingId) {
            setDeleteConfirmId(vault.editingId);
            void handleDeleteItem(vault.editingId);
          }
        }}
        onGeneratePassword={vault.handleGeneratePassword}
        onCopyPassword={handleDrawerCopyPassword}
        loading={loading}
        error={error}
        folders={[]}
      />

      <RecoveryModal
        isOpen={recovery.showRecoveryModal}
        onClose={recovery.closeRecoveryModal}
        recoveryCode={recovery.recoveryCode}
        onCopy={() => void copyToClipboard(recovery.recoveryCode)}
        confirmed={recovery.recoveryConfirmed}
        onConfirmChange={recovery.setRecoveryConfirmed}
      />

      {copyToast}
    </div>
  );
}
