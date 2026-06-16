import { useState, useCallback, useMemo, useEffect, useRef, type FormEvent } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  Download,
  GitMerge,
  KeyRound,
  LayoutDashboard,
  RefreshCw,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Upload,
} from "lucide-react";
import type { ImportLoginRow, VaultItem } from "@zero-vault/shared";
import { useAuthState } from "./state/auth-state";
import { useVaultState } from "./state/vault-state";
import { useOfflineSync } from "./hooks/use-offline-sync";
import { useFolders } from "./hooks/use-folders";
import { Sidebar } from "./components/shell/sidebar";
import { TopBar } from "./components/shell/top-bar";
import { LockedState } from "./components/shell/locked-state";
import { CredentialList } from "./components/credentials/credential-list";
import { CredentialDetail } from "./components/credentials/credential-detail";
import { AddEditDrawer } from "./components/credentials/add-edit-drawer";
import { ConfirmDeleteDialog } from "./components/credentials/confirm-delete-dialog";
import { CsvImportWizard } from "./components/import";
import { RecoverySetup, RecoveryModal } from "./components/recovery";
import { SyncPanel, type SyncEvent } from "./components/sync/sync-panel";
import {
  ConflictResolutionPanel,
  type ConflictAction,
  type ConflictDisplayItem,
} from "./components/sync/conflict-resolution-panel";
import { DeviceManagementPanel } from "./components/sync/device-management-panel";
import { registerClipboardToast } from "./lib/clipboard";
import { SettingsPage } from "./components/settings";
import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import styles from "./App.module.css";

type PageId =
  | "dashboard"
  | "credentials"
  | "import"
  | "recovery"
  | "sync"
  | "devices"
  | "settings";

const isLoginItem = (item: VaultItem): item is VaultItem & {
  type: "login";
  origin: string;
  username: string;
  password: string;
} => item.type === "login";

const nowIso = () => new Date().toISOString();

function importRowToVaultItem(row: ImportLoginRow): VaultItem {
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    type: "login",
    title: row.title?.trim() || row.origin,
    folder: "导入",
    notes: row.notes ?? "",
    customFields: [],
    origin: row.origin,
    username: row.username,
    password: row.password,
    createdAt: now,
    updatedAt: now,
  };
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "从未同步";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function downloadExportFile(file: {
  filename: string;
  mimeType: string;
  contents: string;
}): void {
  const blob = new Blob([file.contents], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function actionToStrategy(
  action: ConflictAction,
): "keep_local" | "accept_remote" | "create_copy" | "skip" {
  switch (action) {
    case "keep-local":
      return "keep_local";
    case "accept-remote":
      return "accept_remote";
    case "create-copy":
      return "create_copy";
    case "skip":
      return "skip";
  }
}

function DashboardPage({
  itemCount,
  loginCount,
  noteCount,
  cardCount,
  syncStatus,
  conflictCount,
  lastSyncedAt,
  autoLockMinutes,
  deviceCount,
  onNavigate,
  onSync,
}: {
  itemCount: number;
  loginCount: number;
  noteCount: number;
  cardCount: number;
  syncStatus: string;
  conflictCount: number;
  lastSyncedAt: string | null;
  autoLockMinutes: number;
  deviceCount: number;
  onNavigate: (page: PageId) => void;
  onSync: () => void;
}) {
  return (
    <div className={styles.dashboard}>
      <section className={styles.dashboardHero} aria-labelledby="dashboard-title">
        <div>
          <p className={styles.pageEyebrow}>OBSCURA DESKTOP</p>
          <h2 id="dashboard-title" className={styles.pageTitle}>
            密钥工作台
          </h2>
          <p className={styles.pageCopy}>
            本地解密、密文同步、设备信任和恢复码状态集中在此处。所有明文只在解锁后的本机内存中短暂存在。
          </p>
        </div>
        <div className={styles.heroActions}>
          <Button onClick={() => onNavigate("credentials")}>
            <KeyRound size={16} />
            打开密码库
          </Button>
          <Button variant="secondary" onClick={onSync}>
            <RefreshCw size={16} />
            立即同步
          </Button>
        </div>
      </section>

      <section className={styles.statsGrid} aria-label="密码库状态">
        <div className={styles.statCard}>
          <span className={styles.statIcon}><ShieldCheck size={18} /></span>
          <small>总条目</small>
          <strong>{itemCount}</strong>
          <span>登录 {loginCount} · 笔记 {noteCount} · 卡片 {cardCount}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statIcon}><RefreshCw size={18} /></span>
          <small>同步状态</small>
          <strong>{syncStatus}</strong>
          <span>上次同步：{formatDateTime(lastSyncedAt)}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statIcon}><GitMerge size={18} /></span>
          <small>冲突</small>
          <strong>{conflictCount}</strong>
          <span>{conflictCount > 0 ? "需要手动仲裁" : "暂无分叉冲突"}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statIcon}><Smartphone size={18} /></span>
          <small>可信设备</small>
          <strong>{deviceCount}</strong>
          <span>自动锁定：{autoLockMinutes} 分钟</span>
        </div>
      </section>

      <section className={styles.quickGrid}>
        <button type="button" className={styles.quickCard} onClick={() => onNavigate("import")}>
          <Upload size={18} />
          <strong>迁移导入</strong>
          <span>导入浏览器或密码管理器导出的 CSV/JSON 文件。</span>
        </button>
        <button type="button" className={styles.quickCard} onClick={() => onNavigate("recovery")}>
          <Shield size={18} />
          <strong>恢复码</strong>
          <span>生成或验证离线恢复码，恢复包仍以密文保存。</span>
        </button>
        <button type="button" className={styles.quickCard} onClick={() => onNavigate("devices")}>
          <Smartphone size={18} />
          <strong>设备信任</strong>
          <span>查看待审批设备并管理同步链路。</span>
        </button>
      </section>
    </div>
  );
}

function RecoveryPage({
  hasPacket,
  onOpenSetup,
  onOpenRecover,
}: {
  hasPacket: boolean;
  onOpenSetup: () => void;
  onOpenRecover: () => void;
}) {
  return (
    <div className={styles.pageStack}>
      <section className={styles.panelHeader}>
        <p className={styles.pageEyebrow}>RECOVERY</p>
        <h2 className={styles.pageTitle}>离线恢复码</h2>
        <p className={styles.pageCopy}>
          恢复码用于解密本地恢复包并取回 vault key。恢复码不会上传，恢复包只保存密文。
        </p>
      </section>
      <section className={styles.recoveryGrid}>
        <div className={styles.recoveryCard}>
          <ShieldCheck size={22} />
          <h3>{hasPacket ? "恢复包已配置" : "尚未配置恢复包"}</h3>
          <p>
            {hasPacket
              ? "当前账户已有可用恢复包。重新生成会覆盖旧恢复包。"
              : "建议在首次导入或创建凭据后立即生成恢复码。"}
          </p>
          <Button onClick={onOpenSetup}>
            <Shield size={16} />
            {hasPacket ? "重新生成恢复码" : "生成恢复码"}
          </Button>
        </div>
        <div className={styles.recoveryCard}>
          <KeyRound size={22} />
          <h3>验证恢复入口</h3>
          <p>使用已保存的恢复码测试恢复包是否可解密。操作在本地完成。</p>
          <Button variant="secondary" onClick={onOpenRecover} disabled={!hasPacket}>
            打开恢复入口
          </Button>
        </div>
      </section>
    </div>
  );
}

function LoginShell({
  loading,
  error,
  onLogin,
}: {
  loading: boolean;
  error: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    await onLogin(email.trim(), password);
  };

  return (
    <div className={styles.loginShell}>
      <form className={styles.loginCard} onSubmit={handleSubmit}>
        <div className={styles.loginMark} aria-hidden="true">
          <KeyRound size={24} />
        </div>
        <h1 className={styles.loginTitle}>obscura</h1>
        <p className={styles.loginSubtitle}>登录桌面端密钥工作台</p>
        {error && (
          <div className={styles.loginError} role="alert">
            {error}
          </div>
        )}
        <Input
          label="邮箱"
          type="text"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          disabled={loading}
        />
        <Input
          label="密码"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          disabled={loading}
        />
        <Button type="submit" loading={loading} disabled={!email.trim() || !password}>
          登录
        </Button>
        <p className={styles.loginHint}>
          当前桌面端沿用 Worker API 会话与 CSRF 保护；主密码仍只用于本地密码库解锁。
        </p>
      </form>
    </div>
  );
}

export function App() {
  const auth = useAuthState();
  const vault = useVaultState();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { addItem, updateItem, deleteItem, sync, pushOfflineQueue } = vault;
  const { csrfToken } = auth;
  const ownerUserId = auth.user?.id;

  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [syncEvents, setSyncEvents] = useState<SyncEvent[]>([]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const syncFn = useCallback(async () => {
    if (!csrfToken || !ownerUserId) {
      if (auth.user) showToast("同步暂不可用：缺少会话令牌");
      return;
    }
    await pushOfflineQueue(csrfToken, ownerUserId);
    await sync();
  }, [pushOfflineQueue, sync, csrfToken, ownerUserId, auth.user, showToast]);

  const offlineSync = useOfflineSync(syncFn);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"add" | "edit">("add");
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<VaultItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [recoverySetupOpen, setRecoverySetupOpen] = useState(false);
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  const { folders, folderCounts, uncategorizedCount } = useFolders(vault.items);

  const isAuthenticated = auth.user !== null;
  const isUnlocked = isAuthenticated && !vault.isLocked;

  const addSyncEvent = useCallback((event: Omit<SyncEvent, "id" | "timestamp">) => {
    setSyncEvents((prev) => [
      { ...event, id: crypto.randomUUID(), timestamp: nowIso() },
      ...prev.slice(0, 49),
    ]);
  }, []);

  useEffect(() => {
    registerClipboardToast((message) => {
      showToast(message);
    });
  }, [showToast]);

  useEffect(() => {
    auth.restoreSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- restore once on mount

  useEffect(() => {
    if (!isAuthenticated) return;
    void vault.refreshRecoveryPacket();
    if (!isUnlocked) return;
    void vault.refreshSyncSnapshot();
    void vault.refreshDevices();
  }, [isAuthenticated, isUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps -- state hydration on auth/unlock

  const syncStatus = useMemo(() => {
    if (vault.isSyncing) return "同步中...";
    if (vault.conflictCount > 0) return `有 ${vault.conflictCount} 条冲突`;
    if (vault.lastSyncedAt) return "已同步";
    return "未同步";
  }, [vault.isSyncing, vault.conflictCount, vault.lastSyncedAt]);

  const itemStats = useMemo(() => {
    const loginCount = vault.items.filter((item) => item.type === "login").length;
    const noteCount = vault.items.filter((item) => item.type === "secure_note").length;
    const cardCount = vault.items.filter((item) => item.type === "credit_card").length;
    return { loginCount, noteCount, cardCount };
  }, [vault.items]);

  const conflictItems = useMemo<ConflictDisplayItem[]>(
    () =>
      vault.storedItems
        .filter((item) => item.hasConflict || vault.conflictIds.has(item.itemId))
        .map((item) => {
          const plaintext = vault.items.find((candidate) => candidate.id === item.itemId);
          const display: ConflictDisplayItem = {
            itemId: item.itemId,
            title: plaintext?.title ?? `密文条目 ${item.itemId.slice(0, 8)}`,
            reason: "item_revision_advanced",
            localRevision: item.itemRevision,
            serverRevision: item.ciphertext.revision,
            serverItemRevision: item.ciphertext.revision,
            remoteUpdatedAt: item.ciphertext.updatedAt,
          };
          if (plaintext?.updatedAt) display.localUpdatedAt = plaintext.updatedAt;
          if (plaintext) {
            display.localFields = {
              标题: plaintext.title,
              类型: plaintext.type,
              ...(isLoginItem(plaintext)
                ? { 站点: plaintext.origin, 用户名: plaintext.username }
                : {}),
            };
          }
          return display;
        }),
    [vault.storedItems, vault.conflictIds, vault.items],
  );

  const handleNavigate = useCallback((page: string) => {
    setActivePage(page as PageId);
    setSelectedItem(null);
  }, []);

  const handleSync = useCallback(async () => {
    const result = await sync();
    addSyncEvent({
      type: result.ok ? "pull" : "error",
      description: result.ok ? "完成手动同步" : `同步失败：${result.error}`,
      itemCount: vault.items.length,
    });
    if (!result.ok) showToast(result.error);
  }, [sync, addSyncEvent, vault.items.length, showToast]);

  const handleLock = useCallback(() => {
    vault.lock();
    setSelectedItem(null);
    setDrawerOpen(false);
    setDeletingItem(null);
    setImportOpen(false);
    setRecoverySetupOpen(false);
    setRecoveryModalOpen(false);
    setSelectedFolder(null);
    setActivePage("dashboard");
  }, [vault]);

  const handleLogout = useCallback(async () => {
    handleLock();
    await auth.logout();
  }, [handleLock, auth]);

  const handleAdd = useCallback(() => {
    setActivePage("credentials");
    setDrawerMode("add");
    setEditingItem(null);
    setDrawerOpen(true);
  }, []);

  const handleEdit = useCallback((item: VaultItem) => {
    setDrawerMode("edit");
    setEditingItem(item);
    setDrawerOpen(true);
  }, []);

  const handleDelete = useCallback((id: string) => {
    const item = vault.items.find((i) => i.id === id) ?? null;
    setDeletingItem(item);
  }, [vault.items]);

  const handleSave = useCallback(
    async (item: VaultItem) => {
      if (!csrfToken) {
        showToast("登录已过期，请重新登录");
        return;
      }
      if (!auth.user) {
        showToast("登录已过期，请重新登录");
        return;
      }

      const result =
        drawerMode === "add"
          ? await addItem(item, csrfToken, auth.user.id)
          : await updateItem(item, csrfToken, auth.user.id);
      if (!result.ok) {
        if (result.error === "网络错误，请检查连接") {
          offlineSync.enqueueItem(item.id, "upsert");
        }
        showToast(result.error);
        return;
      }
      if (drawerMode === "add") {
        showToast("凭据已创建");
      } else {
        showToast("凭据已更新");
        if (selectedItem?.id === item.id) {
          setSelectedItem(item);
        }
      }
      setDrawerOpen(false);
      setEditingItem(null);
      void handleSync();
    },
    [drawerMode, csrfToken, auth.user, addItem, updateItem, selectedItem, showToast, handleSync],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingItem) return;
    if (!csrfToken) {
      showToast("登录已过期，请重新登录");
      return;
    }
    if (!auth.user) {
      showToast("登录已过期，请重新登录");
      return;
    }

    const result = await deleteItem(deletingItem.id, csrfToken, auth.user.id);
    if (!result.ok) {
      if (result.error === "网络错误，请检查连接") {
        offlineSync.enqueueItem(deletingItem.id, "delete");
      }
      showToast(result.error);
      return;
    }
    showToast("凭据已删除");
    if (selectedItem?.id === deletingItem.id) {
      setSelectedItem(null);
    }
    setDeletingItem(null);
    void handleSync();
  }, [deletingItem, csrfToken, auth.user, deleteItem, selectedItem, showToast, handleSync]);

  const handleImport = useCallback(
    async (rows: ImportLoginRow[]) => {
      if (!csrfToken) throw new Error("unauthorized");
      if (!auth.user) throw new Error("unauthorized");
      let imported = 0;
      const failures: string[] = [];
      for (const row of rows) {
        const result = await addItem(
          importRowToVaultItem(row),
          csrfToken,
          auth.user.id,
        );
        if (result.ok) {
          imported += 1;
        } else {
          failures.push(result.error);
        }
      }
      addSyncEvent({
        type: "push",
        description:
          failures.length > 0
            ? `导入 ${imported} 条，失败 ${failures.length} 条`
            : `导入 ${imported} 条凭据`,
        itemCount: imported,
      });
      if (failures.length > 0) {
        throw new Error(`已导入 ${imported} 条，失败 ${failures.length} 条`);
      }
      showToast(`已导入 ${imported} 条凭据`);
      void handleSync();
    },
    [csrfToken, auth.user, addItem, addSyncEvent, showToast, handleSync],
  );

  const handleResolveConflict = useCallback(
    async (itemId: string, action: ConflictAction) => {
      if (!csrfToken || !auth.user) {
        showToast("登录已过期，请重新登录");
        return;
      }
      const result = await vault.resolveConflict(
        itemId,
        actionToStrategy(action),
        csrfToken,
        auth.user.id,
      );
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      addSyncEvent({
        type: "conflict",
        description: "已处理 1 条同步冲突",
        itemCount: 1,
      });
    },
    [vault, csrfToken, auth.user, addSyncEvent, showToast],
  );

  const handleResolveAll = useCallback(
    async (action: ConflictAction) => {
      if (!csrfToken || !auth.user) {
        showToast("登录已过期，请重新登录");
        return;
      }
      for (const conflict of conflictItems) {
        const result = await vault.resolveConflict(
          conflict.itemId,
          actionToStrategy(action),
          csrfToken,
          auth.user.id,
        );
        if (!result.ok) {
          showToast(result.error);
          return;
        }
      }
      addSyncEvent({
        type: "conflict",
        description: `已批量处理 ${conflictItems.length} 条同步冲突`,
        itemCount: conflictItems.length,
      });
    },
    [vault, conflictItems, csrfToken, auth.user, addSyncEvent, showToast],
  );

  const handleRecoveryComplete = useCallback(
    async (recoveryCode: string) => {
      if (!csrfToken) {
        showToast("登录已过期，请重新登录");
        return;
      }
      const result = await vault.createRecoveryPacket(csrfToken, recoveryCode);
      if (!result.ok) {
        showToast(result.error);
        return;
      }
      setRecoverySetupOpen(false);
      showToast("恢复码已设置");
    },
    [csrfToken, vault, showToast],
  );

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    const bind = async () => {
      try {
        const pairs: Array<[string, () => void]> = [
          ["menu:new_credential", handleAdd],
          ["menu:import_csv", () => {
            setActivePage("import");
            setImportOpen(true);
          }],
          ["menu:search", () => {
            setActivePage("credentials");
            requestAnimationFrame(() => searchInputRef.current?.focus());
          }],
          ["menu:lock_vault", handleLock],
          ["menu:sync", () => void handleSync()],
          ["menu:preferences", () => setActivePage("settings")],
          ["menu:reload", () => window.location.reload()],
          ["menu:dev_tools", () => showToast("开发者工具可通过 Tauri 调试配置打开")],
        ];
        for (const [eventName, handler] of pairs) {
          const unlisten = await listen(eventName, handler);
          if (cancelled) {
            unlisten();
          } else {
            unlisteners.push(unlisten);
          }
        }
      } catch {
        // Browser-only Vite dev sessions do not expose Tauri IPC events.
      }
    };

    void bind();
    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [handleAdd, handleLock, handleSync, showToast]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setActivePage("credentials");
        requestAnimationFrame(() => searchInputRef.current?.focus());
      } else if (key === "l") {
        event.preventDefault();
        handleLock();
      } else if (key === "n") {
        event.preventDefault();
        if (isUnlocked) handleAdd();
      } else if (key === "s") {
        event.preventDefault();
        if (isUnlocked) void handleSync();
      } else if (event.key === ",") {
        event.preventDefault();
        setActivePage("settings");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleAdd, handleLock, handleSync, isUnlocked]);

  if (!isAuthenticated) {
    return (
      <LoginShell
        loading={auth.isLoading}
        error={auth.error}
        onLogin={auth.login}
      />
    );
  }

  if (!isUnlocked) {
    return (
      <>
        <LockedState
          onUnlock={vault.unlock}
          isLoading={vault.isLoading}
          error={vault.error}
          hasLocalVault={vault.hasLocalVault}
          onOpenRecovery={() => setRecoveryModalOpen(true)}
        />
        <RecoveryModal
          isOpen={recoveryModalOpen}
          onClose={() => setRecoveryModalOpen(false)}
          onRecover={vault.recoverWithVaultKey}
          cryptoAdapter={vault.cryptoAdapter}
          encryptedRecoveryPacket={vault.recoveryPacket}
        />
      </>
    );
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        currentPage={activePage}
        onNavigate={handleNavigate}
        onLock={handleLock}
        syncStatus={syncStatus}
        isOffline={!offlineSync.isOnline}
        isUnlocked={isUnlocked}
        folders={folders}
        allCount={vault.items.length}
        folderCounts={folderCounts}
        uncategorizedCount={uncategorizedCount}
        selectedFolder={selectedFolder}
        onFolderSelect={setSelectedFolder}
        credentialsNavId="credentials"
      />

      <main className={styles.main}>
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          syncStatus={syncStatus}
          onSync={handleSync}
          autoLockMinutes={vault.autoLockMinutes}
          searchInputRef={searchInputRef}
          isOnline={offlineSync.isOnline}
          pendingCount={offlineSync.pendingCount}
          failedCount={offlineSync.failedCount}
          onRetryNow={offlineSync.retryNow}
        />

        <div className={styles.content}>
          {activePage === "dashboard" && (
            <DashboardPage
              itemCount={vault.items.length}
              loginCount={itemStats.loginCount}
              noteCount={itemStats.noteCount}
              cardCount={itemStats.cardCount}
              syncStatus={syncStatus}
              conflictCount={vault.conflictCount}
              lastSyncedAt={vault.lastSyncedAt}
              autoLockMinutes={vault.autoLockMinutes}
              deviceCount={vault.devices.length}
              onNavigate={setActivePage}
              onSync={handleSync}
            />
          )}

          {activePage === "credentials" && (
            <div className={styles.credentialsLayout}>
              <div className={styles.credentialListPane}>
                <CredentialList
                  items={vault.items}
                  searchQuery={searchQuery}
                  onSelect={setSelectedItem}
                  onAdd={handleAdd}
                  loading={vault.isLoading}
                  selectedFolder={selectedFolder}
                />
              </div>

              {selectedItem && (
                <div className={styles.credentialDetailPane}>
                  <CredentialDetail
                    item={selectedItem}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onClose={() => setSelectedItem(null)}
                  />
                </div>
              )}
            </div>
          )}

          {activePage === "import" && (
            <div className={styles.pageStack}>
              <section className={styles.panelHeader}>
                <p className={styles.pageEyebrow}>IMPORT</p>
                <h2 className={styles.pageTitle}>迁移导入</h2>
                <p className={styles.pageCopy}>
                  导入流程会在本地解析明文文件，并在写入前加密为 Obscura 密文条目。
                </p>
                <Button onClick={() => setImportOpen(true)}>
                  <Download size={16} />
                  打开导入向导
                </Button>
              </section>
            </div>
          )}

          {activePage === "recovery" && (
            <RecoveryPage
              hasPacket={vault.recoveryPacket !== null}
              onOpenSetup={() => setRecoverySetupOpen(true)}
              onOpenRecover={() => setRecoveryModalOpen(true)}
            />
          )}

          {activePage === "sync" && (
            <div className={styles.pageStack}>
              <SyncPanel
                storedItems={vault.storedItems}
                conflictIds={vault.conflictIds}
                lastSyncedAt={vault.lastSyncedAt}
                syncEvents={syncEvents}
                loading={vault.isSyncing}
                onSync={handleSync}
              />
              <ConflictResolutionPanel
                conflicts={conflictItems}
                onResolve={handleResolveConflict}
                onResolveAll={handleResolveAll}
                loading={vault.isLoading}
              />
            </div>
          )}

          {activePage === "devices" && csrfToken && (
            <DeviceManagementPanel
              devices={vault.devices}
              currentDeviceId={vault.currentDeviceId}
              csrfToken={csrfToken}
              cryptoAdapter={vault.cryptoAdapter}
              loading={vault.isDeviceLoading}
              onRefresh={vault.refreshDevices}
              {...(vault.vaultKey ? { vaultKey: vault.vaultKey } : {})}
              onRegister={(name, publicKey, privateKey) =>
                vault.registerDevice(csrfToken, name, publicKey, privateKey).then(
                  (result) => {
                    if (!result.ok) throw new Error(result.error);
                  },
                )
              }
              onApprove={(deviceId, encryptedVaultKey) =>
                vault.approveDevice(csrfToken, deviceId, encryptedVaultKey).then(
                  (result) => {
                    if (!result.ok) throw new Error(result.error);
                  },
                )
              }
              onReject={(deviceId) =>
                vault.rejectDevice(csrfToken, deviceId).then((result) => {
                  if (!result.ok) throw new Error(result.error);
                })
              }
              onRevoke={(deviceId) =>
                vault.revokeDevice(csrfToken, deviceId).then((result) => {
                  if (!result.ok) throw new Error(result.error);
                })
              }
              onFetchSharedKey={async (masterPassword) => {
                if (!auth.user) throw new Error("登录已过期");
                const result = await vault.fetchSharedVaultKey(
                  csrfToken,
                  auth.user.id,
                  masterPassword,
                );
                if (!result.ok) throw new Error(result.error);
                showToast("共享密钥已获取，设备就绪");
              }}
            />
          )}

          {activePage === "settings" && (
            <SettingsPage
              autoLockMinutes={vault.autoLockMinutes}
              onAutoLockChange={vault.setAutoLockMinutes}
              loading={vault.isLoading}
              onChangeMasterPassword={async (currentPassword, newPassword) => {
                if (!csrfToken || !auth.user) throw new Error("登录已过期");
                const result = await vault.changeMasterPassword(
                  currentPassword,
                  newPassword,
                  csrfToken,
                  auth.user.id,
                );
                if (!result.ok) throw new Error(result.error);
                showToast("主密码已更新");
              }}
              onExportCsv={() => {
                if (
                  !window.confirm(
                    "CSV 将包含明文密码。仅在可信设备上导出，并在迁移后立即安全删除。是否继续？",
                  )
                ) {
                  return;
                }
                const result = vault.exportCsv();
                if (!result.ok) {
                  showToast(result.error);
                  return;
                }
                downloadExportFile(result.data);
                showToast("CSV 已导出");
              }}
              onExportEncrypted={() => {
                void vault.exportEncryptedBackup().then((result) => {
                  if (!result.ok) {
                    showToast(result.error);
                    return;
                  }
                  downloadExportFile(result.data);
                  showToast("加密备份已导出");
                });
              }}
              onDeleteAccount={async () => {
                if (!csrfToken) throw new Error("登录已过期");
                const result = await vault.deleteAccount(csrfToken);
                if (!result.ok) throw new Error(result.error);
                await auth.logout();
              }}
            />
          )}
        </div>
      </main>

      <AddEditDrawer
        isOpen={drawerOpen}
        mode={drawerMode}
        {...(editingItem ? { initialItem: editingItem } : {})}
        onSave={handleSave}
        onClose={() => {
          setDrawerOpen(false);
          setEditingItem(null);
        }}
      />

      <ConfirmDeleteDialog
        open={deletingItem !== null}
        itemTitle={deletingItem?.title ?? ""}
        onConfirm={handleConfirmDelete}
        onClose={() => setDeletingItem(null)}
        loading={vault.isLoading}
      />

      <CsvImportWizard
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
        csrfToken={csrfToken ?? ""}
      />

      <RecoverySetup
        isOpen={recoverySetupOpen}
        onClose={() => setRecoverySetupOpen(false)}
        onComplete={handleRecoveryComplete}
        cryptoAdapter={vault.cryptoAdapter}
      />

      <RecoveryModal
        isOpen={recoveryModalOpen}
        onClose={() => setRecoveryModalOpen(false)}
        onRecover={vault.recoverWithVaultKey}
        cryptoAdapter={vault.cryptoAdapter}
        encryptedRecoveryPacket={vault.recoveryPacket}
      />

      {vault.error && (
        <div className={styles.errorToast} role="alert">
          <AlertTriangle size={14} />
          {vault.error}
        </div>
      )}

      {toast && (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      )}

      <button type="button" className={styles.logoutButton} onClick={handleLogout}>
        退出登录
      </button>
    </div>
  );
}
