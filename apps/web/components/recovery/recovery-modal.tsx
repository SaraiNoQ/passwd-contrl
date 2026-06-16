"use client";

import {
  AlertTriangle,
  Check,
  Copy,
  Printer,
  ShieldAlert,
  X as XIcon,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Modal } from "../ui/modal";
import { Button } from "../ui/button";
import styles from "./recovery-modal.module.css";
import { printRecoveryCode } from "./recovery-print";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  recoveryCode: string;
  onCopy: () => void | Promise<void>;
  confirmed: boolean;
  onConfirmChange: (confirmed: boolean) => void;
  mode?: "initial" | "rotated";
  serverSaveFailed?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecoveryModal({
  isOpen,
  onClose,
  recoveryCode,
  onCopy,
  confirmed,
  onConfirmChange,
  mode = "initial",
  serverSaveFailed = false,
}: RecoveryModalProps) {
  const [copied, setCopied] = useState(false);
  const isRotated = mode === "rotated";

  const handleCopy = useCallback(async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [onCopy]);

  const handlePrint = useCallback(() => {
    printRecoveryCode(recoveryCode);
  }, [recoveryCode]);

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={isRotated ? "保存新的恢复码" : "离线恢复记录"}
      eyebrow="RECOVERY SHARD / 离线恢复码"
      status={isRotated ? "旧恢复码已失效" : "仅显示一次，请完成离线保存"}
      dismissible={confirmed}
      footer={
        <Button
          variant="primary"
          disabled={!confirmed}
          onClick={onClose}
          className={styles.doneBtn ?? ""}
        >
          完成
        </Button>
      }
    >
      {/* Primary warning */}
      <div className={styles.warningBox}>
        <AlertTriangle size={16} />
        <span>
          {isRotated
            ? "密码库已用新主密码恢复。旧恢复码已经失效，请立即保存下面的新恢复码。它不会再次显示。"
            : "请将备用恢复码保存在安全的离线位置。它可用于忘记主密码时解封密码库，且不会再次显示。"}
        </span>
      </div>

      {serverSaveFailed && (
        <div className={styles.warningBox} role="alert" style={{ borderColor: "var(--color-error, #ef4444)", background: "var(--color-error-bg, #fef2f2)" }}>
          <ShieldAlert size={16} />
          <span>
            恢复包未能同步到服务器。如果丢失此设备，服务器上的旧恢复包将无法解密新密码库。请尽快在稳定网络下重新生成恢复码。
          </span>
        </div>
      )}

      {/* Recovery code display */}
      <h4 className={styles.sectionTitle}>
        {isRotated ? "新的备用恢复码" : "备用恢复码"}
      </h4>
      <div className={styles.codeDisplay}>
        <span className={styles.codeRail} aria-hidden="true" />
        <code className={styles.code}>{recoveryCode}</code>
        <div className={styles.codeActions}>
          <button
            type="button"
            className={styles.copyBtn}
            onClick={() => void handleCopy()}
            title="复制恢复码"
            aria-label="复制恢复码"
          >
            {copied ? (
              <Check size={14} className={styles.successIcon} />
            ) : (
              <Copy size={14} />
            )}
          </button>
          <button
            type="button"
            className={styles.printBtn}
            onClick={handlePrint}
            title="打印恢复码"
            aria-label="打印恢复码"
          >
            <Printer size={14} />
          </button>
        </div>
      </div>

      <hr className={styles.divider} />

      {/* Offline storage guidance */}
      <div className={styles.offlineSection}>
        <p className={styles.offlineHeading}>
          <ShieldAlert size={16} />
          离线恢复码保存建议
        </p>
        <ul className={styles.offlineList}>
          <li className={styles.offlineItem}>
            <Check size={12} />
            <span>写在纸上并放入保险箱或其他离线保管处</span>
          </li>
          <li className={styles.offlineItem}>
            <XIcon size={12} />
            <span>不要截图、拍照或存储在云端</span>
          </li>
          <li className={styles.offlineItem}>
            <XIcon size={12} />
            <span>不要通过邮件、消息或笔记应用传输</span>
          </li>
          <li className={styles.offlineItem}>
            <XIcon size={12} />
            <span>备用恢复码不会上传到服务器，丢失后无法找回</span>
          </li>
        </ul>
      </div>

      {/* Confirmation */}
      <label className={styles.confirmRow}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmChange(e.target.checked)}
        />
        我已将这份备用恢复码保存在安全的离线位置
      </label>
    </Modal>
  );
}
