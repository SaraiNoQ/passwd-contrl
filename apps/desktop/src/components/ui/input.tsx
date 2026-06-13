"use client";

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import styles from "./input.module.css";

interface BaseInputProps {
  label?: string;
  error?: string;
  className?: string;
}

export interface TextInputProps
  extends BaseInputProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> {
  type?: "text" | "password" | "url" | "search";
}

export interface TextareaProps
  extends BaseInputProps,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  type: "textarea";
}

export type InputProps = TextInputProps | TextareaProps;

export function Input(props: InputProps) {
  const { label, error, className, id, ...rest } = props;
  const fieldId = id ?? (label ? label.replace(/\s+/g, "-").toLowerCase() : undefined);

  return (
    <div className={cn(styles.wrapper, className)}>
      {label && (
        <label className={styles.label} htmlFor={fieldId}>
          {label}
        </label>
      )}
      {props.type === "textarea" ? (
        <textarea
          id={fieldId}
          className={cn(styles.input, styles.textarea, error && styles.error)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error && fieldId ? `${fieldId}-error` : undefined}
          {...(rest as Omit<TextareaProps, "type" | "label" | "error" | "className">)}
        />
      ) : (
        <input
          id={fieldId}
          className={cn(styles.input, error && styles.error)}
          type={props.type ?? "text"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error && fieldId ? `${fieldId}-error` : undefined}
          {...(rest as Omit<TextInputProps, "type" | "label" | "error" | "className">)}
        />
      )}
      {error && (
        <span className={styles.errorMessage} id={fieldId ? `${fieldId}-error` : undefined} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
