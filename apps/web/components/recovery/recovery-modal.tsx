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
}: RecoveryModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [onCopy]);

  const handlePrint = useCallback(() => {
    const printWindow = window.open("", "_blank", "width=400,height=300");
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Obscura — 恢复码</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; text-align: center; }
    h1 { font-size: 18px; color: #1a1a1a; margin-bottom: 24px; }
    .code {
      font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
      font-size: 15px; letter-spacing: 0.5px;
      background: #f5f5f5; padding: 16px 20px; border-radius: 8px;
      word-break: break-all; margin: 20px 0; border: 1px solid #ddd;
    }
    .warning { color: #666; font-size: 12px; margin-top: 24px; line-height: 1.6; }
    .label { font-size: 13px; color: #888; margin-bottom: 8px; }
  </style>
</head>
<body>
  <h1>Obscura 恢复码</h1>
  <p class="label">Recovery Code:</p>
  <div class="code">${recoveryCode}</div>
  <p class="warning">
    Store this code in a safe offline location.<br />
    This code will not be shown again.
  </p>
</body>
</html>`);
    printWindow.document.close();
    printWindow.print();
  }, [recoveryCode]);

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="恢复码"
      className="pixel-border pixel-scanlines"
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
      <div className={`${styles.warningBox} pixel-border`}>
        <AlertTriangle size={16} />
        <span>
          请将恢复码保存在安全位置。它可用于在忘记主密码时恢复密码库。此恢复码不会再次显示。
        </span>
      </div>

      {/* Recovery code display */}
      <h4 className={styles.sectionTitle}>您的恢复码</h4>
      <div className={`${styles.codeDisplay} pixel-border`}>
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
              <Check size={14} style={{ color: "var(--color-success)" }} />
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
      <div className={`${styles.offlineSection} pixel-border`}>
        <p className={styles.offlineHeading}>
          <ShieldAlert size={16} />
          离线保存建议
        </p>
        <ul className={styles.offlineList}>
          <li className={styles.offlineItem}>
            <Check size={12} />
            <span>写在纸上并保存在安全位置（如保险箱）</span>
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
            <span>恢复码不会上传到服务器，丢失后无法找回</span>
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
        我已将恢复码保存在安全的离线位置
      </label>
    </Modal>
  );
}
