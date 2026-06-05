"use client";

import { Check, Copy, KeyRound, Printer, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import styles from "./recovery-setup.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const STEPS = [
  { label: "生成", number: 1 },
  { label: "保存", number: 2 },
  { label: "确认", number: 3 },
] as const;

export interface RecoverySetupProps {
  loading: boolean;
  onGenerateRecoveryCode: () => void;
  /** When provided, the component advances to the save step. */
  recoveryCode?: string | null;
  /** Called when the user confirms they saved the recovery code. */
  onConfirmSave?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecoverySetup({
  loading,
  onGenerateRecoveryCode,
  recoveryCode,
  onConfirmSave,
}: RecoverySetupProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [verificationInput, setVerificationInput] = useState("");
  const [copied, setCopied] = useState(false);

  // Auto-advance to save step when recovery code becomes available
  useEffect(() => {
    if (recoveryCode && currentStep === 0) {
      setCurrentStep(1);
    }
  }, [recoveryCode, currentStep]);

  // Reset verification when entering confirm step
  useEffect(() => {
    if (currentStep === 2) {
      setVerificationInput("");
    }
  }, [currentStep]);

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

  const handlePrint = useCallback(() => {
    if (!recoveryCode) return;
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

  // Verification: user must enter the last 8 characters
  const expectedFragment = recoveryCode ? recoveryCode.slice(-8) : "";
  const isVerificationValid =
    verificationInput.trim().length === 8 &&
    verificationInput.trim() === expectedFragment;

  // ---------------------------------------------------------------------------
  // Step renderers
  // ---------------------------------------------------------------------------

  const renderStepIndicator = () => (
    <div className={styles.stepIndicator}>
      {STEPS.map((step, i) => (
        <div key={step.label} className={styles.stepItem}>
          <div
            className={`${styles.stepCircle} ${
              i < currentStep
                ? styles.completed
                : i === currentStep
                  ? styles.active
                  : ""
            }`}
          >
            {i < currentStep ? <Check size={14} /> : step.number}
          </div>
          <span
            className={`${styles.stepLabel} ${
              i === currentStep
                ? styles.activeLabel
                : i < currentStep
                  ? styles.completedLabel
                  : ""
            }`}
          >
            {step.label}
          </span>
          {i < STEPS.length - 1 && (
            <div
              className={`${styles.stepConnector} ${
                i < currentStep ? styles.connectorCompleted : ""
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );

  const renderGenerateStep = () => (
    <div className={styles.stepContent}>
      <p className={styles.description}>
        生成恢复码以在忘记主密码时恢复访问权限。恢复码不会上传到服务器，丢失后无法通过客服找回。
      </p>
      <div className={`${styles.warning} pixel-border`}>
        <ShieldAlert size={14} />
        <span>恢复码不会上传到服务器，丢失后无法通过客服找回</span>
      </div>
    </div>
  );

  const renderSaveStep = () => (
    <div className={styles.stepContent}>
      <p className={styles.description}>
        请将恢复码保存在安全的离线位置。此恢复码不会再次显示。
      </p>
      <div className={`${styles.warning} pixel-border`}>
        <ShieldAlert size={14} />
        <span>请立即保存恢复码，关闭后将无法再次查看</span>
      </div>
      <div className={`${styles.codeDisplay} pixel-border pixel-scanlines`}>
        <code className={styles.code}>{recoveryCode}</code>
        <div className={styles.codeActions}>
          <div className={styles.codeActionGroup}>
            <button
              type="button"
              className={styles.codeActionBtn}
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
              className={styles.codeActionBtn}
              onClick={handlePrint}
              title="打印恢复码"
              aria-label="打印恢复码"
            >
              <Printer size={14} />
            </button>
          </div>
        </div>
      </div>
      {copied && (
        <p
          style={{
            fontSize: "var(--text-caption-size)",
            color: "var(--color-success)",
            margin: "var(--space-1) 0",
          }}
        >
          已复制到剪贴板
        </p>
      )}
    </div>
  );

  const renderConfirmStep = () => (
    <div className={styles.stepContent}>
      <p className={styles.description}>
        请输入恢复码的最后 8 个字符以确认您已安全保存。
      </p>
      <div className={styles.verifySection}>
        <label className={styles.verifyLabel} htmlFor="recovery-verify">
          恢复码末尾 8 位
        </label>
        <Input
          id="recovery-verify"
          type="text"
          value={verificationInput}
          onChange={(e) => setVerificationInput(e.target.value)}
          placeholder="输入最后 8 个字符"
          autoComplete="off"
          spellCheck={false}
          maxLength={8}
          {...(verificationInput.length === 8 && !isVerificationValid
            ? { error: "字符不匹配，请检查恢复码后重新输入" }
            : {})}
        />
        {verificationInput.length > 0 &&
          verificationInput.length < 8 &&
          !isVerificationValid && (
            <p className={styles.verifyHint}>
              请输入完整的 8 个字符
            </p>
          )}
        {isVerificationValid && (
          <p className={styles.verifySuccess}>
            <Check size={14} />
            验证通过
          </p>
        )}
      </div>
    </div>
  );

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return renderGenerateStep();
      case 1:
        return renderSaveStep();
      case 2:
        return renderConfirmStep();
      default:
        return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const renderActions = () => {
    if (currentStep === 0) {
      return (
        <div className={styles.stepActions}>
          <Button
            variant="primary"
            size="sm"
            loading={loading}
            onClick={onGenerateRecoveryCode}
          >
            <KeyRound size={16} />
            生成恢复码
          </Button>
        </div>
      );
    }

    if (currentStep === 1) {
      return (
        <div className={styles.stepActions}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentStep(0)}
          >
            返回
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setCurrentStep(2)}
          >
            下一步
          </Button>
        </div>
      );
    }

    // currentStep === 2
    return (
      <div className={styles.stepActions}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentStep(1)}
        >
          返回
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!isVerificationValid}
          onClick={onConfirmSave}
        >
          <Check size={16} />
          确认保存
        </Button>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className={`${styles.panel} pixel-border pixel-scanlines`}>
      <div className={styles.header}>
        <svg width="20" height="22" viewBox="0 0 20 22" fill="none" aria-hidden="true">
          <rect x="6" y="0" width="8" height="6" rx="1" fill="var(--color-primary)" />
          <rect x="4" y="5" width="12" height="4" fill="var(--color-primary)" />
          <rect x="4" y="9" width="12" height="12" rx="1" fill="var(--color-primary)" />
          <rect x="7" y="12" width="6" height="6" fill="rgba(255,255,255,0.3)" />
          <rect x="9" y="14" width="2" height="3" fill="var(--color-primary)" />
        </svg>
        <KeyRound size={18} />
        <h3 className={styles.title}>恢复码</h3>
      </div>
      {renderStepIndicator()}
      {renderStepContent()}
      {renderActions()}
    </div>
  );
}
