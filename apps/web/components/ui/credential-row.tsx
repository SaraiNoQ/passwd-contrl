"use client";

import type { ReactNode } from "react";
import { Copy, Edit3, Trash2 } from "lucide-react";
import type { BadgeVariant } from "./badge";
import { Badge } from "./badge";
import { cn } from "../../lib/utils";
import styles from "./credential-row.module.css";

export interface CredentialRowBadge {
  variant: BadgeVariant;
  label: string;
}

export interface CredentialRowProps {
  /** Display name for the credential. */
  name: string;
  /** Origin URL or application identifier. Shown as secondary text. */
  origin: string;
  /** Username associated with the credential. */
  username: string;
  /** Optional badges to display (risk, sync status, etc.). */
  badges?: CredentialRowBadge[];
  /** Called when user clicks the row. */
  onClick?: () => void;
  /** Called when user clicks the copy username button. */
  onCopyUsername?: () => void;
  /** Called when user clicks the copy password button. */
  onCopyPassword?: () => void;
  /** Called when user clicks the edit button. */
  onEdit?: () => void;
  /** Called when user clicks the delete button. */
  onDelete?: () => void;
  className?: string;
  children?: ReactNode;
}

export function CredentialRow({
  name,
  origin,
  username,
  badges,
  onClick,
  onCopyUsername,
  onCopyPassword,
  onEdit,
  onDelete,
  className,
  children,
}: CredentialRowProps) {
  const rowLabel = origin ? `${name}，${origin}` : name;

  return (
    <div className={cn(styles.row, onClick && styles.clickable, className)}>
      {onClick && (
        <button
          type="button"
          className={styles.rowTrigger}
          onClick={onClick}
          aria-label={`打开凭据：${rowLabel}`}
        />
      )}

      <div className={styles.info}>
        <div className={styles.name}>{name}</div>
        <div className={styles.origin}>{origin}</div>
      </div>

      <div className={styles.meta}>
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>用户</span>
          <span className={styles.metaValue}>{username}</span>
        </div>
        <div className={styles.metaRow}>
          <span className={styles.metaLabel}>密码</span>
          <span className={cn(styles.metaValue, styles.password)}>
            {"••••••••"}
          </span>
        </div>
        {badges && badges.length > 0 && (
          <div className={styles.badges}>
            {badges.map((b) => (
              <Badge key={b.variant} variant={b.variant}>
                {b.label}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className={styles.actions}>
        {onCopyUsername && (
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => {
              onCopyUsername();
            }}
            aria-label="复制用户名"
          >
            <Copy size={14} aria-hidden="true" />
          </button>
        )}
        {onCopyPassword && (
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => {
              onCopyPassword();
            }}
            aria-label="复制密码"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => {
              onEdit();
            }}
            aria-label="编辑"
          >
            <Edit3 size={14} aria-hidden="true" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className={cn(styles.actionBtn, styles.danger)}
            onClick={() => {
              onDelete();
            }}
            aria-label="删除"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
