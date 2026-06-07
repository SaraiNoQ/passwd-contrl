"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Blocks,
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

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

const TOOLS_NAV_ID = "tools";

const PAGE_META: Record<string, { eyebrow: string; title: string; description: string }> = {
  dashboard: { eyebrow: "密钥总览 / 01", title: "密钥总览", description: "从本地封存到区块回执，查看你的密文账本是否轻盈、完整、可恢复。" },
  credentials: { eyebrow: "密文账本 / 02", title: "密文账本", description: "每一枚秘密都只在当前设备显形，并以可验证的版本持续演进。" },
  import: { eyebrow: "迁移铸入口 / 03", title: "迁移铸入口", description: "把旧世界的凭据铸入 Obscura 密文账本，不改变它们的所有权。" },
  sync: { eyebrow: "区块中继 / 04", title: "区块中继", description: "编排可信设备、离线队列与版本回执，保持密码库状态一致。" },
  recovery: { eyebrow: "离线分片 / 05", title: "离线恢复区块", description: "为不可预测的时刻准备一条离线、可控且只属于你的恢复路径。" },
  tools: { eyebrow: "密钥工坊 / 06", title: "密钥工坊", description: "铸造高熵访问密钥，为每个站点准备互不重复的独立钥匙。" },
  settings: { eyebrow: "工坊控制台 / 07", title: "工坊控制台", description: "校准锁定、同步、扩展与账户维护，让密文账本按你的规则运行。" },
};

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
      { id: ctx.NAV_IDS.DASHBOARD, label: "密钥总览", icon: <LayoutDashboard size={18} />, enabled: true },
      { id: ctx.NAV_IDS.CREDENTIALS, label: "密文账本", icon: <KeyRound size={18} />, enabled: !ctx.isLocked },
      { id: ctx.NAV_IDS.IMPORT, label: "迁移铸入", icon: <Download size={18} />, enabled: !ctx.isLocked },
      { id: ctx.NAV_IDS.SYNC, label: "区块中继", icon: <RefreshCw size={18} />, enabled: !ctx.isLocked },
      { id: ctx.NAV_IDS.RECOVERY, label: "离线分片", icon: <Shield size={18} />, enabled: !ctx.isLocked },
      { id: TOOLS_NAV_ID, label: "密钥工坊", icon: <Wand2 size={18} />, enabled: !ctx.isLocked },
      { id: ctx.NAV_IDS.SETTINGS, label: "工坊控制台", icon: <Settings size={18} />, enabled: !ctx.isLocked }
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
        密文账本
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

  const currentPage = PAGE_META[ctx.activeNav] ?? PAGE_META.dashboard!;
  const showLedgerTelemetry =
    ctx.activeNav === ctx.NAV_IDS.DASHBOARD || ctx.activeNav === ctx.NAV_IDS.CREDENTIALS;

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
          <header className={`page-intro${showLedgerTelemetry ? " page-intro--telemetry" : ""}`}>
            <svg
              className="page-intro-cloud"
              width="112"
              height="56"
              viewBox="0 0 112 56"
              aria-hidden="true"
              shapeRendering="crispEdges"
            >
              <rect x="24" y="8" width="48" height="8" fill="#ffffff" />
              <rect x="16" y="16" width="72" height="8" fill="#ffffff" />
              <rect x="8" y="24" width="96" height="8" fill="#ffffff" />
              <rect x="0" y="32" width="112" height="8" fill="#ffffff" />
              <rect x="16" y="40" width="80" height="8" fill="#f0f6fd" />
              <rect x="32" y="48" width="48" height="8" fill="#e3f1fe" />
              <rect x="16" y="8" width="8" height="8" fill="#5c6066" opacity="0.55" />
              <rect x="72" y="8" width="8" height="8" fill="#5c6066" opacity="0.55" />
              <rect x="8" y="16" width="8" height="8" fill="#5c6066" opacity="0.55" />
              <rect x="88" y="16" width="8" height="8" fill="#5c6066" opacity="0.55" />
              <rect x="0" y="24" width="8" height="8" fill="#5c6066" opacity="0.55" />
              <rect x="104" y="24" width="8" height="8" fill="#5c6066" opacity="0.55" />
              <rect x="8" y="48" width="24" height="8" fill="#5c6066" opacity="0.55" />
              <rect x="80" y="48" width="24" height="8" fill="#5c6066" opacity="0.55" />
            </svg>
            <div className="page-intro-copy">
              <span className="page-intro-eyebrow">{currentPage.eyebrow}</span>
              <h1>{currentPage.title}</h1>
              <p>{currentPage.description}</p>
            </div>
            <div className="page-intro-console">
              <div className="page-intro-seal" aria-label="零知识加密会话已激活">
                <span className="page-intro-seal-icon"><Blocks size={18} /></span>
                <span><small>零知识</small>本地加密会话</span>
              </div>

              {showLedgerTelemetry ? (
                <div className="ledger-telemetry" aria-label="密文账本状态">
                  <div className="ledger-telemetry-head">
                    <span>区块回执轨</span>
                    <span className="ledger-telemetry-live">
                      <i aria-hidden="true" />
                      会话在线
                    </span>
                  </div>
                  <div className="ledger-telemetry-track">
                    <div className="ledger-telemetry-node ledger-telemetry-node--primary">
                      <span className="ledger-telemetry-index">01</span>
                      <span className="ledger-telemetry-label">密文条目</span>
                      <strong>{ctx.itemCount}</strong>
                    </div>
                    <div className="ledger-telemetry-node">
                      <span className="ledger-telemetry-index">02</span>
                      <span className="ledger-telemetry-label">最近铸写</span>
                      <strong className="ledger-telemetry-copy">{ctx.updatedAt}</strong>
                    </div>
                    <div className="ledger-telemetry-node">
                      <span className="ledger-telemetry-index">03</span>
                      <span className="ledger-telemetry-label">同步回执</span>
                      <strong
                        className={
                          ctx.syncStatus.includes("已同步")
                            ? "ledger-telemetry-copy ledger-telemetry-copy--success"
                            : ctx.syncStatus.includes("冲突")
                              ? "ledger-telemetry-copy ledger-telemetry-copy--warning"
                              : "ledger-telemetry-copy"
                        }
                      >
                        {ctx.syncStatus}
                      </strong>
                    </div>
                    <div className="ledger-telemetry-node">
                      <span className="ledger-telemetry-index">04</span>
                      <span className="ledger-telemetry-label">上次上链</span>
                      <strong className="ledger-telemetry-copy">
                        {ctx.lastSyncedAt ? formatDateTime(ctx.lastSyncedAt) : "等待首枚回执"}
                      </strong>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </header>

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
        <div className="batch-update-drawer">
          {!batchUpdateConfirmOpen ? (
            <>
              <section className="batch-update-intro" aria-label="批量重铸说明">
                <span className="batch-update-kicker">批量重铸</span>
                <p>
                  为选中的 <strong>{batchUpdateIds.length}</strong> 个凭据生成新密码。
                  这一步只准备新密钥，确认前不会写入密码库。
                </p>
              </section>
              <PasswordGenerator showUseButton onUse={handleBatchGeneratorUse} />
            </>
          ) : (
            <>
              <section className="batch-update-warning" aria-label="批量更新警告">
                <AlertTriangle size={18} />
                <p>
                  将用新密码更新 {batchUpdateIds.length} 个凭据，此操作不可撤销。
                </p>
              </section>
              <div className="batch-update-password-preview" aria-label="即将写入的新密码">
                {batchUpdatePassword}
              </div>
              <div className="batch-update-actions">
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

      {/* Mobile Bottom Navigation */}
      <MobileNav
        activeNav={ctx.activeNav}
        onNavChange={ctx.setActiveNav}
        navIds={ctx.NAV_IDS}
      />
    </div>
  );
}
