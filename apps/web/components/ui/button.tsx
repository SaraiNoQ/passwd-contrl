"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";
import styles from "./button.module.css";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  children: ReactNode;
  className?: string;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  children,
  className,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      // eslint-disable-next-line react/button-has-type -- type is passed via prop with default
      type={type}
      className={cn(
        styles.base,
        styles[variant],
        size === "sm" && styles.sm,
        loading && styles.loading,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
      {loading && (
        <svg
          className={styles.spinner}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="31.4 31.4"
          />
        </svg>
      )}
    </button>
  );
}
