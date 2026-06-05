"use client";

import { AlertTriangle, Check, Copy, KeyRound, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  generateRecoveryCode,
  createRecoveryPacket,
  type RecoveryPacket
} from "../../lib/recovery";
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

const STEPS = ["说明", "生成", "展示", "确认"] as const;

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
      <div className={styles.centerContent} style={{ marginBottom: 20 }}>
        <div className={styles.iconCircle}>
          <KeyRound size={24} className={styles.iconPrimary} />
        </div>
        <h3 className={styles.sectionTitle}>
          恢复码设置
        </h3>
      </div>

      <div className={styles.infoBox}>
        <p>
          恢复码用于在忘记主密码时恢复密码库。恢复码不会上传到服务器。
        </p>
      </div>

      <div className={`${styles.explanationText} ${styles.mt4}`}>
        <p>工作原理：</p>
        <ol>
          <li>系统生成一个随机恢复码</li>
          <li>恢复码被用于加密您的密码库密钥</li>
          <li>加密后的恢复包保存在本地</li>
          <li>需要恢复时，输入恢复码即可解密密码库密钥</li>
        </ol>
      </div>

      <div className={`${styles.warningBox} ${styles.mt4}`}>
        <ShieldAlert size={16} />
        <div>
          <p className={styles.warningBoxTitle}>恢复码不会上传到服务器</p>
          <p className={styles.warningBoxSub}>
            丢失后无法通过客服找回。
          </p>
        </div>
      </div>
    </div>
  );

  const renderGenerateStep = () => (
    <div className={styles.centerContent}>
      <h3 className={styles.sectionTitle}>
        生成恢复码
      </h3>
      <p className={styles.sectionSubtitle}>
        点击下方按钮生成您的恢复码。
      </p>

      {generatingError ? (
        <p className={styles.errorText}>{generatingError}</p>
      ) : null}

      <button
        type="button"
        className={styles.btnPrimary}
        onClick={() => void handleGenerate()}
        disabled={generating}
      >
        <KeyRound size={16} />
        {generating ? "生成中..." : "生成恢复码"}
      </button>
    </div>
  );

  const renderDisplayStep = () => (
    <div>
      <h3 className={styles.sectionTitle}>
        您的恢复码
      </h3>

      <div className={`${styles.warningBox} ${styles.mb4}`}>
        <AlertTriangle size={16} />
        <div>
          <p className={styles.warningBoxTitle}>恢复码只显示一次。</p>
          <p className={styles.warningBoxSub}>
            请将恢复码写在纸上并离线保存。
          </p>
        </div>
      </div>

      <div className={styles.codeDisplay}>
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
          Obscura 无法通过邮箱或客服重置主密码。如果丢失恢复码和主密码，密码库数据将无法恢复。
        </p>
      </div>
    </div>
  );

  const renderConfirmStep = () => (
    <div>
      <h3 className={styles.sectionTitle}>
        确认保存
      </h3>
      <p className={styles.sectionSubtitle} style={{ marginBottom: 16 }}>
        请输入您的恢复码以确认已安全保存。
      </p>

      <div className={styles.inputGroup}>
        <label className={styles.inputLabel}>
          输入恢复码
        </label>
        <input
          type="text"
          className={styles.input}
          value={verificationInput}
          onChange={(e) => setVerificationInput(e.target.value)}
          placeholder="粘贴您的恢复码"
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
            恢复码验证通过
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
        我已安全保存恢复码
      </label>
    </div>
  );

  return (
    <div className={styles.overlay} role="dialog" aria-label="恢复码设置" onClick={onCancel}>
      <div
        ref={modalRef}
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>
            恢复码
          </h2>
          <button type="button" className={styles.btnGhost} onClick={onCancel} aria-label="关闭">
            <X size={18} />
          </button>
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
              <button type="button" className={styles.btnSecondary} onClick={() => setStep(step - 1)}>
                上一步
              </button>
            ) : (
              <button type="button" className={styles.btnGhost} onClick={onCancel}>
                取消
              </button>
            )}
          </div>
          <div>
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleNext}
                disabled={step === 1}
              >
                {step === 0 ? "开始生成" : "下一步"}
              </button>
            ) : (
              <button
                type="button"
                className={styles.btnDanger}
                onClick={handleComplete}
                disabled={!confirmed || !isVerificationValid}
              >
                <Check size={16} />
                完成
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
