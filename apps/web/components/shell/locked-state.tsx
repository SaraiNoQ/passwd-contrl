"use client";

import type { FormEvent } from "react";
import {
  AlertTriangle,
  Blocks,
  KeyRound,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UnlockKeyhole,
  Wifi,
  WifiOff,
} from "lucide-react";
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
  const modeLabel = hasLocalVault ? "UNLOCK MODE" : "FORGE MODE";
  const actionTitle = hasLocalVault ? "唤醒本地密钥" : "铸造主密钥";

  return (
    <div className={styles.lockedLayout}>
      <section className={styles.forgeStage} aria-labelledby="locked-title">
        <div className={styles.stageRail}>
          <span>OBSCURA / KEY FORGE</span>
          <span className={styles.railStatus}>
            <span aria-hidden="true" />
            本地加密舱在线
          </span>
        </div>

        <div className={styles.brandBlock}>
          <span className={styles.eyebrow}>密钥铸造台 · 零知识密码库</span>
          <h1 id="locked-title">
            铸造你的
            <span>唯一密钥</span>
          </h1>
          <p>
            主密码是开启密码库的唯一模具。它只在此设备参与运算，服务器接收的永远只有无法还原的加密数据。
          </p>
        </div>

        <div className={styles.forgeMachine} aria-hidden="true">
          <div className={styles.machineLabel}>
            <span>KEY MATERIAL</span>
            <strong>{hasLocalVault ? "SEALED / 待解锁" : "READY / 待铸造"}</strong>
          </div>
          <div className={styles.keyChamber}>
            <span className={styles.scanLine} />
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
            <span className={styles.chamberCode}>LOCAL // AES-256 // 0x01</span>
          </div>
          <div className={styles.machineTicks}>
            {Array.from({ length: 12 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
        </div>

        <ol className={styles.forgeSteps} aria-label="密钥保护流程">
          <li>
            <span>01</span>
            <div>
              <strong>本地塑形</strong>
              <small>主密码不离开设备</small>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>密文封装</strong>
              <small>敏感字段先加密</small>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>区块同步</strong>
              <small>只传输密文版本</small>
            </div>
          </li>
        </ol>

        <svg
          className={styles.pixelCloud}
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
          <rect x="16" y="8" width="8" height="8" fill="#5c6066" />
          <rect x="72" y="8" width="8" height="8" fill="#5c6066" />
          <rect x="8" y="16" width="8" height="8" fill="#5c6066" />
          <rect x="88" y="16" width="8" height="8" fill="#5c6066" />
          <rect x="0" y="24" width="8" height="8" fill="#5c6066" />
          <rect x="104" y="24" width="8" height="8" fill="#5c6066" />
          <rect x="8" y="48" width="24" height="8" fill="#5c6066" />
          <rect x="80" y="48" width="24" height="8" fill="#5c6066" />
        </svg>
      </section>

      <section className={styles.controlDeck} aria-labelledby="forge-action-title">
        <div className={styles.deckTopline}>
          <span>{modeLabel}</span>
          <span>STATION 01</span>
        </div>

        <div className={styles.unlockCardHeader}>
          <div className={styles.headerIcon} aria-hidden="true">
            {hasLocalVault ? <UnlockKeyhole size={22} /> : <LockKeyhole size={22} />}
          </div>
          <div>
            <span className={styles.cardEyebrow}>
              {hasLocalVault ? "返回密码库" : "初始化密码库"}
            </span>
            <h2 id="forge-action-title">{actionTitle}</h2>
            <p>
              {hasLocalVault
                ? "输入主密码，恢复这台设备上的加密工作区。"
                : "设置至少 12 个字符的主密码，启动本地加密工作区。"}
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
            placeholder="输入至少 12 个字符"
            aria-describedby="master-password-security-note"
          />
          <Button type="submit" loading={loading} className={styles.primarySubmit ?? ""}>
            {hasLocalVault ? <UnlockKeyhole size={18} /> : <Sparkles size={18} />}
            {loading ? "密钥处理中..." : hasLocalVault ? "解锁密码库" : "开始铸造"}
          </Button>
        </form>

        <div className={styles.securityStrip} id="master-password-security-note">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            <strong>设备内闭环</strong>
            主密码不会发送到服务器
          </span>
        </div>

        {loading && statusMessage ? (
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
            {statusMessage}
          </div>
        ) : null}

        <div className={styles.bridgeRow}>
          <span className={styles.bridgeLabel}>
            <Blocks size={15} aria-hidden="true" />
            扩展桥接
          </span>
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
        </div>

        {hasLocalVault ? (
          <div className={styles.recoverySection}>
            <Button
              variant="ghost"
              className={styles.recoveryToggle ?? ""}
              type="button"
              onClick={onToggleRecoveryEntry}
              aria-expanded={showRecoveryEntry}
              aria-controls="vault-recovery-entry"
            >
              <KeyRound size={16} aria-hidden="true" />
              <span>主密码失效？使用恢复码</span>
              <span className={styles.toggleMark} aria-hidden="true">
                {showRecoveryEntry ? "−" : "+"}
              </span>
            </Button>
            {showRecoveryEntry ? (
              <form
                id="vault-recovery-entry"
                className={styles.recoveryForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  onRecoverVault();
                }}
              >
                <div className={styles.recoveryHeading}>
                  <span>RECOVERY CHANNEL</span>
                  <strong>恢复通道</strong>
                </div>
                <Input
                  id="vault-recovery-code"
                  label="恢复码"
                  type="text"
                  value={recoveryInputCode}
                  onChange={(e) => onRecoveryInputCodeChange(e.target.value)}
                  placeholder="粘贴离线保存的恢复码"
                  autoComplete="off"
                />
                <Input
                  id="vault-recovery-password"
                  label="新主密码"
                  type="password"
                  value={recoveryPassword}
                  onChange={(e) => onRecoveryPasswordChange(e.target.value)}
                  placeholder="输入至少 12 个字符"
                  minLength={12}
                  autoComplete="new-password"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  loading={loading}
                  className={styles.recoverySubmit ?? ""}
                >
                  {loading ? "恢复中..." : "恢复密码库"}
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className={`error-banner ${styles.errorBanner}`} role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className={styles.resetVaultSection}>
          <span>紧急维护</span>
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
      </section>
    </div>
  );
}
