"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronRight,
  Download,
  Folder,
  KeyRound,
  LayoutDashboard,
  RefreshCw,
  Settings,
  Shield,
  Wand2,
  X,
} from "lucide-react";
import { Sidebar } from "../../components/shell/sidebar";
import TopBar from "../../components/shell/top-bar";
import { CredentialList } from "../../components/credentials/credential-list";
import { CredentialDrawer } from "../../components/credentials/credential-drawer";
import { RecoverySetup, RecoveryModal } from "../../components/recovery";
import CsvImport from "../../components/import/csv-import";
import { SettingsPage } from "../../components/settings/settings-page";
import SyncPanel from "../../components/sync/sync-panel";
import SyncDevicePanel from "../../components/sync/sync-device-panel";
import ConflictResolutionPanel from "../../components/sync/conflict-resolution-panel";
import { DashboardPage } from "../../components/dashboard/dashboard-page";
import { PasswordGenerator } from "../../components/tools/password-generator";
import { Drawer } from "../../components/ui/drawer";
import { MobileNav } from "../../components/shell/mobile-nav";
import { ActionDock } from "../../components/shell/action-dock";
import { PixelMascot } from "../../components/mascot";
import { useVaultContext } from "../vault-provider";
import { useFolders } from "../../hooks/useFolders";
import { useMascot } from "../../hooks/useMascot";

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

const TOOLS_NAV_ID = "tools";

export default function VaultPage() {
  const ctx = useVaultContext();
  const router = useRouter();

  // Redirect to / if locked
  useEffect(() => {
    if (ctx.isLocked) {
      router.replace("/");
    }
  }, [ctx.isLocked, router]);

  // -- Batch update state --
  const [batchUpdateOpen, setBatchUpdateOpen] = useState(false);
  const [batchUpdateIds, setBatchUpdateIds] = useState<string[]>([]);
  const [batchUpdatePassword, setBatchUpdatePassword] = useState("");
  const [batchUpdateConfirmOpen, setBatchUpdateConfirmOpen] = useState(false);

  // -- Mobile menu state --
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // -- Mascot state --
  const [lastCopiedAt, setLastCopiedAt] = useState<number | null>(null);
  const [mascotError, setMascotError] = useState(false);

  const mascot = useMascot({
    isLocked: ctx.isLocked,
    isSyncing: ctx.loading && ctx.syncStatus.includes("同步中"),
    hasError: mascotError || !!ctx.error,
    isOnline: !ctx.isOffline,
    lastCopiedAt,
    itemCount: ctx.itemCount,
  });

  // -- Sidebar navigation items --
  const sidebarNav = useMemo(
    () => [
      { id: ctx.NAV_IDS.DASHBOARD, label: "仪表盘", icon: <LayoutDashboard size={18} />, enabled: true },
      { id: ctx.NAV_IDS.CREDENTIALS, label: "凭据", icon: <KeyRound size={18} />, enabled: !ctx.isLocked },
      { id: ctx.NAV_IDS.IMPORT, label: "导入", icon: <Download size={18} />, enabled: !ctx.isLocked },
      { id: ctx.NAV_IDS.SYNC, label: "同步与设备", icon: <RefreshCw size={18} />, enabled: !ctx.isLocked },
      { id: ctx.NAV_IDS.RECOVERY, label: "恢复码", icon: <Shield size={18} />, enabled: !ctx.isLocked },
      { id: TOOLS_NAV_ID, label: "工具", icon: <Wand2 size={18} />, enabled: !ctx.isLocked },
      { id: ctx.NAV_IDS.SETTINGS, label: "设置", icon: <Settings size={18} />, enabled: !ctx.isLocked }
    ],
    [ctx.isLocked, ctx.NAV_IDS]
  );

  // -- Folder data --
  const allItems = ctx.unlockedVault?.snapshot.items ?? [];
  const { folders, folderCounts, uncategorizedCount } = useFolders(allItems);

  // -- Folder breadcrumb --
  const folderBreadcrumb = ctx.folderFilter !== null ? (
    <div className="folder-breadcrumb">
      <button
        type="button"
        className="folder-breadcrumb-link"
        onClick={() => ctx.setFolderFilter(null)}
      >
        <Folder size={14} />
        凭据
      </button>
      <ChevronRight size={14} className="folder-breadcrumb-sep" />
      <span className="folder-breadcrumb-current">
        {ctx.folderFilter === "" ? "未分类" : ctx.folderFilter}
      </span>
      <button
        type="button"
        className="folder-breadcrumb-clear"
        onClick={() => ctx.setFolderFilter(null)}
        title="清除文件夹筛选"
        aria-label="清除文件夹筛选"
      >
        <X size={14} />
      </button>
    </div>
  ) : null;

  // -- Sidebar element --
  const sidebarElement = (
    <Sidebar
      unlocked={!ctx.isLocked}
      activeNav={ctx.activeNav}
      onNavChange={(id) => { ctx.setActiveNav(id); setMobileMenuOpen(false); }}
      sidebarNav={sidebarNav}
      extensionBridge={ctx.extensionBridge}
      syncStatus={ctx.syncStatus}
      isOffline={ctx.isOffline}
      onLockVault={ctx.lockVault}
      user={ctx.user}
      showAccountSection={ctx.showAccountSection}
      isOpen={mobileMenuOpen}
      onClose={() => setMobileMenuOpen(false)}
      onToggleAccountSection={() => ctx.setShowAccountSection((v) => !v)}
      canRestoreFromCloud={ctx.canRestoreFromCloud}
      encryptedVault={ctx.encryptedVault}
      onRestoreFromCloud={ctx.restoreFromCloud}
      onSyncNow={ctx.syncNow}
      onLogout={ctx.submitLogout}
      loading={ctx.loading}
      accountEmail={ctx.accountEmail}
      onAccountEmailChange={ctx.setAccountEmail}
      accountPassword={ctx.accountPassword}
      onAccountPasswordChange={ctx.setAccountPassword}
      onRegister={(e) => void ctx.submitRegister(e as FormEvent<HTMLFormElement>)}
      onLogin={ctx.submitLogin}
      folders={folders}
      folderItemCounts={folderCounts}
      allCount={allItems.length}
      uncategorizedCount={uncategorizedCount}
      selectedFolder={ctx.folderFilter}
      onFolderSelect={ctx.setFolderFilter}
      credentialsNavId={ctx.NAV_IDS.CREDENTIALS}
    />
  );

  // -- Copy toast --
  const copyToast = ctx.copiedField ? (
    <div className="copy-toast">已复制到剪贴板</div>
  ) : null;

  // Track clipboard copies for mascot
  const originalHandleCopy = ctx.handleCopy;
  const handleCopyWithMascot = useCallback(
    async (text: string, fieldId: string) => {
      setLastCopiedAt(Date.now());
      await originalHandleCopy(text, fieldId);
    },
    [originalHandleCopy]
  );

  // -- Drawer form change handler --
  const handleDrawerFormChange = useCallback(
    (field: string, value: string) => {
      ctx.setItemForm((form) => ({ ...form, [field]: value }));
    },
    [ctx]
  );

  const handleDrawerCopyPassword = useCallback(() => {
    if (ctx.itemForm.password) {
      void ctx.handleCopy(ctx.itemForm.password, "drawer-password");
    }
  }, [ctx]);

  // -- Batch update password handlers --
  const handleOpenBatchUpdate = useCallback((ids: string[]) => {
    setBatchUpdateIds(ids);
    setBatchUpdatePassword("");
    setBatchUpdateConfirmOpen(false);
    setBatchUpdateOpen(true);
  }, []);

  const handleBatchGeneratorUse = useCallback((password: string) => {
    setBatchUpdatePassword(password);
    setBatchUpdateConfirmOpen(true);
  }, []);

  const handleBatchUpdateConfirm = useCallback(async () => {
    if (!batchUpdatePassword || batchUpdateIds.length === 0) return;
    await ctx.batchUpdatePassword(batchUpdateIds, batchUpdatePassword);
    setBatchUpdateOpen(false);
    setBatchUpdateIds([]);
    setBatchUpdatePassword("");
    setBatchUpdateConfirmOpen(false);
  }, [batchUpdatePassword, batchUpdateIds, ctx]);

  const handleBatchUpdateCancel = useCallback(() => {
    setBatchUpdateOpen(false);
    setBatchUpdateIds([]);
    setBatchUpdatePassword("");
    setBatchUpdateConfirmOpen(false);
  }, []);

  // -- If locked, show nothing (redirecting) --
  if (ctx.isLocked) {
    return null;
  }

  return (
    <div className="app-shell">
      {sidebarElement}

      <div className="app-main">
        <TopBar
          searchQuery={ctx.searchQuery}
          onSearchQueryChange={ctx.setSearchQuery}
          syncStatus={ctx.syncStatus}
          autoLockRemaining={ctx.autoLockRemaining}
          onSyncNow={ctx.syncNow}
          loading={ctx.loading}
          onMenuToggle={() => setMobileMenuOpen((v) => !v)}
        />

        <div className="main-content">
          {/* Stats cards - only on Dashboard or Credentials */}
          {(ctx.activeNav === ctx.NAV_IDS.DASHBOARD || ctx.activeNav === ctx.NAV_IDS.CREDENTIALS) ? (
            <div className="stats-grid">
              <div className="stat-card pixel-border">
                <span className="stat-card-label">凭据总数</span>
                <span className="stat-card-value">{ctx.itemCount}</span>
              </div>
              <div className="stat-card pixel-border">
                <span className="stat-card-label">最近更新</span>
                <span className="stat-card-value stat-card-value--muted" style={{ fontSize: 14 }}>
                  {ctx.updatedAt}
                </span>
              </div>
              <div className="stat-card pixel-border">
                <span className="stat-card-label">同步状态</span>
                <span
                  className={`stat-card-value ${
                    ctx.syncStatus.includes("已同步")
                      ? "stat-card-value--success"
                      : ctx.syncStatus.includes("冲突")
                        ? "stat-card-value--warning"
                        : "stat-card-value--muted"
                  }`}
                  style={{ fontSize: 14 }}
                >
                  {ctx.syncStatus}
                </span>
              </div>
              {ctx.lastSyncedAt ? (
                <div className="stat-card pixel-border">
                  <span className="stat-card-label">上次同步</span>
                  <span className="stat-card-value stat-card-value--muted" style={{ fontSize: 14 }}>
                    {formatDateTime(ctx.lastSyncedAt)}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Error banner */}
          {ctx.error ? (
            <div className="error-banner" role="alert">
              <AlertTriangle size={16} />
              <span>{ctx.error}</span>
            </div>
          ) : null}

          {/* Tools: Password Generator */}
          {ctx.activeNav === TOOLS_NAV_ID ? (
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 20 }}>密码生成器</h2>
              <PasswordGenerator />
            </div>
          ) : null}

          {/* Dashboard page */}
          {ctx.activeNav === ctx.NAV_IDS.DASHBOARD ? (
            <DashboardPage
              items={ctx.unlockedVault?.snapshot.items ?? []}
              syncEvents={ctx.syncEvents}
              lastSyncedAt={ctx.lastSyncedAt}
              onEditItem={ctx.openDrawerForEdit}
              onAddNew={ctx.openDrawerForCreate}
              onImport={() => ctx.setActiveNav(ctx.NAV_IDS.IMPORT)}
              onSyncNow={ctx.syncNow}
            />
          ) : null}

          {/* Import section */}
          {ctx.activeNav === ctx.NAV_IDS.IMPORT ? (
            <CsvImport loading={ctx.loading} importStatus={ctx.importStatus} onImport={ctx.importPasswords} />
          ) : null}

          {/* Conflict panel */}
          {ctx.itemConflicts.length > 0 ? (
            <ConflictResolutionPanel
              conflicts={ctx.itemConflicts.map((c) => {
                const localItem = ctx.unlockedVault?.snapshot.items.find((i) => i.id === c.itemId);
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
                  case "keep-local": void ctx.resolveKeepLocal(itemId); break;
                  case "accept-remote": void ctx.resolveAcceptRemote(itemId); break;
                  case "create-copy": void ctx.resolveCreateCopy(itemId); break;
                  case "skip": ctx.resolveSkip(itemId); break;
                }
              }}
              onResolveAll={(action) => {
                for (const c of ctx.itemConflicts) {
                  switch (action) {
                    case "keep-local": void ctx.resolveKeepLocal(c.itemId); break;
                    case "accept-remote": void ctx.resolveAcceptRemote(c.itemId); break;
                    case "create-copy": void ctx.resolveCreateCopy(c.itemId); break;
                    case "skip": ctx.resolveSkip(c.itemId); break;
                  }
                }
              }}
              loading={ctx.loading}
            />
          ) : null}

          {/* Recovery section */}
          {ctx.activeNav === ctx.NAV_IDS.RECOVERY ? (
            <RecoverySetup loading={ctx.loading} onGenerateRecoveryCode={ctx.handleCreateRecoveryCode} recoveryCode={ctx.recoveryCode} />
          ) : null}

          {/* Device section */}
          {ctx.activeNav === ctx.NAV_IDS.SYNC && ctx.user ? (
            <SyncDevicePanel
              vault={ctx.unlockedVault ?? ctx.encryptedVault}
              onSync={ctx.syncNow}
              onApproveDevice={ctx.handleApproveDevice}
              onRejectDevice={ctx.handleRejectDevice}
              onRevokeDevice={ctx.handleRevokeDevice}
              syncStatus={ctx.syncStatus}
              lastSyncedAt={ctx.lastSyncedAt}
              itemSyncInfos={ctx.itemSyncInfos}
              devices={ctx.devices}
              currentDeviceId={ctx.currentDeviceId}
              loading={ctx.loading}
              isOffline={ctx.isOffline}
              onRefreshDevices={ctx.refreshDevices}
            />
          ) : null}

          {/* Sync panel */}
          {ctx.activeNav === ctx.NAV_IDS.SYNC ? (
            <SyncPanel
              syncStatus={ctx.syncStatus}
              lastSyncedAt={ctx.lastSyncedAt}
              itemSyncInfos={ctx.itemSyncInfos}
              syncEvents={ctx.syncEvents}
              loading={ctx.loading}
              isOffline={ctx.isOffline}
              onSync={ctx.syncNow}
            />
          ) : null}

          {/* Extension bridge details */}
          {ctx.activeNav === ctx.NAV_IDS.SYNC ? (
            <div className="extension-panel pixel-border">
              <h3>扩展连接</h3>
              {!ctx.extensionBridge.configured || !ctx.extensionBridge.runtimeAvailable ? (
                <div className="extension-unavailable">
                  未检测到浏览器扩展。自动填充已禁用。
                </div>
              ) : null}
              <div className="extension-status-grid">
                <div className="extension-status-cell">
                  <span>扩展 ID</span>
                  <strong>{ctx.extensionBridge.configured ? "已配置" : "缺失"}</strong>
                </div>
                <div className="extension-status-cell">
                  <span>通信状态</span>
                  <strong>{ctx.extensionBridge.runtimeAvailable ? ctx.extensionBridge.communication : "不可用"}</strong>
                </div>
                <div className="extension-status-cell">
                  <span>上次发布</span>
                  <strong>{ctx.extensionBridge.lastPublish}</strong>
                </div>
                <div className="extension-status-cell">
                  <span>上次清空</span>
                  <strong>{ctx.extensionBridge.lastClear}</strong>
                </div>
              </div>
            </div>
          ) : null}

          {/* Settings page */}
          {ctx.activeNav === ctx.NAV_IDS.SETTINGS ? (
            <SettingsPage
              autoLockTimeout={ctx.autoLockTimeout}
              onAutoLockTimeoutChange={ctx.setAutoLockTimeout}
              extensionId={ctx.extensionId}
              onExtensionIdChange={ctx.setExtensionId}
              onChangeMasterPassword={ctx.handleChangeMasterPassword}
              onDeleteAccount={ctx.handleDeleteAccount}
              onExportCsv={ctx.handleExportCsv}
              onExportEncrypted={ctx.handleExportEncrypted}
              autoSyncEnabled={ctx.autoSyncEnabled}
              onAutoSyncEnabledChange={ctx.setAutoSyncEnabled}
              syncInterval={ctx.syncInterval}
              onSyncIntervalChange={ctx.setSyncInterval}
              loading={ctx.loading}
              onExportCsvSelected={ctx.handleExportCsvSelected}
              onExportEncryptedSelected={ctx.handleExportEncryptedSelected}
              selectedCount={ctx.selectedIds.size}
              onImportEncryptedBackup={(file) => ctx.handleImportEncryptedBackup(file)}
              importBackupStatus={ctx.importBackupStatus}
            />
          ) : null}

          {/* Credentials page */}
          {ctx.activeNav === ctx.NAV_IDS.CREDENTIALS ? (
            <>
              {/* Folder breadcrumb */}
              {folderBreadcrumb}

              {/* Credential list */}
              <CredentialList
                items={ctx.filteredItems}
                searchQuery={ctx.searchQuery}
                filterMode={ctx.filterMode}
                onFilterModeChange={ctx.setFilterMode}
                folderFilter={ctx.folderFilter}
                passwordRevealedId={ctx.passwordRevealedId}
                onTogglePasswordReveal={(id) =>
                  ctx.setPasswordRevealedId(ctx.passwordRevealedId === id ? null : id)
                }
                onCopyUsername={(id, username) => void ctx.handleCopy(username, `user-${id}`)}
                onCopyPassword={(id, password) => void ctx.handleCopy(password, `pass-${id}`)}
                onEdit={ctx.openDrawerForEdit}
                onAdd={ctx.openDrawerForCreate}
                onDelete={ctx.confirmDelete}
                deleteConfirmId={ctx.deleteConfirmId}
                onDeleteConfirm={ctx.setDeleteConfirmId}
                onDeleteCancel={() => ctx.setDeleteConfirmId(null)}
                onBatchDelete={(ids) => void ctx.batchDeleteCredentials(ids)}
                onBatchUpdatePassword={(ids) => handleOpenBatchUpdate(ids)}
                onSelectionChange={(ids) => ctx.setSelectedIds(ids)}
                loading={ctx.loading}
              />
            </>
          ) : null}
        </div>
      </div>

      {/* Drawer */}
      <CredentialDrawer
        isOpen={ctx.drawerOpen}
        onClose={ctx.closeDrawer}
        editingId={ctx.editingId}
        itemForm={ctx.itemForm}
        onFormChange={handleDrawerFormChange}
        onSave={(e) => void ctx.submitItem(e as FormEvent<HTMLFormElement>)}
        onDelete={() => {
          if (ctx.editingId) {
            ctx.setDeleteConfirmId(ctx.editingId);
            void ctx.confirmDelete(ctx.editingId);
          }
        }}
        onGeneratePassword={ctx.handleGeneratePassword}
        onCopyPassword={handleDrawerCopyPassword}
        loading={ctx.loading}
        error={ctx.error}
        folders={folders}
      />

      {/* Batch Password Update Drawer */}
      <Drawer
        open={batchUpdateOpen}
        onClose={handleBatchUpdateCancel}
        title="批量更新密码"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {!batchUpdateConfirmOpen ? (
            <>
              <p style={{ fontSize: 14, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
                为选中的 <strong style={{ color: "var(--color-primary)" }}>{batchUpdateIds.length}</strong> 个凭据生成新密码。
              </p>
              <PasswordGenerator showUseButton onUse={handleBatchGeneratorUse} />
            </>
          ) : (
            <>
              <div
                style={{
                  background: "rgba(245, 158, 11, 0.1)",
                  border: "1px solid rgba(245, 158, 11, 0.25)",
                  borderRadius: "var(--radius-md)",
                  padding: 16,
                }}
              >
                <p style={{ fontSize: 14, color: "var(--color-warning)", fontWeight: 600, margin: 0 }}>
                  将用新密码更新 {batchUpdateIds.length} 个凭据，此操作不可撤销。
                </p>
              </div>
              <div
                style={{
                  background: "var(--color-bg-input)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  padding: 12,
                  fontFamily: "var(--font-mono)",
                  fontSize: 16,
                  color: "var(--color-primary)",
                  wordBreak: "break-all",
                }}
              >
                {batchUpdatePassword}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void handleBatchUpdateConfirm()}
                  disabled={ctx.loading}
                >
                  {ctx.loading ? "更新中..." : "确认更新"}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setBatchUpdateConfirmOpen(false)}
                  disabled={ctx.loading}
                >
                  重新生成
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={handleBatchUpdateCancel}
                  disabled={ctx.loading}
                >
                  取消
                </button>
              </div>
            </>
          )}
        </div>
      </Drawer>

      {/* Recovery modal */}
      <RecoveryModal
        isOpen={ctx.showRecoveryModal}
        onClose={ctx.closeRecoveryModal}
        recoveryCode={ctx.recoveryCode}
        onCopy={() => {
          void navigator.clipboard.writeText(ctx.recoveryCode);
          setLastCopiedAt(Date.now());
        }}
        confirmed={ctx.recoveryConfirmed}
        onConfirmChange={ctx.setRecoveryConfirmed}
      />

      {copyToast}

      {/* Pixel Mascot */}
      <PixelMascot
        state={mascot.state}
        message={mascot.message}
        onDismissMessage={mascot.dismissMessage}
        onClick={() => setMascotError(false)}
      />

      {/* Floating Action Dock (desktop) */}
      <ActionDock
        onAddCredential={ctx.openDrawerForCreate}
        onSyncNow={ctx.syncNow}
        loading={ctx.loading}
      />

      {/* Mobile Bottom Navigation */}
      <MobileNav
        activeNav={ctx.activeNav}
        onNavChange={ctx.setActiveNav}
        onOpenMenu={() => setMobileMenuOpen(true)}
        navIds={ctx.NAV_IDS}
      />
    </div>
  );
}
