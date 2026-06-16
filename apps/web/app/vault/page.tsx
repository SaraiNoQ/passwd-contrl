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
import SyncWorkspace from "../../components/sync/sync-workspace";
import ConflictResolutionPanel from "../../components/sync/conflict-resolution-panel";
import { DashboardPage } from "../../components/dashboard/dashboard-page";
import { PasswordGenerator } from "../../components/tools/password-generator";
import { Drawer } from "../../components/ui/drawer";
import { Toast } from "../../components/ui/toast";
import { Button } from "../../components/ui/button";
import { MobileNav } from "../../components/shell/mobile-nav";
import { PixelMascot } from "../../components/mascot";
import { useVaultContext } from "../vault-provider";
import { useFolders } from "../../hooks/useFolders";
import { useMascot } from "../../hooks/useMascot";
import batchStyles from "./batch-password-update.module.css";

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
      { id: ctx.NAV_IDS.DASHBOARD, label: "密码总览", icon: <LayoutDashboard size={18} />, enabled: true },
      { id: ctx.NAV_IDS.CREDENTIALS, label: "密码列表", icon: <KeyRound size={18} />, enabled: !ctx.isLocked },
      { id: ctx.NAV_IDS.IMPORT, label: "导入密码", icon: <Download size={18} />, enabled: !ctx.isLocked },
      { id: ctx.NAV_IDS.SYNC, label: "设备同步", icon: <RefreshCw size={18} />, enabled: !ctx.isLocked },
      { id: ctx.NAV_IDS.RECOVERY, label: "恢复备份", icon: <Shield size={18} />, enabled: !ctx.isLocked },
      { id: TOOLS_NAV_ID, label: "密码生成", icon: <Wand2 size={18} />, enabled: !ctx.isLocked },
      { id: ctx.NAV_IDS.SETTINGS, label: "应用设置", icon: <Settings size={18} />, enabled: !ctx.isLocked }
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
        密码列表
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
    <div className="vault-toast-stack">
      <Toast variant="success" message="已复制到设备剪贴板" duration={0} />
    </div>
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
          searchLoading={ctx.searchLoading}
          syncStatus={ctx.syncStatus}
          autoLockRemaining={ctx.autoLockRemaining}
          onSyncNow={ctx.syncNow}
          loading={ctx.loading}
          {...(ctx.loadingMessage ? { statusMessage: ctx.loadingMessage } : {})}
          vaultStatus={{
            itemCount: ctx.itemCount,
            updatedAt: ctx.updatedAt,
            syncStatus: ctx.syncStatus,
            lastSyncedAt: ctx.lastSyncedAt,
          }}
          onMenuToggle={() => setMobileMenuOpen((v) => !v)}
        />

        <div className="main-content">
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
                  case "keep-local": return ctx.resolveKeepLocal(itemId);
                  case "accept-remote": return ctx.resolveAcceptRemote(itemId);
                  case "create-copy": return ctx.resolveCreateCopy(itemId);
                  case "skip": ctx.resolveSkip(itemId); return undefined;
                }
              }}
              onResolveAll={async (action) => {
                for (const c of ctx.itemConflicts) {
                  switch (action) {
                    case "keep-local": await ctx.resolveKeepLocal(c.itemId); break;
                    case "accept-remote": await ctx.resolveAcceptRemote(c.itemId); break;
                    case "create-copy": await ctx.resolveCreateCopy(c.itemId); break;
                    case "skip": ctx.resolveSkip(c.itemId); break;
                  }
                }
              }}
              loading={ctx.loading}
            />
          ) : null}

          {/* Recovery section */}
          {ctx.activeNav === ctx.NAV_IDS.RECOVERY ? (
            <RecoverySetup
              loading={ctx.loading}
              onGenerateRecoveryCode={ctx.handleCreateRecoveryCode}
              recoveryCode={ctx.recoveryCode}
              onConfirmSave={ctx.confirmRecoveryCodeSaved}
            />
          ) : null}

          {ctx.activeNav === ctx.NAV_IDS.SYNC ? (
            <SyncWorkspace
              syncStatus={ctx.syncStatus}
              lastSyncedAt={ctx.lastSyncedAt}
              itemSyncInfos={ctx.itemSyncInfos}
              approvedDeviceCount={ctx.devices.filter((device) => device.status === "approved").length}
              pendingDeviceCount={ctx.devices.filter((device) => device.status === "pending").length}
              loading={ctx.loading}
              isOffline={ctx.isOffline}
              onSync={ctx.syncNow}
              extensionBridge={ctx.extensionBridge}
              devicePanel={
                ctx.user ? (
                  <SyncDevicePanel
                    embedded
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
                ) : null
              }
              receiptPanel={
                <SyncPanel
                  embedded
                  syncStatus={ctx.syncStatus}
                  lastSyncedAt={ctx.lastSyncedAt}
                  itemSyncInfos={ctx.itemSyncInfos}
                  syncEvents={ctx.syncEvents}
                  loading={ctx.loading}
                  isOffline={ctx.isOffline}
                  onSync={ctx.syncNow}
                />
              }
            />
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
              cloudExports={ctx.cloudExports}
              cloudExportLoading={ctx.cloudExportLoading}
              cloudExportError={ctx.cloudExportError}
              onLoadCloudExports={ctx.loadCloudExports}
              onCreateCloudExport={ctx.createCloudExport}
              onDeleteCloudExport={ctx.deleteCloudExport}
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
        historyVersions={ctx.historyVersions}
        historyLoading={ctx.historyLoading}
        historyError={ctx.historyError}
        onLoadHistory={ctx.loadHistory}
      />

      {/* Batch Password Update Drawer */}
      <Drawer
        open={batchUpdateOpen}
        onClose={handleBatchUpdateCancel}
        title="批量更新密码"
        eyebrow="BATCH REFORGE / 批量更新"
        status={`${batchUpdateIds.length} 个凭据待处理`}
        className={batchStyles.drawerShell ?? ""}
      >
        <div className={batchStyles.workspace}>
          <div className={batchStyles.stageRail} aria-label="批量更新进度">
            <div className={`${batchStyles.stage} ${!batchUpdateConfirmOpen ? batchStyles.stageActive : ""}`}>
              <span className={batchStyles.stageIndex}>01</span>
              <span className={batchStyles.stageCopy}>
                <strong>生成候选密码</strong>
                <span>只在本地准备，不写入列表</span>
              </span>
            </div>
            <span
              className={`${batchStyles.stageConnector} ${batchUpdateConfirmOpen ? batchStyles.stageConnectorActive : ""}`}
              aria-hidden="true"
            />
            <div className={`${batchStyles.stage} ${batchUpdateConfirmOpen ? batchStyles.stageActive : ""}`}>
              <span className={batchStyles.stageIndex}>02</span>
              <span className={batchStyles.stageCopy}>
                <strong>确认保存</strong>
                <span>核对后批量更新选中凭据</span>
              </span>
            </div>
          </div>

          {!batchUpdateConfirmOpen ? (
            <>
              <section className={batchStyles.intro} aria-label="批量更新说明">
                <div>
                  <span className={batchStyles.kicker}>LOCAL PASSWORD BATCH / 本地密码批次</span>
                  <h3>先生成，再写入</h3>
                  <p>
                    为选中的 <strong>{batchUpdateIds.length}</strong> 个凭据生成同一枚候选密码。
                    这一步只准备新密码，确认前不会写入密码库。
                  </p>
                </div>
                <div className={batchStyles.countBlock} aria-label={`${batchUpdateIds.length} 个待处理凭据`}>
                  <strong>{batchUpdateIds.length}</strong>
                  <span>待处理记录</span>
                </div>
              </section>
              <div className={batchStyles.generator}>
                <PasswordGenerator showUseButton onUse={handleBatchGeneratorUse} />
              </div>
            </>
          ) : (
            <>
              <div className={batchStyles.confirmGrid}>
                <section className={batchStyles.warning} aria-label="批量更新警告">
                  <span className={batchStyles.warningIcon} aria-hidden="true">
                    <AlertTriangle size={20} />
                  </span>
                  <div>
                    <h3>准备写入密码库</h3>
                    <p>
                      将用新密码更新 {batchUpdateIds.length} 个凭据。写入后无法在应用内恢复旧密码。
                    </p>
                  </div>
                </section>
                <section className={batchStyles.receipt} aria-label="批量更新确认预览">
                  <span className={batchStyles.receiptLabel}>SAVE PREVIEW / 保存预览</span>
                  <div className={batchStyles.receiptRow}>
                    <span>目标记录</span>
                    <strong>{batchUpdateIds.length}</strong>
                  </div>
                  <div className={batchStyles.receiptRow}>
                    <span>写入方式</span>
                    <strong>本地加密更新</strong>
                  </div>
                </section>
              </div>
              <div className={batchStyles.passwordPreview} aria-label="即将写入的新密码">
                {batchUpdatePassword}
              </div>
              <div className={batchStyles.actions}>
                <Button
                  type="button"
                  onClick={() => void handleBatchUpdateConfirm()}
                  loading={ctx.loading}
                >
                  {ctx.loading ? "更新中..." : "确认更新"}
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setBatchUpdateConfirmOpen(false)}
                  disabled={ctx.loading}
                >
                  重新生成
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={handleBatchUpdateCancel}
                  disabled={ctx.loading}
                >
                  取消
                </Button>
              </div>
            </>
          )}
        </div>
      </Drawer>

      {/* Recovery modal */}
      <RecoveryModal
        isOpen={ctx.showRecoveryModal}
        onClose={ctx.closeRecoveryModal}
        mode={ctx.recoveryModalMode}
        recoveryCode={ctx.recoveryCode}
        serverSaveFailed={ctx.recoveryServerSaveFailed}
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

      {/* Mobile Bottom Navigation */}
      <MobileNav
        activeNav={ctx.activeNav}
        onNavChange={ctx.setActiveNav}
        navIds={ctx.NAV_IDS}
      />
    </div>
  );
}
