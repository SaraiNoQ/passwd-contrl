"use client";

import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Folder,
  LayoutDashboard,
  Lock,
  RefreshCw,
  Settings,
  Shield,
  Upload,
  KeyRound,
  Smartphone,
} from "lucide-react";
import styles from "./sidebar.module.css";
import { cn } from "../../lib/utils";

export interface SidebarProps {
  /** Currently active page identifier */
  currentPage: string;
  /** Callback when user clicks a nav item */
  onNavigate: (page: string) => void;
  /** Callback when user clicks the lock button */
  onLock: () => void;
  /** Human-readable sync status text */
  syncStatus?: string;
  /** Whether the client is currently offline */
  isOffline?: boolean;
  /** Vault is unlocked — show folder navigation */
  isUnlocked?: boolean;
  /** Folder names */
  folders?: string[];
  /** Total count of all items */
  allCount?: number;
  /** Count per folder */
  folderCounts?: Map<string, number>;
  /** Count of uncategorized items */
  uncategorizedCount?: number;
  /** Currently selected folder (null = all, '' = uncategorized) */
  selectedFolder?: string | null;
  /** Called when user selects a folder */
  onFolderSelect?: (folder: string | null) => void;
  /** ID of the credentials nav item for auto-navigation */
  credentialsNavId?: string;
}

const NAV_ITEMS = [
  { id: "dashboard", label: "仪表盘", icon: LayoutDashboard },
  { id: "credentials", label: "凭据", icon: Shield },
  { id: "import", label: "导入", icon: Upload },
  { id: "recovery", label: "恢复码", icon: KeyRound },
  { id: "sync", label: "同步", icon: RefreshCw },
  { id: "devices", label: "设备", icon: Smartphone },
  { id: "settings", label: "设置", icon: Settings },
] as const;

import { memo, useState, useCallback } from "react";

export const Sidebar = memo(function Sidebar({
  currentPage,
  onNavigate,
  onLock,
  syncStatus,
  isOffline = false,
  isUnlocked = false,
  folders = [],
  allCount = 0,
  folderCounts = new Map(),
  uncategorizedCount = 0,
  selectedFolder = null,
  onFolderSelect,
  credentialsNavId = "credentials",
}: SidebarProps) {
  const [foldersExpanded, setFoldersExpanded] = useState(true);

  const handleFolderClick = useCallback(
    (folder: string | null) => {
      if (currentPage !== credentialsNavId) {
        onNavigate(credentialsNavId);
      }
      onFolderSelect?.(folder);
    },
    [currentPage, credentialsNavId, onNavigate, onFolderSelect],
  );
  return (
    <aside className={styles.sidebar} aria-label="密钥目录导航">
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoIcon} aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 28 28" shapeRendering="crispEdges">
            <rect x="6" y="2" width="16" height="4" fill="#ffffff" />
            <rect x="2" y="6" width="24" height="16" fill="#ffffff" />
            <rect x="2" y="6" width="4" height="16" fill="#6c3200" opacity="0.45" />
            <rect x="6" y="6" width="20" height="4" fill="#6c3200" opacity="0.35" />
            <rect x="22" y="10" width="4" height="12" fill="#6c3200" opacity="0.4" />
            <rect x="6" y="22" width="20" height="4" fill="#6c3200" opacity="0.4" />
            <rect x="10" y="10" width="8" height="4" fill="#ff5e24" />
            <rect x="12" y="14" width="4" height="8" fill="#232629" />
            <rect x="16" y="16" width="4" height="4" fill="#e3f1fe" />
          </svg>
        </div>
        <div className={styles.logoCopy}>
          <span className={styles.logoText}>obscura</span>
          <span className={styles.logoCaption}>密钥目录 / 桌面舱</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        <span className={styles.navLabel}>密钥目录</span>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`${styles.navItem} ${currentPage === item.id ? styles.navItemActive : ""}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className={styles.navIcon} aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className={styles.navText}>{item.label}</span>
            </button>
          );
        })}
        {/* Folder navigation */}
        {isUnlocked ? (
          <div className={styles.folderSection}>
            <button
              type="button"
              className={styles.folderToggle}
              onClick={() => setFoldersExpanded((v) => !v)}
            >
              {foldersExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              文件夹列表
            </button>

            {foldersExpanded ? (
              <div className={styles.folderList}>
                {/* All credentials */}
                <button
                  type="button"
                  className={cn(
                    styles.folderItem,
                    selectedFolder === null && styles.folderItemActive,
                  )}
                  onClick={() => handleFolderClick(null)}
                >
                  <Folder size={13} />
                  <span className={styles.folderName}>全部密码</span>
                  <span className={styles.folderCount}>{allCount}</span>
                </button>

                {/* Named folders */}
                {folders.map((folder) => (
                  <button
                    key={folder}
                    type="button"
                    className={cn(
                      styles.folderItem,
                      selectedFolder === folder && styles.folderItemActive,
                    )}
                    onClick={() => handleFolderClick(folder)}
                  >
                    <Folder size={13} />
                    <span className={styles.folderName}>{folder}</span>
                    <span className={styles.folderCount}>
                      {folderCounts.get(folder) ?? 0}
                    </span>
                  </button>
                ))}

                {/* Uncategorized */}
                <button
                  type="button"
                  className={cn(
                    styles.folderItem,
                    selectedFolder === "" && styles.folderItemActive,
                  )}
                  onClick={() => handleFolderClick("")}
                >
                  <Folder size={13} />
                  <span className={styles.folderName}>未分类</span>
                  <span className={styles.folderCount}>{uncategorizedCount}</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </nav>

      <div className={styles.divider} />

      {/* Footer */}
      <div className={styles.footer}>
        <span className={styles.navLabel}>节点舱信号</span>

        {/* Sync status */}
        {syncStatus ? (
          <div
            className={`${styles.status} ${
              syncStatus.includes("已同步")
                ? styles.statusSuccess
                : syncStatus.includes("冲突")
                  ? styles.statusWarning
                  : syncStatus.includes("失败")
                    ? styles.statusDanger
                    : ""
            }`}
          >
            <span className={styles.statusDot} aria-hidden="true" />
            <RefreshCw size={14} />
            {syncStatus}
          </div>
        ) : null}

        {/* Offline notice */}
        {isOffline ? (
          <div className={styles.offlineNotice}>
            <AlertTriangle size={14} />
            当前离线，回执暂存本地
          </div>
        ) : null}

        {/* Lock button */}
        <button
          type="button"
          className={styles.lockBtn}
          onClick={onLock}
        >
          <Lock size={16} />
          锁定密码库
        </button>
      </div>
    </aside>
  );
});
