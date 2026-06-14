"use client";

import { useCallback, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import styles from "./settings-page.module.css";

export interface SettingsPageProps {
  autoLockMinutes: number;
  onAutoLockChange: (minutes: number) => void;
  onChangeMasterPassword?: (current: string, newPass: string) => Promise<void>;
  onDeleteAccount?: () => Promise<void>;
  onExportCsv?: () => void;
  onExportEncrypted?: () => void;
  loading?: boolean;
}

const AUTO_LOCK_OPTIONS: { label: string; value: number }[] = [
  { label: "1 分钟", value: 1 },
  { label: "5 分钟", value: 5 },
  { label: "10 分钟", value: 10 },
  { label: "15 分钟", value: 15 },
  { label: "30 分钟", value: 30 },
  { label: "60 分钟", value: 60 },
];

const APP_VERSION = "0.1.0";

export function SettingsPage({
  autoLockMinutes,
  onAutoLockChange,
  onChangeMasterPassword,
  onDeleteAccount,
  onExportCsv,
  onExportEncrypted,
  loading = false,
}: SettingsPageProps) {
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
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // --- Handlers ---

  const handleAutoLockChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onAutoLockChange(Number(e.target.value));
    },
    [onAutoLockChange],
  );

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

    if (!onChangeMasterPassword) {
      setPasswordError("密码修改功能暂不可用");
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
    if (!onDeleteAccount) return;
    setDeleteError(null);
    setDeleteLoading(true);
    try {
      await onDeleteAccount();
      setDeleteModalOpen(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "删除账户失败");
    } finally {
      setDeleteLoading(false);
    }
  }, [onDeleteAccount]);

  // --- Render ---

  return (
    <div className={styles.page}>
      {/* Hero banner */}
      <section className={styles.hero} aria-labelledby="settings-title">
        <div>
          <p className={styles.eyebrow}>OBSCURA DESKTOP</p>
          <h2 id="settings-title" className={styles.heroTitle}>
            设置
          </h2>
          <p className={styles.heroCopy}>
            管理自动锁定、主密码、数据导出和账户安全。账户操作会通过受保护的远程 API 完成。
          </p>
        </div>
        <div className={styles.heroSummary} aria-label="当前设置摘要">
          <span>
            <small>自动锁定</small>
            <strong>{autoLockMinutes} 分钟</strong>
          </span>
          <span>
            <small>版本</small>
            <strong>v{APP_VERSION}</strong>
          </span>
        </div>
      </section>

      {/* Settings cards */}
      <div className={styles.controlGrid}>
        {/* Auto-lock section */}
        <section className={cn(styles.card, styles.securityCard)}>
          <div className={styles.cardHeader}>
            <p className={styles.cardKicker}>AUTO LOCK</p>
            <h3 className={styles.cardTitle}>自动锁定</h3>
            <p className={styles.cardDescription}>
              超过设定时间未操作后，密码库将自动锁定以保护数据安全。
            </p>
          </div>

          <div className={styles.settingRow}>
            <div>
              <div className={styles.rowLabel}>锁定超时</div>
              <div className={styles.rowHint}>
                当前设定：{autoLockMinutes} 分钟无操作后自动锁定
              </div>
            </div>
            <select
              className={styles.select}
              value={autoLockMinutes}
              onChange={handleAutoLockChange}
              disabled={loading}
              aria-label="自动锁定时间"
            >
              {AUTO_LOCK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Master password section */}
        <section className={cn(styles.card, styles.passwordCard)}>
          <div className={styles.cardHeader}>
            <p className={styles.cardKicker}>MASTER PASSWORD</p>
            <h3 className={styles.cardTitle}>主密码</h3>
            <p className={styles.cardDescription}>
              修改主密码后需要重新解锁密码库。新密码至少 12 个字符。
            </p>
          </div>

          <div className={styles.passwordPanel}>
            <div className={styles.passwordForm}>
              <Input
                label="当前密码"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={passwordLoading || loading}
                autoComplete="current-password"
              />
              <Input
                label="新密码"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordLoading || loading}
                autoComplete="new-password"
              />
              <Input
                label="确认新密码"
                type="password"
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
                  disabled={loading || !onChangeMasterPassword}
                >
                  修改主密码
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Export section */}
        <section className={cn(styles.card, styles.exportCard)}>
          <div className={styles.cardHeader}>
            <p className={styles.cardKicker}>DATA EXPORT</p>
            <h3 className={styles.cardTitle}>数据导出</h3>
            <p className={styles.cardDescription}>
              将密码库导出为 CSV 或加密备份文件。CSV 包含明文密码，请妥善保管。
            </p>
          </div>

          <div className={styles.exportActions}>
            <div className={styles.exportRow}>
              <div>
                <div className={styles.rowLabel}>导出 CSV</div>
                <p className={styles.exportWarning}>
                  明文格式，仅用于迁移。导出后请立即妥善处理。
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={onExportCsv}
                disabled={loading || !onExportCsv}
              >
                导出 CSV
              </Button>
            </div>

            <div className={styles.exportRow}>
              <div>
                <div className={styles.rowLabel}>导出加密备份</div>
                <p className={styles.exportWarning}>
                  Obscura 加密格式，继续使用主密码保护。
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={onExportEncrypted}
                disabled={loading || !onExportEncrypted}
              >
                导出加密备份
              </Button>
            </div>
          </div>
        </section>

        {/* Account / Danger section */}
        <section className={cn(styles.card, styles.dangerCard)}>
          <div className={styles.cardHeader}>
            <p className={styles.cardKicker}>ACCOUNT</p>
            <h3 className={styles.cardTitle}>账户</h3>
            <p className={styles.cardDescription}>
              删除账户将清空所有本地凭据、安全笔记和偏好设置。
            </p>
          </div>

          <div className={styles.dangerZone}>
            <div>
              <p className={styles.dangerTitle}>删除账户</p>
              <p className={styles.dangerDescription}>
                此操作不可撤销，请先完成加密备份。
              </p>
            </div>
            <Button
              variant="danger"
              onClick={() => setDeleteModalOpen(true)}
              disabled={loading || !onDeleteAccount}
            >
              删除账户
            </Button>
          </div>
        </section>

        {/* About section */}
        <section className={cn(styles.card, styles.aboutCard)}>
          <div className={styles.cardHeader}>
            <p className={styles.cardKicker}>ABOUT</p>
            <h3 className={styles.cardTitle}>关于</h3>
            <p className={styles.cardDescription}>
              Obscura 密码管理器 — 零知识加密，本地优先。
            </p>
          </div>

          <div className={styles.aboutInfo}>
            <div className={styles.aboutRow}>
              <span className={styles.aboutLabel}>应用版本</span>
              <span className={styles.aboutValue}>v{APP_VERSION}</span>
            </div>
            <div className={styles.aboutRow}>
              <span className={styles.aboutLabel}>构建平台</span>
              <span className={styles.aboutValue}>Tauri 2.x + React</span>
            </div>
            <div className={styles.aboutRow}>
              <span className={styles.aboutLabel}>加密引擎</span>
              <span className={styles.aboutValue}>Argon2id + XChaCha20-Poly1305</span>
            </div>
            <div className={styles.aboutRow}>
              <span className={styles.aboutLabel}>许可证</span>
              <span className={styles.aboutValue}>MIT</span>
            </div>
          </div>
        </section>
      </div>

      {/* Delete confirmation modal */}
      {deleteModalOpen && (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <div className={styles.modal}>
            <h3 id="delete-modal-title" className={styles.modalTitle}>
              确认删除账户
            </h3>
            <div className={styles.modalBody}>
              <p className={styles.modalWarning}>
                删除账户后，以下数据将被永久清除：
              </p>
              <ul className={styles.modalList}>
                <li>所有保存的密码和凭据</li>
                <li>安全笔记和附件</li>
                <li>账户设置和偏好</li>
              </ul>
              <p className={styles.modalIrreversible}>
                此操作不可撤销，请确认您已备份重要数据。
              </p>
            </div>
            <div className={styles.modalActions}>
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
            </div>
            {deleteError && (
              <p className={styles.passwordError} role="alert">
                {deleteError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
