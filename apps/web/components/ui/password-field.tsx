"use client";

import { useCallback, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";
import styles from "./password-field.module.css";

export interface PasswordFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> {
  label?: ReactNode;
  error?: string;
  /** Called when user clicks the generate button. If omitted, the button is hidden. */
  onGenerate?: () => void;
  /** Called when user clicks the copy button. If omitted, the button is hidden. */
  onCopy?: () => void;
  className?: string;
}

export function PasswordField({
  label,
  error,
  onGenerate,
  onCopy,
  className,
  id,
  value,
  disabled,
  ...rest
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const fieldId = id ?? (typeof label === "string" ? label.replace(/\s+/g, "-").toLowerCase() : undefined);

  const toggleReveal = useCallback(() => {
    setRevealed((prev) => !prev);
  }, []);

  return (
    <div className={cn(styles.wrapper, className)}>
      {label && (
        <label className={styles.label} htmlFor={fieldId}>
          {label}
        </label>
      )}
      <div className={styles.field}>
        <input
          id={fieldId}
          className={styles.input}
          type={revealed ? "text" : "password"}
          autoComplete="new-password"
          aria-invalid={error ? true : undefined}
          aria-describedby={error && fieldId ? `${fieldId}-error` : undefined}
          value={value}
          disabled={disabled}
          {...rest}
        />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={toggleReveal}
            aria-label={revealed ? "隐藏密码" : "显示密码"}
            aria-pressed={revealed}
            disabled={disabled}
          >
            {revealed ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
          {onCopy && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onCopy}
              aria-label="复制密码"
              disabled={disabled}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          )}
          {onGenerate && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onGenerate}
              aria-label="生成密码"
              disabled={disabled}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {error && (
        <span className={styles.error} id={fieldId ? `${fieldId}-error` : undefined} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
