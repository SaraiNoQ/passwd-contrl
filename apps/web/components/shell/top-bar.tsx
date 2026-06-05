"use client";

import { Clock, Menu, Moon, RefreshCw, Search, Sun, X } from "lucide-react";
import { useMemo } from "react";
import styles from "./top-bar.module.css";
import { useTheme } from "../../hooks/useTheme";

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
  const { theme, toggleTheme } = useTheme();
  const autoLockDisplay = useMemo(
    () => formatAutoLockTime(autoLockRemaining),
    [autoLockRemaining],
  );

  const badgeClass = useMemo(
    () => syncStatusBadgeClass(syncStatus),
    [syncStatus],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
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

        <div className={styles.search}>
          <Search size={16} />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="搜索凭据..."
          />
          {searchQuery ? (
            <button
              className="btn-icon"
              type="button"
              onClick={() => onSearchQueryChange("")}
              style={{ minHeight: 28, minWidth: 28 }}
              aria-label="清除搜索"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
        <div className={styles.right}>
          <button
            className="theme-toggle"
            type="button"
            onClick={toggleTheme}
            title={theme === "light" ? "切换到暗色模式" : "切换到亮色模式"}
            aria-label={theme === "light" ? "切换到暗色模式" : "切换到亮色模式"}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <span className={`${styles.badge} ${badgeClass}`}>
            <RefreshCw size={12} />
            {syncStatus}
          </span>
          <span className={styles.badge}>
            <Clock size={12} />
            {"自动锁定"} {autoLockDisplay}
          </span>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onSyncNow}
            disabled={loading}
          >
            <RefreshCw size={14} />
            {loading ? "同步中..." : "同步"}
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
            style={{ animation: "spin 1s linear infinite" }}
            aria-hidden="true"
          />
          {statusMessage}
        </div>
      ) : null}
    </div>
  );
}
