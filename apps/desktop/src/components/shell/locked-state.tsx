"use client";

import {
  AlertTriangle,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UnlockKeyhole,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import styles from "./locked-state.module.css";

export interface LockedStateProps {
  /** Called with the master password when the user submits the unlock form */
  onUnlock: (password: string) => Promise<void> | Promise<boolean>;
  /** Whether an unlock or recovery operation is in progress */
  isLoading: boolean;
  /** Error message to display, or null if none */
  error: string | null;
  /** Whether a local vault already exists (unlock mode) or needs creation (forge mode) */
  hasLocalVault: boolean;
  /** Open the recovery-code modal for an existing local vault. */
  onOpenRecovery?: () => void;
}

export function LockedState({
  onUnlock,
  isLoading,
  error,
  hasLocalVault,
  onOpenRecovery,
}: LockedStateProps) {
  const [masterPassword, setMasterPassword] = useState("");
  const [showRecoveryEntry, setShowRecoveryEntry] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (masterPassword.length < 12) return;
    await onUnlock(masterPassword);
  };

  const handleRecoverySubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onOpenRecovery?.();
  };

  return (
    <div className={styles.lockedLayout}>
      <section className={styles.controlDeck} aria-labelledby="forge-action-title">
        <div className={styles.deckTopline}>
          <span>{hasLocalVault ? "UNLOCK MODE" : "FORGE MODE"}</span>
          <span>STATION 01</span>
        </div>

        {/* Pixel key illustration */}
        <div className={styles.pixelKeyWrapper} aria-hidden="true">
          <svg
            className={styles.pixelKey}
            viewBox="0 0 320 144"
            shapeRendering="crispEdges"
          >
            <rect x="24" y="40" width="16" height="64" fill="#5c6066" />
            <rect x="40" y="24" width="64" height="16" fill="#5c6066" />
            <rect x="40" y="104" width="64" height="16" fill="#5c6066" />
            <rect x="104" y="40" width="16" height="64" fill="#5c6066" />
            <rect x="48" y="40" width="48" height="16" fill="#ffffff" />
            <rect x="40" y="56" width="64" height="32" fill="#e3f1fe" />
            <rect x="48" y="88" width="48" height="16" fill="#ffffff" />
            <rect x="64" y="56" width="24" height="32" fill="#ff5e24" />
            <rect x="120" y="64" width="144" height="24" fill="#232629" />
            <rect x="248" y="88" width="24" height="24" fill="#232629" />
            <rect x="272" y="88" width="24" height="40" fill="#232629" />
            <rect x="136" y="64" width="96" height="8" fill="#ffffff" opacity="0.3" />
          </svg>
        </div>

        <div className={styles.unlockCardHeader}>
          <div className={styles.headerIcon} aria-hidden="true">
            {hasLocalVault ? <UnlockKeyhole size={22} /> : <LockKeyhole size={22} />}
          </div>
          <div>
            <span className={styles.cardEyebrow}>
              {hasLocalVault ? "返回密码库" : "初始化密码库"}
            </span>
            <h2 id="forge-action-title">
              {hasLocalVault ? "唤醒本地密钥" : "铸造主密钥"}
            </h2>
            <p>
              {hasLocalVault
                ? "输入主密码，恢复这台设备上的加密工作区。"
                : "设置至少 12 个字符的主密码，启动本地加密工作区。"}
            </p>
          </div>
        </div>

        <form className={styles.unlockForm} onSubmit={handleSubmit}>
          <div className={styles.inputGroup}>
            <label className={styles.inputLabel} htmlFor="master-password">
              主密码
            </label>
            <input
              id="master-password"
              className={`${styles.inputField} ${error ? styles.inputError : ""}`}
              autoComplete={hasLocalVault ? "current-password" : "new-password"}
              minLength={12}
              type="password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder="输入至少 12 个字符"
              disabled={isLoading}
              aria-describedby="master-password-security-note"
            />
          </div>
          <button
            type="submit"
            className={styles.primarySubmit}
            disabled={isLoading || masterPassword.length < 12}
          >
            {hasLocalVault ? <UnlockKeyhole size={18} /> : <Sparkles size={18} />}
            {isLoading
              ? "密钥处理中..."
              : hasLocalVault
                ? "解锁密码库"
                : "开始铸造"}
          </button>
        </form>

        <div className={styles.securityStrip} id="master-password-security-note">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            <strong>设备内闭环</strong>
            主密码不会发送到服务器
          </span>
        </div>

        {isLoading ? (
          <div className={styles.loadingStatus} role="status" aria-live="polite">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className={styles.loadingSpinner}
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="31.4 31.4"
              />
            </svg>
            密钥处理中...
          </div>
        ) : null}

        {/* Recovery code toggle — only shown for existing vaults */}
        {hasLocalVault ? (
          <>
            <button
              type="button"
              className={styles.recoveryToggle}
              onClick={() => setShowRecoveryEntry((v) => !v)}
              aria-expanded={showRecoveryEntry}
              aria-controls="vault-recovery-entry"
            >
              <KeyRound size={16} aria-hidden="true" />
              <span className={styles.recoveryLinkText}>
                主密码失效？使用恢复码
              </span>
              <span className={styles.toggleMark} aria-hidden="true">
                {showRecoveryEntry ? "−" : "+"}
              </span>
            </button>

            {showRecoveryEntry ? (
              <form
                id="vault-recovery-entry"
                className={styles.recoveryForm}
                onSubmit={handleRecoverySubmit}
              >
                <div className={styles.recoveryHeading}>
                  <span>RECOVERY CHANNEL</span>
                  <strong>恢复通道</strong>
                </div>
                <p className={styles.recoveryLinkText}>
                  使用已设置的离线恢复码解封本地密码库。恢复码只在本设备内解密恢复包，不会发送到服务器。
                </p>
                <button
                  type="submit"
                  className={styles.recoverySubmit}
                  disabled={isLoading || !onOpenRecovery}
                >
                  {isLoading ? "恢复中..." : "打开恢复码入口"}
                </button>
              </form>
            ) : null}
          </>
        ) : null}

        {/* Error display */}
        {error ? (
          <div className={styles.errorBanner} role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
