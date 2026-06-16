"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PasswordField } from "../ui/password-field";
import { Modal } from "../ui/modal";
import { cn } from "../../lib/utils";
import { CloudExportPanel } from "./cloud-export-panel";
import styles from "./settings-page.module.css";

export type SettingsPageProps = {
  autoLockTimeout: number;
  onAutoLockTimeoutChange: (timeout: number) => void;
  extensionId: string;
  onExtensionIdChange: (id: string) => void;
  onChangeMasterPassword: (current: string, newPass: string) => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onExportCsv: () => void;
  onExportEncrypted: () => void;
  autoSyncEnabled: boolean;
  onAutoSyncEnabledChange: (enabled: boolean) => void;
  syncInterval: number;
  onSyncIntervalChange: (interval: number) => void;
  loading: boolean;
  // -- Selective export --
  onExportCsvSelected: () => void;
  onExportEncryptedSelected: () => void;
  selectedCount: number;
  // -- Encrypted backup import --
  onImportEncryptedBackup: (file: File) => Promise<void>;
  importBackupStatus: string;
  // -- Cloud export --
  cloudExports?: Array<{ id: string; createdAt: string; algorithm: string }>;
  cloudExportLoading?: boolean;
  cloudExportError?: string;
  onLoadCloudExports?: () => Promise<void>;
  onCreateCloudExport?: () => Promise<void>;
  onDeleteCloudExport?: (id: string) => Promise<void>;
};

const AUTO_LOCK_OPTIONS: { label: string; value: number }[] = [
  { label: "1 分钟", value: 60 },
  { label: "5 分钟", value: 300 },
  { label: "10 分钟", value: 600 },
  { label: "30 分钟", value: 1800 },
];

const SYNC_INTERVAL_OPTIONS: { label: string; value: number }[] = [
  { label: "5 分钟", value: 300 },
  { label: "15 分钟", value: 900 },
  { label: "30 分钟", value: 1800 },
  { label: "1 小时", value: 3600 },
];

export function SettingsPage({
  autoLockTimeout,
  onAutoLockTimeoutChange,
  extensionId,
  onExtensionIdChange,
  onChangeMasterPassword,
  onDeleteAccount,
  onExportCsv,
  onExportEncrypted,
  autoSyncEnabled,
  onAutoSyncEnabledChange,
  syncInterval,
  onSyncIntervalChange,
  loading,
  onExportCsvSelected,
  onExportEncryptedSelected,
  selectedCount,
  onImportEncryptedBackup,
  importBackupStatus,
  cloudExports,
  cloudExportLoading,
  cloudExportError,
  onLoadCloudExports,
  onCreateCloudExport,
  onDeleteCloudExport,
}: SettingsPageProps) {
  // Extension ID draft state
  const [extensionIdDraft, setExtensionIdDraft] = useState(extensionId);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Delete account state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // CSV export confirmation state
  const [csvExportModalOpen, setCsvExportModalOpen] = useState(false);
  const [pendingCsvExport, setPendingCsvExport] = useState<(() => void) | null>(null);

  // Encrypted backup import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importLoading, setImportLoading] = useState(false);

  // --- Handlers ---

  const handleAutoLockChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onAutoLockTimeoutChange(Number(e.target.value));
    },
    [onAutoLockTimeoutChange],
  );

  const handleSyncIntervalChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onSyncIntervalChange(Number(e.target.value));
    },
    [onSyncIntervalChange],
  );

  const handleSaveExtensionId = useCallback(() => {
    onExtensionIdChange(extensionIdDraft.trim());
  }, [extensionIdDraft, onExtensionIdChange]);

  const handlePasswordSubmit = useCallback(async () => {
    setPasswordError(null);
    setPasswordSuccess(false);

    if (!currentPassword) {
      setPasswordError("请输入当前密码");
      return;
    }
    if (!newPassword) {
      setPasswordError("请输入新密码");
      return;
    }
    if (newPassword.length < 12) {
      setPasswordError("新密码至少需要 12 个字符");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }

    setPasswordLoading(true);
    try {
      await onChangeMasterPassword(currentPassword, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "修改密码失败，请重试",
      );
    } finally {
      setPasswordLoading(false);
    }
  }, [currentPassword, newPassword, confirmPassword, onChangeMasterPassword]);

  const handleDeleteConfirm = useCallback(async () => {
    setDeleteLoading(true);
    try {
      await onDeleteAccount();
    } catch {
      // Parent handles navigation / error display
    } finally {
      setDeleteLoading(false);
      setDeleteModalOpen(false);
    }
  }, [onDeleteAccount]);

  // CSV export with confirmation
  const confirmCsvExport = useCallback((exportFn: () => void) => {
    setPendingCsvExport(() => exportFn);
    setCsvExportModalOpen(true);
  }, []);

  const handleCsvExportConfirm = useCallback(() => {
    if (pendingCsvExport) {
      pendingCsvExport();
    }
    setCsvExportModalOpen(false);
    setPendingCsvExport(null);
  }, [pendingCsvExport]);

  const handleCsvExportCancel = useCallback(() => {
    setCsvExportModalOpen(false);
    setPendingCsvExport(null);
  }, []);

  // Encrypted backup import
  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    try {
      await onImportEncryptedBackup(file);
    } finally {
      setImportLoading(false);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [onImportEncryptedBackup]);

  // --- Render ---

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="settings-control-title">
        <svg
          className={styles.pixelCloud}
          width="112"
          height="64"
          viewBox="0 0 112 64"
          fill="none"
          aria-hidden="true"
          shapeRendering="crispEdges"
        >
          <rect x="16" y="24" width="16" height="16" fill="#ffffff" />
          <rect x="32" y="16" width="16" height="16" fill="#ffffff" />
          <rect x="48" y="16" width="16" height="16" fill="#ffffff" />
          <rect x="64" y="24" width="16" height="16" fill="#ffffff" />
          <rect x="80" y="32" width="16" height="16" fill="#ffffff" />
          <rect x="8" y="40" width="80" height="8" fill="#ffffff" />
          <rect x="16" y="48" width="72" height="8" fill="#e3f1fe" />
          <rect x="16" y="40" width="8" height="8" fill="#5c6066" opacity="0.22" />
          <rect x="88" y="40" width="8" height="8" fill="#5c6066" opacity="0.22" />
        </svg>
        <div>
          <p className={styles.eyebrow}>APP SETTINGS</p>
          <h2 id="settings-control-title" className={styles.heroTitle}>
            应用设置
          </h2>
          <p className={styles.heroCopy}>
            管理自动锁定、浏览器扩展、备份导出和账户安全。这里的设置会影响你日常解锁、同步和迁移密码的方式。
          </p>
        </div>
        <div className={styles.heroSummary} aria-label="当前设置摘要">
          <span>
            <small>自动锁定</small>
            <strong>{AUTO_LOCK_OPTIONS.find((opt) => opt.value === autoLockTimeout)?.label ?? "自定义"}</strong>
          </span>
          <span>
            <small>同步模式</small>
            <strong>{autoSyncEnabled ? "自动同步" : "手动同步"}</strong>
          </span>
          <span>
            <small>浏览器扩展</small>
            <strong>{extensionId ? "已连接" : "未连接"}</strong>
          </span>
        </div>
      </section>

      <div className={styles.controlGrid}>
        <div className={styles.mainStack}>
          <section className={cn(styles.card, styles.securityCard)}>
            <div className={styles.cardHeader}>
              <div className={styles.cardSprite} aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <p className={styles.cardKicker}>SECURITY</p>
              <h3 className={styles.cardTitle}>解锁安全</h3>
              <p className={styles.cardDescription}>
                设置多久无人操作后自动锁定，也可以在这里更新主密码。
              </p>
            </div>

            <div className={styles.controlStack}>
              <div className={styles.row}>
                <div>
                  <div className={styles.rowLabel}>锁屏倒计时</div>
                  <div className={styles.rowHint}>
                    超过设定时间未操作后，应用会自动锁定。
                  </div>
                </div>
                <select
                  className={styles.select}
                  value={autoLockTimeout}
                  onChange={handleAutoLockChange}
                  disabled={loading}
                >
                  {AUTO_LOCK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.passwordPanel}>
                <div>
                  <div className={styles.rowLabel}>修改主密码</div>
                  <p className={styles.rowHint}>
                    更新后需要重新验证身份，新密码至少 12 个字符。
                  </p>
                </div>
                <div className={styles.passwordForm}>
                  <PasswordField
                    label="当前密码"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={passwordLoading || loading}
                    autoComplete="current-password"
                  />
                  <PasswordField
                    label="新密码"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={passwordLoading || loading}
                    autoComplete="new-password"
                  />
                  <PasswordField
                    label="确认新密码"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={passwordLoading || loading}
                    autoComplete="new-password"
                  />

                  {passwordError && (
                    <p className={styles.passwordError} role="alert">
                      {passwordError}
                    </p>
                  )}
                  {passwordSuccess && (
                    <p className={styles.passwordSuccess}>主密码已更新</p>
                  )}

                  <div className={styles.passwordActions}>
                    <Button
                      onClick={handlePasswordSubmit}
                      loading={passwordLoading}
                      disabled={loading}
                    >
                      更新主密码
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className={cn(styles.card, styles.backupCard)}>
            <div className={styles.cardHeader}>
              <div className={styles.ledgerSprite} aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <p className={styles.cardKicker}>DATA BACKUP</p>
              <h3 className={styles.cardTitle}>数据备份</h3>
              <p className={styles.cardDescription}>
                将密码库导出为迁移文件或加密备份。CSV 只用于临时迁移，加密备份仍受主密码保护。
              </p>
            </div>

            <div className={styles.controlStack}>
              <div className={styles.selectionStrip}>
                <span>当前选中</span>
                <strong>{selectedCount} 项</strong>
              </div>

              <div className={styles.exportActions}>
                <div className={styles.exportRow}>
                  <div>
                    <div className={styles.rowLabel}>导入加密备份</div>
                    <p className={styles.exportWarning}>
                      选择 .json 备份文件以恢复加密密码库。导入后需使用主密码解锁。
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={handleImportClick}
                    disabled={loading || importLoading}
                    loading={importLoading}
                  >
                    导入备份
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={(e) => void handleImportFile(e)}
                    className={styles.fileInput}
                  />
                </div>

                {importBackupStatus && (
                  <div className={styles.importStatus} role="status">
                    {importBackupStatus}
                  </div>
                )}

                <hr className={styles.divider} />

                <div className={styles.exportRow}>
                  <div>
                    <div className={styles.rowLabel}>导出全部 CSV</div>
                    <p className={styles.exportWarning}>
                      明文列表，仅用于短时迁移。导出后请立即妥善处理。
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => confirmCsvExport(onExportCsv)}
                    disabled={loading}
                  >
                    导出 CSV
                  </Button>
                </div>

                <div className={styles.exportRow}>
                  <div>
                    <div className={styles.rowLabel}>导出选中 CSV</div>
                    <p className={styles.exportWarning}>
                      只导出当前凭据列表中选中的项目。
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => confirmCsvExport(onExportCsvSelected)}
                    disabled={loading || selectedCount === 0}
                  >
                    导出选中
                  </Button>
                </div>

                <hr className={styles.divider} />

                <div className={styles.exportRow}>
                  <div>
                    <div className={styles.rowLabel}>导出全部加密备份</div>
                    <p className={styles.exportWarning}>
                      Obscura 加密格式，继续使用主密码保护。
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={onExportEncrypted}
                    disabled={loading}
                  >
                    导出加密内容
                  </Button>
                </div>

                <div className={styles.exportRow}>
                  <div>
                    <div className={styles.rowLabel}>导出选中加密备份</div>
                    <p className={styles.exportWarning}>
                      将选中凭据导出为加密备份文件。
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => void onExportEncryptedSelected()}
                    disabled={loading || selectedCount === 0}
                  >
                    选中加密内容
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className={styles.sideStack}>
          <section className={cn(styles.card, styles.bridgeCard)}>
            <div className={styles.cardHeader}>
              <div className={styles.bridgeSprite} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p className={styles.cardKicker}>BROWSER EXTENSION</p>
              <h3 className={styles.cardTitle}>浏览器扩展</h3>
              <p className={styles.cardDescription}>
                填入浏览器扩展 ID，用于启用自动填充和快速保存入口。
              </p>
            </div>

            <div className={styles.extensionRow}>
              <Input
                className={cn(styles.extensionInput)}
                placeholder="输入浏览器扩展 ID"
                value={extensionIdDraft}
                onChange={(e) => setExtensionIdDraft(e.target.value)}
                disabled={loading}
              />
              <Button
                variant="secondary"
                onClick={handleSaveExtensionId}
                disabled={loading || extensionIdDraft.trim() === extensionId}
              >
                保存扩展 ID
              </Button>
            </div>
            <div className={styles.miniLedger}>
              <span>扩展状态</span>
              <strong>{extensionId ? "已连接" : "未连接"}</strong>
            </div>
          </section>

          {onCreateCloudExport && onDeleteCloudExport && onLoadCloudExports ? (
            <CloudExportPanel
              exports={cloudExports ?? []}
              loading={cloudExportLoading ?? false}
              error={cloudExportError ?? ""}
              onLoad={onLoadCloudExports}
              onCreate={onCreateCloudExport}
              onDelete={onDeleteCloudExport}
              disabled={loading}
            />
          ) : null}

          <section className={cn(styles.card, styles.syncCard)}>
            <div className={styles.cardHeader}>
              <div className={styles.syncSprite} aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p className={styles.cardKicker}>SYNC</p>
              <h3 className={styles.cardTitle}>设备同步</h3>
              <p className={styles.cardDescription}>
                让加密后的密码在你的设备之间保持一致。
              </p>
            </div>

            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>自动同步</div>
                <div className={styles.rowHint}>开启后将定期同步加密数据。</div>
              </div>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={autoSyncEnabled}
                  onChange={(e) => onAutoSyncEnabledChange(e.target.checked)}
                  disabled={loading}
                />
                <span>{autoSyncEnabled ? "开启" : "关闭"}</span>
              </label>
            </div>

            {autoSyncEnabled && (
              <div className={styles.row}>
                <div>
                  <div className={styles.rowLabel}>同步间隔</div>
                  <div className={styles.rowHint}>多久自动同步一次。</div>
                </div>
                <select
                  className={styles.select}
                  value={syncInterval}
                  onChange={handleSyncIntervalChange}
                  disabled={loading}
                >
                  {SYNC_INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>
        </div>

        <section className={cn(styles.card, styles.dangerCard)}>
          <div className={styles.cardHeader}>
            <div className={styles.dangerSprite} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className={styles.cardKicker}>DANGER AREA</p>
            <h3 className={styles.cardTitle}>危险操作</h3>
            <p className={styles.cardDescription}>
              删除账户会清空本机保存的密码、笔记、附件和偏好设置。
            </p>
          </div>

          <div className={styles.dangerZone}>
            <div>
              <p className={styles.dangerTitle}>删除账户与本地数据</p>
              <p className={styles.dangerDescription}>
                此操作不可撤销。请先导出加密备份，再继续删除。
              </p>
            </div>
            <Button
              variant="danger"
              onClick={() => setDeleteModalOpen(true)}
              disabled={loading}
            >
              删除账户
            </Button>
          </div>
        </section>
      </div>

      {/* ===== CSV export confirmation modal ===== */}
      <Modal
        open={csvExportModalOpen}
        onClose={handleCsvExportCancel}
        title="确认导出 CSV"
        eyebrow="CSV EXPORT / 明文导出"
        status="导出内容不会受到加密保护"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={handleCsvExportCancel}
            >
              取消
            </Button>
            <Button
              variant="secondary"
              className={styles.csvConfirmButton ?? ""}
              onClick={handleCsvExportConfirm}
            >
              确认导出
            </Button>
          </>
        }
      >
        <div className={styles.deleteModalBody}>
          <p className={styles.deleteModalWarning}>
            CSV 文件包含明文密码，相当于未加密列表，请确保安全存储。
          </p>
          <p className={styles.deleteModalIrreversible}>
            导出后请妥善保管文件，使用完毕后建议删除。
          </p>
        </div>
      </Modal>

      {/* ===== Delete confirmation modal ===== */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="确认删除账户"
        eyebrow="DANGER AREA / 危险操作"
        status="此操作不可撤销"
        destructive
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDeleteModalOpen(false)}
              disabled={deleteLoading}
            >
              取消
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteConfirm}
              loading={deleteLoading}
            >
              确认删除
            </Button>
          </>
        }
      >
        <div className={styles.deleteModalBody}>
          <p className={styles.deleteModalWarning}>
            删除账户后，以下数据将被永久清除：
          </p>
          <ul>
            <li>所有保存的密码和凭据</li>
            <li>安全笔记和附件</li>
            <li>账户设置和偏好</li>
          </ul>
          <p className={styles.deleteModalIrreversible}>
            此操作不可撤销，请确认您已备份重要数据。
          </p>
        </div>
      </Modal>
    </div>
  );
}
