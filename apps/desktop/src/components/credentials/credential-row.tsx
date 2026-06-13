"use client";

import { Copy, Globe, KeyRound, FileText, CreditCard } from "lucide-react";
import type { VaultItem, VaultLogin } from "@zero-vault/shared";
import { cn } from "../../lib/utils";
import styles from "./credential-row.module.css";

export interface CredentialRowProps {
  item: VaultItem;
  onClick?: () => void;
  onCopyUsername?: () => void;
  onCopyPassword?: () => void;
  className?: string;
}

const TYPE_ICONS: Record<string, typeof KeyRound> = {
  login: Globe,
  secure_note: FileText,
  credit_card: CreditCard,
};

const TYPE_LABELS: Record<string, string> = {
  login: "登录",
  secure_note: "安全笔记",
  credit_card: "信用卡",
};

function isLogin(item: VaultItem): item is VaultLogin {
  return item.type === "login";
}

function truncateOrigin(origin: string, maxLen = 40): string {
  if (!origin) return "";
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (host.length <= maxLen) return host;
    return host.slice(0, maxLen - 1) + "…";
  } catch {
    if (origin.length <= maxLen) return origin;
    return origin.slice(0, maxLen - 1) + "…";
  }
}

import { memo } from "react";

export const CredentialRow = memo(function CredentialRow({
  item,
  onClick,
  onCopyUsername,
  onCopyPassword,
  className,
}: CredentialRowProps) {
  const Icon = TYPE_ICONS[item.type] ?? KeyRound;
  const typeLabel = TYPE_LABELS[item.type] ?? item.type;
  const login = isLogin(item) ? item : null;

  return (
    <div
      className={cn(styles.row, onClick && styles.clickable, className)}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-label={login ? `${item.title}，${login.origin}` : item.title}
    >
      <div className={styles.iconCol}>
        <span className={styles.typeIcon}>
          <Icon size={18} />
        </span>
      </div>

      <div className={styles.info}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{item.title}</span>
          <span className={styles.typeBadge}>{typeLabel}</span>
        </div>
        {login && (
          <div className={styles.meta}>
            <span className={styles.origin}>{truncateOrigin(login.origin)}</span>
            {login.username && (
              <>
                <span className={styles.separator} aria-hidden="true">&middot;</span>
                <span className={styles.username}>{login.username}</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
        {login?.username && onCopyUsername && (
          <button
            type="button"
            className={styles.actionBtn}
            onClick={onCopyUsername}
            aria-label={`复制 ${item.title} 的用户名`}
            title="复制用户名"
          >
            <Copy size={14} />
          </button>
        )}
        {login?.password && onCopyPassword && (
          <button
            type="button"
            className={styles.actionBtn}
            onClick={onCopyPassword}
            aria-label={`复制 ${item.title} 的密码`}
            title="复制密码"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});
