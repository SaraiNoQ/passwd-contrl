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
    printRecoveryCode(recoveryCode);
  }, [recoveryCode]);

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="离线恢复区块"
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
          请将备用密钥分片保存在安全的离线位置。它可用于忘记主密码时解封密码库，且不会再次显示。
        </span>
      </div>

      {/* Recovery code display */}
      <h4 className={styles.sectionTitle}>备用密钥分片</h4>
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
          离线分片保存建议
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
            <span>备用分片不会上传到服务器，丢失后无法找回</span>
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
        我已将备用密钥分片保存在安全的离线位置
      </label>
    </Modal>
  );
}
