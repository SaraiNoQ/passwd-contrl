"use client";

import { AlertTriangle, KeyRound, RotateCcw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PasswordField } from "../ui/password-field";
import {
  recoverVaultKey,
  loadRecoveryPacket,
  type RecoveryPacket,
} from "../../lib/recovery";
import { fetchRecoveryPacket } from "../../lib/api-client";
import styles from "./recovery-entry.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecoveryEntryProps {
  /** Called when recovery succeeds, returning the decrypted vault key and new password. */
  onRecoverySuccess: (vaultKey: Uint8Array, newPassword: string) => void;
  /** Called when the user cancels the recovery flow. */
  onCancel?: () => void;
  /** Set to true while the parent is processing the result (e.g. re-encrypting). */
  loading?: boolean;
  /** Error message from the parent (e.g. save failure). */
  serverError?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecoveryEntry({
  onRecoverySuccess,
  onCancel,
  loading = false,
  serverError,
}: RecoveryEntryProps) {
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [packet, setPacket] = useState<RecoveryPacket | null>(null);
  const [packetLoading, setPacketLoading] = useState(true);

  // Try localStorage first, then fetch from server if not found
  useEffect(() => {
    let cancelled = false;
    const loadPacket = async () => {
      try {
        const local = loadRecoveryPacket();
        if (local) {
          if (!cancelled) {
            setPacket(local);
            setPacketLoading(false);
          }
          return;
        }
      } catch {
        // localStorage read failed, try server
      }
      try {
        const remote = await fetchRecoveryPacket();
        if (!cancelled) {
          setPacket(remote);
        }
      } catch {
        // Server fetch failed
      } finally {
        if (!cancelled) setPacketLoading(false);
      }
    };
    void loadPacket();
    return () => { cancelled = true; };
  }, []);

  const noPacket = !packetLoading && packet === null;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLocalError(null);

      // Validation
      if (!recoveryCode.trim()) {
        setLocalError("请输入恢复码。");
        return;
      }

      if (!newPassword) {
        setLocalError("请输入新主密码。");
        return;
      }

      if (newPassword.length < 12) {
        setLocalError("新主密码至少需要 12 个字符。");
        return;
      }

      if (newPassword !== confirmPassword) {
        setLocalError("两次输入的密码不一致。");
        return;
      }

      if (!packet) {
        setLocalError("未找到恢复包。请确认此设备之前已设置恢复码。");
        return;
      }

      setSubmitting(true);
      try {
        const vaultKey = await recoverVaultKey(recoveryCode.trim(), packet);
        onRecoverySuccess(vaultKey, newPassword);
      } catch (err) {
        if (err instanceof DOMException && err.name === "OperationError") {
          setLocalError("恢复码无效，请检查后重试。");
        } else {
          setLocalError("恢复失败，请确认恢复码是否正确。");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [recoveryCode, newPassword, confirmPassword, packet, onRecoverySuccess],
  );

  const displayError = localError ?? serverError;

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.iconCircle}>
          <RotateCcw size={24} />
        </div>
        <h2 className={styles.title}>恢复密码库</h2>
        <p className={styles.subtitle}>
          输入您的恢复码和新主密码来恢复密码库访问权限。
        </p>
      </div>

      {/* No recovery packet warning */}
      {packetLoading && (
        <div className={styles.warningBox}>
          <ShieldAlert size={14} />
          <span>
            正在查找恢复包...
          </span>
        </div>
      )}
      {noPacket && !packetLoading && (
        <div className={styles.warningBox}>
          <ShieldAlert size={14} />
          <span>
            未找到恢复包。请确认您已登录且之前设置过恢复码。
          </span>
        </div>
      )}

      {/* Error display */}
      {displayError && (
        <div className={styles.errorBox}>
          <AlertTriangle size={16} />
          <span>{displayError}</span>
        </div>
      )}

      {/* Form */}
      <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
        <Input
          label="恢复码"
          type="text"
          value={recoveryCode}
          onChange={(e) => setRecoveryCode(e.target.value)}
          placeholder="输入您的恢复码"
          autoComplete="off"
          spellCheck={false}
          disabled={noPacket || packetLoading}
        />

        <PasswordField
          label="新主密码"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="设置新的主密码（至少 12 个字符）"
          autoComplete="new-password"
          disabled={noPacket || packetLoading}
        />

        <PasswordField
          label="确认新主密码"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="再次输入新主密码"
          autoComplete="new-password"
          disabled={noPacket || packetLoading}
          {...(confirmPassword.length > 0 && newPassword !== confirmPassword
            ? { error: "两次输入的密码不一致" }
            : {})}
        />

        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            loading={submitting || loading || packetLoading}
            disabled={noPacket || packetLoading}
          >
            <KeyRound size={16} />
            恢复密码库
          </Button>

          {onCancel && (
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onCancel}
            >
              返回登录
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
