import { useState, useCallback, useMemo, useEffect } from "react";
import type { VaultItem } from "@zero-vault/shared";
import { useAuthState } from "./state/auth-state";
import { useVaultState } from "./state/vault-state";
import { Sidebar } from "./components/shell/sidebar";
import { TopBar } from "./components/shell/top-bar";
import { LockedState } from "./components/shell/locked-state";
import { CredentialList } from "./components/credentials/credential-list";
import { CredentialDetail } from "./components/credentials/credential-detail";
import { AddEditDrawer } from "./components/credentials/add-edit-drawer";
import { ConfirmDeleteDialog } from "./components/credentials/confirm-delete-dialog";
import { registerClipboardToast } from "./lib/clipboard";
import { SettingsPage } from "./components/settings";
import styles from "./App.module.css";

type PageId = "dashboard" | "credentials" | "sync" | "devices" | "settings";

export function App() {
  const auth = useAuthState();
  const vault = useVaultState();

  // Destructure to narrow dependency arrays
  const { addItem, updateItem, deleteItem, sync } = vault;
  const { csrfToken } = auth;

  // UI state
  const [activePage, setActivePage] = useState<PageId>("credentials");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // CRUD dialog state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"add" | "edit">("add");
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<VaultItem | null>(null);

  // Register clipboard toast callback
  useEffect(() => {
    registerClipboardToast((message) => {
      setToast(message);
      setTimeout(() => setToast(null), 3000);
    });
  }, []);

  // Restore session on mount
  useEffect(() => {
    auth.restoreSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  const handleNavigate = useCallback((page: string) => {
    setActivePage(page as PageId);
  }, []);

  // Computed state
  const isAuthenticated = auth.user !== null;
  const isUnlocked = isAuthenticated && !vault.isLocked;

  const syncStatus = useMemo(() => {
    if (vault.isSyncing) return "同步中...";
    if (vault.lastSyncedAt) return "已同步";
    return "未同步";
  }, [vault.isSyncing, vault.lastSyncedAt]);

  // Toast helper
  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Handlers
  const handleLock = useCallback(() => {
    vault.lock();
    setSelectedItem(null);
    setDrawerOpen(false);
    setDeletingItem(null);
  }, [vault.lock]);

  const handleLogout = useCallback(async () => {
    vault.lock();
    setSelectedItem(null);
    setDrawerOpen(false);
    setDeletingItem(null);
    await auth.logout();
  }, [vault.lock, auth.logout]);

  const handleSelectItem = useCallback((item: VaultItem) => {
    setSelectedItem(item);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedItem(null);
  }, []);

  const handleAdd = useCallback(() => {
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

      try {
        if (drawerMode === "add") {
          await addItem(item, csrfToken);
          showToast("凭据已创建");
        } else {
          await updateItem(item, csrfToken);
          showToast("凭据已更新");
          if (selectedItem?.id === item.id) {
            setSelectedItem(item);
          }
        }
        setDrawerOpen(false);
        setEditingItem(null);
        void sync();
      } catch {
        // Error is set in vault state
      }
    },
    [drawerMode, csrfToken, addItem, updateItem, sync, selectedItem, showToast],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingItem) return;
    if (!csrfToken) {
      showToast("登录已过期，请重新登录");
      return;
    }

    try {
      await deleteItem(deletingItem.id, csrfToken);
      showToast("凭据已删除");
      if (selectedItem?.id === deletingItem.id) {
        setSelectedItem(null);
      }
      setDeletingItem(null);
      void sync();
    } catch {
      // Error is set in vault state
    }
  }, [deletingItem, csrfToken, deleteItem, sync, selectedItem, showToast]);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
    setEditingItem(null);
  }, []);

  const handleCloseDeleteDialog = useCallback(() => {
    setDeletingItem(null);
  }, []);

  // --- Render ---

  // Not authenticated: show login (placeholder)
  if (!isAuthenticated) {
    return (
      <div className={styles.loginShell}>
        <div className={styles.loginCard}>
          <h1 className={styles.loginTitle}>Obscura</h1>
          <p className={styles.loginSubtitle}>请登录以继续</p>
          {auth.error && (
            <div className={styles.loginError} role="alert">{auth.error}</div>
          )}
          <button
            type="button"
            className={styles.loginButton}
            onClick={() => auth.login("demo@obscura.local", "demo")}
            disabled={auth.isLoading}
          >
            {auth.isLoading ? "登录中..." : "演示登录"}
          </button>
        </div>
      </div>
    );
  }

  // Authenticated but locked
  if (!isUnlocked) {
    return (
      <LockedState
        onUnlock={vault.unlock}
        isLoading={vault.isLoading}
        error={vault.error}
        hasLocalVault={vault.hasLocalVault}
      />
    );
  }

  // Main app shell
  return (
    <div className={styles.shell}>
      <Sidebar
        currentPage={activePage}
        onNavigate={handleNavigate}
        onLock={handleLock}
        syncStatus={syncStatus}
      />

      <main className={styles.main}>
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          syncStatus={syncStatus}
          onSync={vault.sync}
          autoLockMinutes={vault.autoLockMinutes}
        />

        <div className={styles.content}>
          {activePage === "credentials" && (
            <div className={styles.credentialsLayout}>
              <div className={styles.credentialListPane}>
                <CredentialList
                  items={vault.items}
                  searchQuery={searchQuery}
                  onSelect={handleSelectItem}
                  onAdd={handleAdd}
                  loading={vault.isLoading}
                />
              </div>

              {selectedItem && (
                <div className={styles.credentialDetailPane}>
                  <CredentialDetail
                    item={selectedItem}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onClose={handleCloseDetail}
                  />
                </div>
              )}
            </div>
          )}

          {activePage === "dashboard" && (
            <div className={styles.placeholder}>
              <h2>仪表盘</h2>
              <p>密码库概览将在此处显示。</p>
            </div>
          )}

          {activePage === "sync" && (
            <div className={styles.placeholder}>
              <h2>同步</h2>
              <p>同步管理面板将在此处显示。</p>
            </div>
          )}

          {activePage === "devices" && (
            <div className={styles.placeholder}>
              <h2>设备管理</h2>
              <p>设备信任管理将在此处显示。</p>
            </div>
          )}

          {activePage === "settings" && (
            <SettingsPage
              autoLockMinutes={vault.autoLockMinutes}
              onAutoLockChange={vault.setAutoLockMinutes}
              loading={vault.isLoading}
            />
          )}
        </div>
      </main>

      {/* Add/Edit Drawer */}
      <AddEditDrawer
        isOpen={drawerOpen}
        mode={drawerMode}
        {...(editingItem ? { initialItem: editingItem } : {})}
        onSave={handleSave}
        onClose={handleCloseDrawer}
      />

      {/* Delete Confirmation */}
      <ConfirmDeleteDialog
        open={deletingItem !== null}
        itemTitle={deletingItem?.title ?? ""}
        onConfirm={handleConfirmDelete}
        onClose={handleCloseDeleteDialog}
        loading={vault.isLoading}
      />

      {/* Toast */}
      {toast && (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
