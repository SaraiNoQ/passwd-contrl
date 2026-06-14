"use client";

import { Clock, RefreshCw, Search } from "lucide-react";
import { useMemo, type RefObject } from "react";
import styles from "./top-bar.module.css";

export interface TopBarProps {
  /** Current search query value */
  searchQuery: string;
  /** Callback when search input changes */
  onSearchChange: (query: string) => void;
  /** Human-readable sync status text */
  syncStatus?: string;
  /** Callback when sync button is clicked */
  onSync?: () => void;
  /** Auto-lock countdown in minutes (0 = disabled) */
  autoLockMinutes?: number;
  /** Optional ref for global shortcuts. */
  searchInputRef?: RefObject<HTMLInputElement | null>;
}

function formatAutoLockTime(minutes: number): string {
  if (minutes <= 0) return "已禁用";
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function syncStatusBadgeClass(syncStatus: string | undefined): string {
  if (!syncStatus) return "";
  if (syncStatus.includes("已同步")) return styles.badgeSuccess ?? "";
  if (syncStatus.includes("冲突")) return styles.badgeWarning ?? "";
  if (syncStatus.includes("失败")) return styles.badgeDanger ?? "";
  return "";
}

import { memo } from "react";

export const TopBar = memo(function TopBar({
  searchQuery,
  onSearchChange,
  syncStatus,
  onSync,
  autoLockMinutes,
  searchInputRef,
}: TopBarProps) {
  const autoLockDisplay = useMemo(
    () => formatAutoLockTime(autoLockMinutes ?? 0),
    [autoLockMinutes],
  );

  const badgeClass = useMemo(
    () => syncStatusBadgeClass(syncStatus),
    [syncStatus],
  );

  return (
    <div className={styles.topBar}>
      <div className={styles.search}>
        <Search size={16} />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索密文凭据、节点标签..."
          aria-label="搜索凭据"
        />
        <span className={styles.kbdHint} aria-hidden="true">
          Cmd K
        </span>
      </div>

      <div className={styles.right}>
        {syncStatus ? (
          <span className={`${styles.badge} ${badgeClass}`}>
            <span className={styles.badgePulse} aria-hidden="true" />
            <RefreshCw size={12} />
            {syncStatus}
          </span>
        ) : null}

        {autoLockMinutes !== undefined && autoLockMinutes > 0 ? (
          <span className={styles.autoLockBadge}>
            <Clock size={12} />
            自动封存 {autoLockDisplay}
          </span>
        ) : null}

        {onSync ? (
          <button
            className={styles.syncButton}
            type="button"
            onClick={onSync}
          >
            <RefreshCw size={14} />
            写入回执
          </button>
        ) : null}
      </div>
    </div>
  );
});
