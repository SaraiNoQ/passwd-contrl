"use client";

import { useCallback, useEffect, useRef } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import styles from "./toast.module.css";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastProps {
  variant: ToastVariant;
  message: string;
  /** Auto-dismiss after this many ms. Defaults to 4000. Set to 0 to disable. */
  duration?: number;
  onDismiss?: () => void;
  className?: string;
}

const variantIcons: Record<ToastVariant, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

export function Toast({
  variant,
  message,
  duration = 4000,
  onDismiss,
  className,
}: ToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (duration > 0 && onDismiss) {
      timerRef.current = setTimeout(onDismiss, duration);
      return clearTimer;
    }
    return clearTimer;
  }, [duration, onDismiss, clearTimer]);

  const Icon = variantIcons[variant];

  return (
    <div
      className={cn(styles.container, styles[variant], className)}
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <span className={styles.message}>{message}</span>
      {onDismiss && (
        <button
          type="button"
          className={styles.dismiss}
          onClick={onDismiss}
          aria-label="关闭通知"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
