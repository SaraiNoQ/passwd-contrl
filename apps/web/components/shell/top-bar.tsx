"use client";

import { Blocks, Clock, Menu, RefreshCw, Search, X, Zap } from "lucide-react";
import { useMemo } from "react";
import styles from "./top-bar.module.css";

type VaultStatus = {
  itemCount: number;
  updatedAt: string;
  syncStatus: string;
  lastSyncedAt: string | null;
};

type TopBarProps = {
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  syncStatus: string;
  autoLockRemaining: number;
  onSyncNow: () => void;
  loading: boolean;
  vaultStatus?: VaultStatus;
  statusMessage?: string;
  onMenuToggle?: () => void;
};

function formatAutoLockTime(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil((Number.isFinite(remainingMs) ? remainingMs : 0) / 1000));
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

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export default function TopBar({
  searchQuery,
  onSearchQueryChange,
  syncStatus,
  autoLockRemaining,
  onSyncNow,
  loading,
  vaultStatus,
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
          同步会话在线
        </div>

        <div className={styles.search}>
          <Search size={16} />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="搜索加密内容凭据、节点标签..."
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
          <div className={styles.zeroSeal} aria-label="本地加密会话已激活">
            <span className={styles.zeroSealIcon}><Blocks size={14} /></span>
            <span><small>零知识</small>本地加密会话</span>
          </div>
          <div className={styles.statusIsland}>
            <button
              className={`${styles.badge} ${styles.statusTrigger} ${badgeClass}`}
              type="button"
              aria-haspopup="dialog"
              aria-label="查看密码库状态"
            >
              <span className={styles.badgePulse} aria-hidden="true" />
              <RefreshCw size={12} />
              {syncStatus}
            </button>
            {vaultStatus ? (
              <div className={styles.statusPopover} role="dialog" aria-label="密码库状态">
                <div className={styles.statusPopoverHead}>
                  <span>密码库状态</span>
                  <span className={styles.liveBadge}>
                    <i aria-hidden="true" />
                    会话在线
                  </span>
                </div>
                <div className={styles.statusTrack}>
                  <div className={`${styles.statusNode} ${styles.statusNodePrimary}`}>
                    <span className={styles.statusIndex}>01</span>
                    <span className={styles.statusLabel}>保存条目</span>
                    <strong>{vaultStatus.itemCount}</strong>
                  </div>
                  <div className={styles.statusNode}>
                    <span className={styles.statusIndex}>02</span>
                    <span className={styles.statusLabel}>最近更新</span>
                    <strong className={styles.statusCopy}>{vaultStatus.updatedAt}</strong>
                  </div>
                  <div className={styles.statusNode}>
                    <span className={styles.statusIndex}>03</span>
                    <span className={styles.statusLabel}>同步状态</span>
                    <strong className={`${styles.statusCopy} ${badgeClass}`}>
                      {vaultStatus.syncStatus}
                    </strong>
                  </div>
                  <div className={styles.statusNode}>
                    <span className={styles.statusIndex}>04</span>
                    <span className={styles.statusLabel}>上次同步</span>
                    <strong className={styles.statusCopy}>
                      {vaultStatus.lastSyncedAt ? formatDateTime(vaultStatus.lastSyncedAt) : "尚未同步"}
                    </strong>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
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
              {loading ? "写入中..." : "保存结果"}
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
