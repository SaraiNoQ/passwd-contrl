"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PasswordField } from "../ui/password-field";
import { Modal } from "../ui/modal";
import { cn } from "../../lib/utils";
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
          <p className={styles.eyebrow}>OBSCURA WORKSHOP</p>
          <h2 id="settings-control-title" className={styles.heroTitle}>
            密钥工坊
          </h2>
          <p className={styles.heroCopy}>
            在这座像素账本控制台里校准锁定节拍、浏览器桥接、备份铸造和危险维护。每个控件都沿用既有链路，不触碰你的主密码和本地密钥边界。
          </p>
        </div>
        <div className={styles.heroSummary} aria-label="当前设置摘要">
          <span>
            <small>锁定节拍</small>
            <strong>{AUTO_LOCK_OPTIONS.find((opt) => opt.value === autoLockTimeout)?.label ?? "自定义"}</strong>
          </span>
          <span>
            <small>链路模式</small>
            <strong>{autoSyncEnabled ? "自动同步" : "手动同步"}</strong>
          </span>
          <span>
            <small>扩展桥接</small>
            <strong>{extensionId ? "已接入" : "待登记"}</strong>
          </span>
        </div>
      </section>

      <div className={styles.controlGrid}>
        <section className={cn(styles.card, styles.securityCard)}>
          <div className={styles.cardHeader}>
            <div className={styles.cardSprite} aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <p className={styles.cardKicker}>LOCK TIMER</p>
            <h3 className={styles.cardTitle}>主密钥核心</h3>
            <p className={styles.cardDescription}>
              校准会话锁定节拍，并在需要时重铸主密码。
            </p>
          </div>

          <div className={styles.row}>
            <div>
              <div className={styles.rowLabel}>锁屏倒计时</div>
              <div className={styles.rowHint}>
                超过设定时间未操作后，密钥工坊会自动合闸。
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
              <div className={styles.rowLabel}>主密码重铸台</div>
              <p className={styles.rowHint}>
                重铸后需要重新验证身份，新密码至少 12 个字符。
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
                <p className={styles.passwordSuccess}>主密码已写入新的密钥槽</p>
              )}

              <div className={styles.passwordActions}>
                <Button
                  onClick={handlePasswordSubmit}
                  loading={passwordLoading}
                  disabled={loading}
                >
                  重铸主密码
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className={cn(styles.card, styles.bridgeCard)}>
          <div className={styles.cardHeader}>
            <div className={styles.bridgeSprite} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className={styles.cardKicker}>EXTENSION BRIDGE</p>
            <h3 className={styles.cardTitle}>扩展桥接</h3>
            <p className={styles.cardDescription}>
              绑定浏览器扩展 ID，让自动填充入口只响应受信插件。
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
              写入桥接
            </Button>
          </div>
          <div className={styles.miniLedger}>
            <span>桥接通道</span>
            <strong>{extensionId ? "已登记" : "等待绑定"}</strong>
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
              将密码库铸成迁移文件或加密备份。CSV 只用于临时迁移，加密备份保留主密码保护。
            </p>
          </div>

          <div className={styles.selectionStrip}>
            <span>当前选中</span>
            <strong>{selectedCount} 项</strong>
          </div>

          <div className={styles.exportActions}>
            <div className={styles.exportRow}>
              <div>
                <div className={styles.rowLabel}>回灌加密备份</div>
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
                回灌备份
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
                  明文账本，仅用于短时迁移。导出后请立即妥善处理。
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => confirmCsvExport(onExportCsv)}
                disabled={loading}
              >
                铸出 CSV
              </Button>
            </div>

            <div className={styles.exportRow}>
              <div>
                <div className={styles.rowLabel}>导出选中 CSV</div>
                <p className={styles.exportWarning}>
                  只铸出当前凭据列表中选中的项目。
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => confirmCsvExport(onExportCsvSelected)}
                disabled={loading || selectedCount === 0}
              >
                铸出选中
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
                铸出密文
              </Button>
            </div>

            <div className={styles.exportRow}>
              <div>
                <div className={styles.rowLabel}>导出选中加密备份</div>
                <p className={styles.exportWarning}>
                  将选中凭据铸为加密备份文件。
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => void onExportEncryptedSelected()}
                disabled={loading || selectedCount === 0}
              >
                选中密文
              </Button>
            </div>
          </div>
        </section>

        <section className={cn(styles.card, styles.syncCard)}>
          <div className={styles.cardHeader}>
            <div className={styles.syncSprite} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className={styles.cardKicker}>SYNC ROUTER</p>
            <h3 className={styles.cardTitle}>链路同步</h3>
            <p className={styles.cardDescription}>
              让本地加密数据按固定节拍投递到你的设备网络。
            </p>
          </div>

          <div className={styles.row}>
            <div>
              <div className={styles.rowLabel}>自动上链节拍</div>
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
                <div className={styles.rowHint}>自动同步的投递间隔。</div>
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

        <section className={cn(styles.card, styles.dangerCard)}>
          <div className={styles.cardHeader}>
            <div className={styles.dangerSprite} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p className={styles.cardKicker}>DANGER MAINTENANCE</p>
            <h3 className={styles.cardTitle}>危险维护</h3>
            <p className={styles.cardDescription}>
              删除账户会清空所有本地凭据、安全笔记、附件和偏好。
            </p>
          </div>

          <div className={styles.dangerZone}>
            <div>
              <p className={styles.dangerTitle}>熔毁本地账本</p>
              <p className={styles.dangerDescription}>
                此操作不可撤销，请先完成加密备份。
              </p>
            </div>
            <Button
              variant="danger"
              onClick={() => setDeleteModalOpen(true)}
              disabled={loading}
            >
              熔毁账户
            </Button>
          </div>
        </section>
      </div>

      {/* ===== CSV export confirmation modal ===== */}
      <Modal
        open={csvExportModalOpen}
        onClose={handleCsvExportCancel}
        title="确认铸出 CSV"
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
              确认铸出
            </Button>
          </>
        }
      >
        <div className={styles.deleteModalBody}>
          <p className={styles.deleteModalWarning}>
            CSV 文件包含明文密码，相当于未加密账本，请确保安全存储。
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
        title="确认熔毁账户"
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
              确认熔毁
            </Button>
          </>
        }
      >
        <div className={styles.deleteModalBody}>
          <p className={styles.deleteModalWarning}>
            熔毁账户后，以下数据将被永久清除：
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
