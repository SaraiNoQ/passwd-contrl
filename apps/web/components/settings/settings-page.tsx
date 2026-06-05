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
      {/* ===== 基础设置 ===== */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>基础设置</h2>

        {/* Auto-lock timeout */}
        <div className={styles.row}>
          <div>
            <div className={styles.rowLabel}>自动锁定超时</div>
            <div className={styles.rowHint}>
              超过设定时间未操作后自动锁定
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

        <hr className={styles.divider} />

        {/* Extension ID */}
        <div>
          <div className={styles.rowLabel} style={{ marginBottom: "var(--space-2)" }}>
            扩展 ID
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
              保存
            </Button>
          </div>
        </div>
      </section>

      {/* ===== 密码管理 ===== */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>密码管理</h2>
        <p className={styles.sectionDescription}>
          修改主密码后需要重新验证身份
        </p>

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
            <p className={styles.passwordSuccess}>密码修改成功</p>
          )}

          <div className={styles.passwordActions}>
            <Button
              onClick={handlePasswordSubmit}
              loading={passwordLoading}
              disabled={loading}
            >
              修改密码
            </Button>
          </div>
        </div>
      </section>

      {/* ===== 数据导入 ===== */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>数据导入</h2>

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
            导入加密备份
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={(e) => void handleImportFile(e)}
            style={{ display: "none" }}
          />
        </div>

        {importBackupStatus && (
          <div className={styles.importStatus} role="status">
            {importBackupStatus}
          </div>
        )}
      </section>

      {/* ===== CSV 导出 ===== */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>CSV 导出</h2>

        <p className={styles.selectionCount}>
          已选中 {selectedCount} 项
        </p>

        <div className={styles.exportActions}>
          <div className={styles.exportRow}>
            <div>
              <div className={styles.rowLabel}>导出全部 (CSV)</div>
              <p className={styles.exportWarning}>
                警告：CSV 文件以明文存储密码，请妥善保管
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => confirmCsvExport(onExportCsv)}
              disabled={loading}
            >
              导出全部 CSV
            </Button>
          </div>

          <hr className={styles.divider} />

          <div className={styles.exportRow}>
            <div>
              <div className={styles.rowLabel}>导出选中 (CSV)</div>
              <p className={styles.exportWarning}>
                仅导出在凭据列表中选中的项目
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => confirmCsvExport(onExportCsvSelected)}
              disabled={loading || selectedCount === 0}
            >
              导出选中 CSV
            </Button>
          </div>
        </div>
      </section>

      {/* ===== 加密备份导出 ===== */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>加密备份导出</h2>

        <p className={styles.selectionCount}>
          已选中 {selectedCount} 项
        </p>

        <div className={styles.exportActions}>
          <div className={styles.exportRow}>
            <div>
              <div className={styles.rowLabel}>导出全部 (加密备份)</div>
              <p className={styles.exportWarning}>
                Obscura 格式，使用主密码加密保护
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={onExportEncrypted}
              disabled={loading}
            >
              导出全部加密备份
            </Button>
          </div>

          <hr className={styles.divider} />

          <div className={styles.exportRow}>
            <div>
              <div className={styles.rowLabel}>导出选中 (加密备份)</div>
              <p className={styles.exportWarning}>
                仅导出选中的凭据为加密备份文件
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => void onExportEncryptedSelected()}
              disabled={loading || selectedCount === 0}
            >
              导出选中加密备份
            </Button>
          </div>
        </div>
      </section>

      {/* ===== 同步配置 ===== */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>同步配置</h2>

        <div className={styles.row}>
          <div>
            <div className={styles.rowLabel}>自动同步</div>
            <div className={styles.rowHint}>开启后将定期同步数据</div>
          </div>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={autoSyncEnabled}
              onChange={(e) => onAutoSyncEnabledChange(e.target.checked)}
              disabled={loading}
            />
          </label>
        </div>

        {autoSyncEnabled && (
          <>
            <hr className={styles.divider} />
            <div className={styles.row}>
              <div>
                <div className={styles.rowLabel}>同步间隔</div>
                <div className={styles.rowHint}>自动同步的时间间隔</div>
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
          </>
        )}
      </section>

      {/* ===== 账户管理 ===== */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>账户管理</h2>

        <div className={styles.dangerZone}>
          <div>
            <p className={styles.dangerTitle}>删除账户</p>
            <p className={styles.dangerDescription}>
              此操作不可撤销，所有数据将被永久删除
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

      {/* ===== CSV export confirmation modal ===== */}
      <Modal
        open={csvExportModalOpen}
        onClose={handleCsvExportCancel}
        title="确认 CSV 导出"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={handleCsvExportCancel}
            >
              取消
            </Button>
            <Button
              onClick={handleCsvExportConfirm}
            >
              确认导出
            </Button>
          </>
        }
      >
        <div className={styles.deleteModalBody}>
          <p className={styles.deleteModalWarning}>
            CSV 文件包含明文密码，请确保安全存储。
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
