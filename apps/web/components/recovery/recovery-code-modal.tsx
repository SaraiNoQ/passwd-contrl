"use client";

import { AlertTriangle, Check, Copy, KeyRound, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  generateRecoveryCode,
  createRecoveryPacket,
  type RecoveryPacket
} from "../../lib/recovery";
import { Button } from "../ui/button";
import styles from "./recovery-code-modal.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecoveryCodeModalProps = {
  onComplete: (packet: RecoveryPacket) => void;
  onCancel: () => void;
  vaultKey: Uint8Array;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = ["离线备份", "生成恢复码", "抄录保存", "回读确认"] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RecoveryCodeModal({ onComplete, onCancel, vaultKey }: RecoveryCodeModalProps) {
  const [step, setStep] = useState(0);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [packet, setPacket] = useState<RecoveryPacket | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [verificationInput, setVerificationInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatingError, setGeneratingError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus trap on mount
  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  // Cleanup on unmount - clear sensitive state
  useEffect(() => {
    return () => {
      setRecoveryCode(null);
      setVerificationInput("");
    };
  }, []);

  // ESC to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  // Generate recovery code
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setGeneratingError(null);
    try {
      const code = generateRecoveryCode();
      const pkt = await createRecoveryPacket(code, vaultKey);
      setRecoveryCode(code);
      setPacket(pkt);
      setStep(2);
    } catch {
      setGeneratingError("生成恢复码失败，请重试。");
    } finally {
      setGenerating(false);
    }
  }, [vaultKey]);

  // Copy to clipboard
  const handleCopy = useCallback(async () => {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail silently
    }
  }, [recoveryCode]);

  // Complete
  const handleComplete = useCallback(() => {
    if (!packet) return;
    onComplete(packet);
  }, [packet, onComplete]);

  // Verification check
  const isVerificationValid = useMemo(() => {
    if (!recoveryCode) return false;
    return verificationInput.trim() === recoveryCode.trim();
  }, [verificationInput, recoveryCode]);

  // Step navigation
  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  }, [step]);

  // Step content
  const renderStepContent = () => {
    switch (step) {
      case 0:
        return renderExplanationStep();
      case 1:
        return renderGenerateStep();
      case 2:
        return renderDisplayStep();
      case 3:
        return renderConfirmStep();
      default:
        return null;
    }
  };

  const renderExplanationStep = () => (
    <div>
      <div className={`${styles.centerContent} ${styles.centerContentSpaced}`}>
        <div className={styles.iconCircle}>
          <KeyRound size={24} className={styles.iconPrimary} />
        </div>
        <h3 className={styles.sectionTitle}>
          离线恢复记录
        </h3>
      </div>

      <div className={styles.infoBox}>
        <p>
          恢复码是你的离线备用钥匙：它只在本机生成，用于主密码遗失时重新解锁密码库。
        </p>
      </div>

      <div className={`${styles.explanationText} ${styles.mt4}`}>
        <p>恢复码如何工作：</p>
        <ol>
          <li>本机生成一组只显示一次的恢复码</li>
          <li>恢复码用于保护你的密码库访问权限</li>
          <li>恢复包只作为离线备份保存</li>
          <li>需要恢复时，输入恢复码即可重新解锁密码库</li>
        </ol>
      </div>

      <div className={`${styles.warningBox} ${styles.mt4}`}>
        <ShieldAlert size={16} />
        <div>
          <p className={styles.warningBoxTitle}>备用恢复码不会上传到服务器</p>
          <p className={styles.warningBoxSub}>
            一旦遗失，任何节点或客服都无法替您更新。
          </p>
        </div>
      </div>
    </div>
  );

  const renderGenerateStep = () => (
    <div className={styles.centerContent}>
      <h3 className={styles.sectionTitle}>
        生成备用恢复码恢复码
      </h3>
      <p className={styles.sectionSubtitle}>
        点击下方按钮，在本机生成一枚只显示一次的恢复码。
      </p>

      {generatingError ? (
        <p className={styles.errorText}>{generatingError}</p>
      ) : null}

      <Button
        onClick={() => void handleGenerate()}
        loading={generating}
      >
        <KeyRound size={16} />
        生成恢复码
      </Button>
    </div>
  );

  const renderDisplayStep = () => (
    <div>
      <h3 className={styles.sectionTitle}>
        您的备用恢复码恢复码
      </h3>

      <div className={`${styles.warningBox} ${styles.mb4}`}>
        <AlertTriangle size={16} />
        <div>
          <p className={styles.warningBoxTitle}>这枚恢复码只显示一次。</p>
          <p className={styles.warningBoxSub}>
            请抄写或打印后离线保存，不要放入云端。
          </p>
        </div>
      </div>

      <div className={styles.codeDisplay}>
        <span className={styles.codeRail} aria-hidden="true" />
        <span className={styles.codeText}>{recoveryCode ?? ""}</span>
        <button
          type="button"
          className={styles.btnCopy}
          onClick={() => void handleCopy()}
          aria-label="复制恢复码"
          title="复制恢复码"
        >
          {copied ? <Check size={16} className={styles.iconSuccess} /> : <Copy size={16} />}
        </button>
      </div>

      {copied ? (
        <p className={styles.copiedMessage}>
          已复制到剪贴板
        </p>
      ) : null}

      <div className={`${styles.warningBanner} ${styles.mt4}`}>
        <p>
          Obscura 无法通过邮箱或客服重置主密码。如果主密码与备用恢复码同时丢失，密码库数据将无法恢复。
        </p>
      </div>
    </div>
  );

  const renderConfirmStep = () => (
    <div>
      <h3 className={styles.sectionTitle}>
        回读确认
      </h3>
      <p className={`${styles.sectionSubtitle} ${styles.sectionSubtitleTight}`}>
        请输入完整恢复码，确认这枚离线记录已经被您安全保存。
      </p>

      <div className={styles.inputGroup}>
        <label className={styles.inputLabel}>
          回读备用恢复码
        </label>
        <input
          type="text"
          className={styles.input}
          value={verificationInput}
          onChange={(e) => setVerificationInput(e.target.value)}
          placeholder="粘贴或输入完整恢复码"
          autoComplete="off"
          spellCheck={false}
        />
        {verificationInput.length > 0 && !isVerificationValid ? (
          <p className={styles.validationError}>
            恢复码不匹配，请检查后重新输入。
          </p>
        ) : null}
        {isVerificationValid ? (
          <p className={styles.validationSuccess}>
            离线恢复码验证通过
          </p>
        ) : null}
      </div>

      <label className={styles.confirmLabel}>
        <input
          type="checkbox"
          className={styles.confirmCheckbox}
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        我已将备用恢复码恢复码离线保存
      </label>
    </div>
  );

  return (
    <div className={styles.overlay} role="dialog" aria-label="离线恢复记录设置" onClick={onCancel}>
      <div
        ref={modalRef}
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerMark} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h2 className={styles.headerTitle}>
            离线恢复记录
          </h2>
          <Button
            variant="ghost"
            className={styles.closeButton ?? ""}
            onClick={onCancel}
            aria-label="关闭"
          >
            <X size={18} />
          </Button>
        </div>

        {/* Step indicator */}
        <div className={styles.stepsContainer}>
          {STEPS.map((label, i) => (
            <div key={label} className={styles.stepItem}>
              <div
                className={`${styles.stepDot} ${
                  i < step
                    ? styles.stepDotCompleted
                    : i === step
                      ? styles.stepDotActive
                      : ""
                }`}
              >
                {i < step ? <Check size={14} /> : i + 1}
              </div>
              <span
                className={`${styles.stepLabel} ${i === step ? styles.stepLabelActive : ""}`}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className={styles.content}>{renderStepContent()}</div>

        {/* Navigation */}
        <div className={styles.footer}>
          <div>
            {step > 0 ? (
              <Button variant="secondary" onClick={() => setStep(step - 1)}>
                上一步
              </Button>
            ) : (
              <Button variant="ghost" onClick={onCancel}>
                取消
              </Button>
            )}
          </div>
          <div>
            {step < STEPS.length - 1 ? (
              <Button
                onClick={handleNext}
                disabled={step === 1}
              >
                {step === 0 ? "开始生成" : "下一步"}
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                disabled={!confirmed || !isVerificationValid}
              >
                <Check size={16} />
                完成
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
