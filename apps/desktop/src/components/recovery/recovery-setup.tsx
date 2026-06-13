"use client";

import { Check, Copy, KeyRound, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DesktopCryptoAdapter } from "../../lib/crypto/desktop-crypto-adapter";
import { Modal } from "../ui/modal";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import styles from "./recovery-setup.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecoverySetupProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (encryptedPacket: string) => void;
  cryptoAdapter: DesktopCryptoAdapter;
}

const STEPS = [
  { label: "生成恢复码", number: 1 },
  { label: "备份提示", number: 2 },
  { label: "验证", number: 3 },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecoverySetup({
  isOpen,
  onClose,
  onComplete,
  cryptoAdapter,
}: RecoverySetupProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [verificationInput, setVerificationInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
      setRecoveryCode(null);
      setVerificationInput("");
      setCopied(false);
      setCopyError(false);
      setGenerating(false);
    }
  }, [isOpen]);

  // Reset verification when entering confirm step
  useEffect(() => {
    if (currentStep === 2) {
      setVerificationInput("");
    }
  }, [currentStep]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const code = await cryptoAdapter.generateRecoveryCode();
      setRecoveryCode(code);
      setCurrentStep(1);
    } catch {
      // Generation failed — stay on step 0
    } finally {
      setGenerating(false);
    }
  }, [cryptoAdapter]);

  const handleCopy = useCallback(async () => {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }, [recoveryCode]);

  // Verification: user must enter the last 8 characters
  const expectedFragment = recoveryCode ? recoveryCode.slice(-8) : "";
  const isVerificationValid =
    verificationInput.trim().length === 8 &&
    verificationInput.trim() === expectedFragment;

  const handleComplete = useCallback(() => {
    // Signal completion — the parent is responsible for creating the
    // recovery packet with the vault key.  We pass the code back
    // via onComplete so the parent can call createRecoveryPacket.
    if (recoveryCode) {
      onComplete(recoveryCode);
    }
  }, [recoveryCode, onComplete]);

  const handleModalClose = useCallback(() => {
    setCurrentStep(0);
    setRecoveryCode(null);
    setVerificationInput("");
    onClose();
  }, [onClose]);

  // Step renderers

  const renderGenerateStep = () => (
    <div className={styles.stepContent}>
      <p className={styles.description}>
        生成一枚恢复码，用于主密码遗失时解封密码库。恢复码不会上传到服务器。
      </p>
      <div className={styles.warning}>
        <ShieldAlert size={14} />
        <span>恢复码只属于本地，丢失后无法通过客服找回</span>
      </div>
    </div>
  );

  const renderSaveStep = () => (
    <div className={styles.stepContent}>
      <p className={styles.description}>
        请将恢复码保存在安全的离线位置。此恢复码不会再次显示。
      </p>
      <div className={styles.warning}>
        <ShieldAlert size={14} />
        <span>请立即抄写或保存恢复码，关闭后将无法再次查看</span>
      </div>
      <div className={styles.codeDisplay}>
        <span className={styles.codeRail} aria-hidden="true" />
        <code className={styles.code}>{recoveryCode}</code>
        <div className={styles.codeActions}>
          <button
            type="button"
            className={styles.codeActionBtn}
            onClick={() => void handleCopy()}
            title="复制恢复码"
            aria-label={copied ? "恢复码已复制" : "复制恢复码"}
          >
            {copied ? (
              <Check size={14} className={styles.successIcon} />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>
      </div>
      {copied && (
        <p className={styles.copiedNotice} role="status">
          已复制到剪贴板
        </p>
      )}
      {copyError && (
        <p className={styles.verifyError} role="alert">
          复制失败，请手动选中恢复码保存
        </p>
      )}
    </div>
  );

  const renderConfirmStep = () => (
    <div className={styles.stepContent}>
      <p className={styles.description}>
        请输入恢复码的最后 8 个字符，确认已保存。
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
            <p className={styles.verifyHint}>请输入完整的 8 个字符</p>
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

  // Actions

  const renderActions = () => {
    if (currentStep === 0) {
      return (
        <div className={styles.stepActions}>
          <Button
            variant="primary"
            loading={generating}
            onClick={() => void handleGenerate()}
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
          <Button variant="ghost" onClick={() => setCurrentStep(0)}>
            返回
          </Button>
          <Button variant="primary" onClick={() => setCurrentStep(2)}>
            下一步
          </Button>
        </div>
      );
    }

    // currentStep === 2
    return (
      <div className={styles.stepActions}>
        <Button variant="ghost" onClick={() => setCurrentStep(1)}>
          返回
        </Button>
        <Button
          variant="primary"
          disabled={!isVerificationValid}
          onClick={handleComplete}
        >
          <Check size={16} />
          确认保存
        </Button>
      </div>
    );
  };

  return (
    <Modal
      open={isOpen}
      onClose={handleModalClose}
      title="设置恢复码"
      destructive
      {...(styles.setupModal ? { className: styles.setupModal } : {})}
    >
      {/* Step indicator */}
      <div className={styles.stepIndicator} role="list" aria-label="恢复码设置流程">
        {STEPS.map((step, i) => (
          <div key={step.label} className={styles.stepItem} role="listitem">
            <div
              className={cn(
                styles.stepCircle,
                i < currentStep && styles.completed,
                i === currentStep && styles.active,
              )}
              aria-current={i === currentStep ? "step" : undefined}
            >
              {i < currentStep ? <Check size={14} /> : step.number}
            </div>
            <span
              className={cn(
                styles.stepLabel,
                i === currentStep && styles.activeLabel,
                i < currentStep && styles.completedLabel,
              )}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  styles.stepConnector,
                  i < currentStep && styles.connectorCompleted,
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className={styles.workbench} aria-live="polite">
        {renderStepContent()}
        {renderActions()}
      </div>
    </Modal>
  );
}
