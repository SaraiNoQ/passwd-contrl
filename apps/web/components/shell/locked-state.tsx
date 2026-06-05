"use client";

import type { FormEvent } from "react";
import { AlertTriangle, KeyRound, RotateCcw, ShieldCheck, UnlockKeyhole, Wifi, WifiOff } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import styles from "./locked-state.module.css";

export interface LockedStateProps {
  hasLocalVault: boolean;
  masterPassword: string;
  onMasterPasswordChange: (password: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  loading: boolean;
  statusMessage?: string;
  extensionBridge: { configured: boolean; runtimeAvailable: boolean };
  showRecoveryEntry: boolean;
  onToggleRecoveryEntry: () => void;
  recoveryInputCode: string;
  onRecoveryInputCodeChange: (code: string) => void;
  recoveryPassword: string;
  onRecoveryPasswordChange: (password: string) => void;
  onRecoverVault: () => void;
  error: string;
}

export function LockedState({
  hasLocalVault,
  masterPassword,
  onMasterPasswordChange,
  onSubmit,
  loading,
  statusMessage,
  extensionBridge,
  showRecoveryEntry,
  onToggleRecoveryEntry,
  recoveryInputCode,
  onRecoveryInputCodeChange,
  recoveryPassword,
  onRecoveryPasswordChange,
  onRecoverVault,
  error,
}: LockedStateProps) {
  return (
    <div className={styles.lockedLayout}>
      <div className={`${styles.unlockCard} pixel-border`}>
        <div className={styles.unlockCardHeader}>
          <ShieldCheck size={28} />
          <div>
            <h2>{hasLocalVault ? "解锁密码库" : "创建本地密码库"}</h2>
            <p>
              {hasLocalVault
                ? "输入主密码以解锁本地加密密码库。"
                : "设置主密码以创建本地加密密码库。"}
            </p>
          </div>
        </div>

        <form className={styles.unlockForm} onSubmit={onSubmit}>
          <Input
            id="master-password"
            label="主密码"
            autoComplete={hasLocalVault ? "current-password" : "new-password"}
            minLength={12}
            type="password"
            value={masterPassword}
            onChange={(e) => onMasterPasswordChange(e.target.value)}
            placeholder="至少 12 个字符"
          />
          <Button type="submit" loading={loading} className={styles.recoverySubmit ?? ""}>
            {hasLocalVault ? <UnlockKeyhole size={18} /> : <KeyRound size={18} />}
            {loading ? "处理中..." : hasLocalVault ? "解锁密码库" : "创建密码库"}
          </Button>
        </form>

        <div className={styles.unlockSecurityNote}>
          <ShieldCheck size={16} />
          <span>主密码只在此设备上使用，不会发送到服务器</span>
        </div>

        {/* Loading status message */}
        {loading && statusMessage ? (
          <div
            style={{
              background: "rgba(34, 211, 238, 0.08)",
              border: "1px solid rgba(34, 211, 238, 0.2)",
              borderRadius: "var(--radius-sm)",
              color: "var(--color-primary)",
              padding: "10px 14px",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              justifyContent: "center"
            }}
            role="status"
            aria-live="polite"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              style={{ animation: "spin 1s linear infinite" }}
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
            {statusMessage}
          </div>
        ) : null}

        {/* Extension bridge badge */}
        <div
          className={`top-bar-badge ${
            !extensionBridge.configured
              ? "top-bar-badge--warning"
              : extensionBridge.runtimeAvailable
                ? "top-bar-badge--success"
                : "top-bar-badge--danger"
          } ${styles.extensionBadge}`}
        >
          {extensionBridge.runtimeAvailable ? <Wifi size={14} /> : <WifiOff size={14} />}
          {!extensionBridge.configured
            ? "未配置扩展 ID"
            : extensionBridge.runtimeAvailable
              ? "扩展已连接"
              : "扩展未连接"}
        </div>

        {/* Recovery entry point */}
        {hasLocalVault ? (
          <div className={styles.recoverySection}>
            <button
              className={`btn btn-ghost ${styles.recoveryToggle}`}
              type="button"
              onClick={onToggleRecoveryEntry}
            >
              <KeyRound size={14} />
              使用恢复码恢复密码库
            </button>
            {showRecoveryEntry ? (
              <form
                className={styles.recoveryForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  onRecoverVault();
                }}
              >
                <Input
                  label="恢复码"
                  type="text"
                  value={recoveryInputCode}
                  onChange={(e) => onRecoveryInputCodeChange(e.target.value)}
                  placeholder="粘贴恢复码"
                  autoComplete="off"
                />
                <Input
                  label="新主密码"
                  type="password"
                  value={recoveryPassword}
                  onChange={(e) => onRecoveryPasswordChange(e.target.value)}
                  placeholder="至少 12 个字符"
                  minLength={12}
                  autoComplete="new-password"
                />
                <Button type="submit" loading={loading} className={styles.recoverySubmit ?? ""}>
                  {loading ? "恢复中..." : "恢复密码库"}
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="error-banner">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        {/* Reset vault - last resort for corrupted local data */}
        <div className={styles.resetVaultSection}>
          <Button
            variant="danger"
            size="sm"
            className={styles.resetVaultButton ?? ""}
            onClick={() => {
              if (
                window.confirm(
                  "确定要重置密码库吗？这将清除本地所有数据，此操作不可撤销。",
                )
              ) {
                const keysToRemove: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  if (key?.startsWith("zero-vault.")) {
                    keysToRemove.push(key);
                  }
                }
                for (const key of keysToRemove) {
                  localStorage.removeItem(key);
                }
                window.location.reload();
              }
            }}
          >
            <RotateCcw size={14} />
            重置密码库
          </Button>
        </div>
      </div>
    </div>
  );
}
