"use client";

import { Clock, Menu, RefreshCw, Search, X, Zap } from "lucide-react";
import { useMemo } from "react";
import styles from "./top-bar.module.css";

type TopBarProps = {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  syncStatus: string;
  autoLockRemaining: number;
  onSyncNow: () => void;
  loading: boolean;
  statusMessage?: string;
  onMenuToggle?: () => void;
};

function formatAutoLockTime(remainingMs: number): string {
  const seconds = Math.ceil(remainingMs / 1000);
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function syncStatusBadgeClass(syncStatus: string): string {
  if (syncStatus.includes("已同步")) return styles.badgeSuccess ?? "";
  if (syncStatus.includes("冲突")) return styles.badgeWarning ?? "";
  if (syncStatus.includes("失败")) return styles.badgeDanger ?? "";
  return "";
}

export default function TopBar({
  searchQuery,
  onSearchQueryChange,
  syncStatus,
  autoLockRemaining,
  onSyncNow,
  loading,
  statusMessage,
  onMenuToggle,
}: TopBarProps) {
  const autoLockDisplay = useMemo(
    () => formatAutoLockTime(autoLockRemaining),
    [autoLockRemaining],
  );

  const badgeClass = useMemo(
    () => syncStatusBadgeClass(syncStatus),
    [syncStatus],
  );

  return (
    <div className={styles.shell}>
      <div className={styles.topBar}>
        {/* Hamburger menu button */}
        {onMenuToggle && (
          <button
            className={styles.menuButton}
            type="button"
            onClick={onMenuToggle}
            aria-label="打开菜单"
          >
            <Menu size={20} />
          </button>
        )}

        <div className={styles.sessionMark} aria-hidden="true">
          <Zap size={13} />
          同步中继在线
        </div>

        <div className={styles.search}>
          <Search size={16} />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="搜索密文凭据、节点标签..."
            aria-label="搜索凭据"
          />
          {searchQuery ? (
            <button
              className={styles.clearSearchButton}
              type="button"
              onClick={() => onSearchQueryChange("")}
              aria-label="清除搜索"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
        <div className={styles.right}>
          <span className={`${styles.badge} ${badgeClass}`}>
            <span className={styles.badgePulse} aria-hidden="true" />
            <RefreshCw size={12} />
            {syncStatus}
          </span>
          <span className={styles.badge}>
            <span className={styles.badgePulse} aria-hidden="true" />
            <Clock size={12} />
            自动封存 {autoLockDisplay}
          </span>
          <button
            className={styles.syncButton}
            type="button"
            onClick={onSyncNow}
            disabled={loading}
          >
            <RefreshCw size={14} />
            <span className={styles.syncButtonLabel}>
              {loading ? "写入中..." : "写入回执"}
            </span>
          </button>
        </div>
      </div>
      {/* Loading status message */}
      {loading && statusMessage ? (
        <div
          className={styles.loadingBanner}
          role="status"
          aria-live="polite"
        >
          <RefreshCw
            size={14}
            className={styles.loadingSpinner}
            aria-hidden="true"
          />
          {statusMessage}
        </div>
      ) : null}
    </div>
  );
}
