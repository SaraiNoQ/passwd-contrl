"use client";

import { Check, Copy, KeyRound, Printer, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import styles from "./recovery-setup.module.css";
import { printRecoveryCode } from "./recovery-print";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const STEPS = [
  { label: "生成", number: 1 },
  { label: "离线保存", number: 2 },
  { label: "回读", number: 3 },
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
  const [copyError, setCopyError] = useState(false);
  const workbenchRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    workbenchRef.current?.focus({ preventScroll: true });
  }, [currentStep]);

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

  const handlePrint = useCallback(() => {
    if (!recoveryCode) return;
    printRecoveryCode(recoveryCode);
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
    <div className={styles.stepIndicator} role="list" aria-label="恢复码保存流程">
      {STEPS.map((step, i) => (
        <div key={step.label} className={styles.stepItem} role="listitem">
          <div
            className={`${styles.stepCircle} ${
              i < currentStep
                ? styles.completed
                : i === currentStep
                  ? styles.active
                  : ""
            }`}
            aria-current={i === currentStep ? "step" : undefined}
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
        生成一枚备用恢复码恢复码，用于主密码遗失时解封密码库。恢复码不会上传到服务器。
      </p>
      <div className={styles.warning}>
        <ShieldAlert size={14} />
        <span>备用恢复码只属于本机恢复记录，丢失后无法通过客服找回</span>
      </div>
    </div>
  );

  const renderSaveStep = () => (
    <div className={styles.stepContent}>
      <p className={styles.description}>
        请将备用恢复码恢复码保存在安全的离线位置。此恢复码不会再次显示。
      </p>
      <div className={styles.warning}>
        <ShieldAlert size={14} />
        <span>请立即抄写或打印恢复码，关闭后将无法再次查看</span>
      </div>
      <div className={styles.codeDisplay}>
        <span className={styles.codeRail} aria-hidden="true" />
        <code className={styles.code}>{recoveryCode}</code>
        <div className={styles.codeActions}>
          <div className={styles.codeActionGroup}>
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
        请输入备用恢复码恢复码的最后 8 个字符，确认离线记录已经被您保存。
      </p>
      <div className={styles.verifySection}>
        <label className={styles.verifyLabel} htmlFor="recovery-verify">
          备用恢复码末尾 8 位
        </label>
        <Input
          id="recovery-verify"
          type="text"
          value={verificationInput}
          onChange={(e) => setVerificationInput(e.target.value)}
          placeholder="回读最后 8 个字符"
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
            onClick={() => setCurrentStep(0)}
          >
            返回
          </Button>
          <Button
            variant="primary"
            onClick={() => setCurrentStep(2)}
          >
            下一步
          </Button>
        </div>
      );
    }

    // currentStep === 2
    if (!onConfirmSave) {
      return (
        <div className={styles.stepActions}>
          <Button
            variant="ghost"
            onClick={() => setCurrentStep(1)}
          >
            返回
          </Button>
          <span className={styles.localComplete} role="status">
            {isVerificationValid ? "回读已完成" : "等待回读验证"}
          </span>
        </div>
      );
    }

    return (
      <div className={styles.stepActions}>
        <Button
          variant="ghost"
          onClick={() => setCurrentStep(1)}
        >
          返回
        </Button>
        <Button
          variant="primary"
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
    <div className={styles.panel}>
      <span className={styles.pixelCloudA} aria-hidden="true" />
      <span className={styles.pixelCloudB} aria-hidden="true" />
      <div className={styles.header}>
        <div className={styles.headerCopy}>
          <span className={styles.kicker}>RECOVERY BACKUP</span>
          <h3 className={styles.title}>离线恢复记录</h3>
          <p className={styles.lead}>
            把一枚恢复码保存到纸面或离线位置。它不上传、不托管，只在你确认回读后完成封存。
          </p>
        </div>
        <div className={styles.statusCard} aria-label="恢复码状态">
          <span className={styles.statusIcon} aria-hidden="true">
            <KeyRound size={18} />
          </span>
          <span>
            <small>当前节点</small>
            <strong>{STEPS[currentStep]?.label ?? "等待"}</strong>
          </span>
        </div>
      </div>
      <div className={styles.recoveryGrid}>
        <aside className={styles.timeline} aria-label="恢复码流程">
          {renderStepIndicator()}
          <div className={styles.timelineNote}>
            <ShieldAlert size={14} />
            离线保存完成前，不要关闭此页面。
          </div>
        </aside>
        <section className={styles.workbench} aria-live="polite" tabIndex={-1} ref={workbenchRef}>
          {renderStepContent()}
          {renderActions()}
        </section>
      </div>
    </div>
  );
}
