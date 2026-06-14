"use client";

import { type FormEvent, type ReactNode, useState, useCallback } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Folder,
  Lock,
  RefreshCw,
  Settings,
  UploadCloud,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Button } from "../ui/button";
import styles from "./sidebar.module.css";
import { cn } from "../../lib/utils";

export interface SidebarProps {
  unlocked: boolean;
  activeNav: string;
  onNavChange: (id: string) => void;
  sidebarNav: Array<{ id: string; label: string; icon: ReactNode; enabled: boolean }>;
  extensionBridge: { configured: boolean; runtimeAvailable: boolean };
  syncStatus: string;
  isOffline: boolean;
  onLockVault: () => void;
  user: { id: string; email: string; serverRevision: number } | null;
  showAccountSection: boolean;
  onToggleAccountSection: () => void;
  canRestoreFromCloud: boolean;
  encryptedVault: any;
  onRestoreFromCloud: () => void;
  onSyncNow: () => void;
  onLogout: () => void;
  loading: boolean;
  accountEmail: string;
  onAccountEmailChange: (email: string) => void;
  accountPassword: string;
  onAccountPasswordChange: (password: string) => void;
  onRegister: (e: FormEvent) => void;
  onLogin: () => void;
  /** Folder navigation */
  folders: string[];
  folderItemCounts: Map<string, number>;
  allCount: number;
  uncategorizedCount: number;
  selectedFolder: string | null;
  onFolderSelect: (folder: string | null) => void;
  credentialsNavId: string;
  /** Mobile drawer control */
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({
  unlocked,
  activeNav,
  onNavChange,
  sidebarNav,
  extensionBridge,
  syncStatus,
  isOffline,
  onLockVault,
  user,
  showAccountSection,
  onToggleAccountSection,
  canRestoreFromCloud,
  encryptedVault,
  onRestoreFromCloud,
  onSyncNow,
  onLogout,
  loading,
  accountEmail,
  onAccountEmailChange,
  accountPassword,
  onAccountPasswordChange,
  onRegister,
  onLogin,
  folders,
  folderItemCounts,
  allCount,
  uncategorizedCount,
  selectedFolder,
  onFolderSelect,
  credentialsNavId,
  isOpen,
  onClose,
}: SidebarProps) {
  const [foldersExpanded, setFoldersExpanded] = useState(true);

  const handleFolderClick = useCallback(
    (folder: string | null) => {
      if (activeNav !== credentialsNavId) {
        onNavChange(credentialsNavId);
      }
      onFolderSelect(folder);
    },
    [activeNav, credentialsNavId, onNavChange, onFolderSelect],
  );
  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`${styles.overlay} ${isOpen ? styles.overlayVisible : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ""}`}
        aria-label="密码目录导航"
      >
        <span className={styles.pixelCloudA} aria-hidden="true" />
        <span className={styles.pixelCloudB} aria-hidden="true" />
        {/* Close button (mobile) */}
        {onClose && (
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="关闭菜单"
          >
            <X size={20} />
          </button>
        )}

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
            <span className={styles.logoCaption}>密码目录 / 设备区</span>
          </div>
          <span className={cn(styles.lockBadge, unlocked ? styles.lockBadgeUnlocked : styles.lockBadgeLocked)}>
            {unlocked ? "已解锁" : "封存"}
          </span>
        </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        <span className={styles.navLabel}>密码目录</span>
        {sidebarNav.map((item, index) => (
          <button
            key={item.id}
            className={cn(styles.navItem, activeNav === item.id && styles.navItemActive)}
            disabled={!item.enabled}
            onClick={() => onNavChange(item.id)}
            type="button"
          >
            <span className={styles.navIndex} aria-hidden="true">
              {(index + 1).toString().padStart(2, "0")}
            </span>
            <span className={styles.navIcon} aria-hidden="true">
              {item.icon}
            </span>
            <span className={styles.navText}>{item.label}</span>
          </button>
        ))}

        {/* Folder navigation */}
        {unlocked ? (
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
                      {folderItemCounts.get(folder) ?? 0}
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
        <span className={styles.navLabel}>设备区信号</span>
        {/* Extension bridge status */}
        <div
          className={cn(
            styles.status,
            !extensionBridge.configured
              ? styles.statusWarning
              : extensionBridge.runtimeAvailable
                ? styles.statusSuccess
                : styles.statusDanger,
          )}
        >
          <span className={styles.statusDot} aria-hidden="true" />
          {extensionBridge.runtimeAvailable ? <Wifi size={14} /> : <WifiOff size={14} />}
          {!extensionBridge.configured
            ? "扩展未连接"
            : extensionBridge.runtimeAvailable
              ? "扩展节点在线"
              : "扩展节点离线"}
        </div>

        {/* Sync status */}
        {user ? (
          <div className={styles.status}>
            <span className={styles.statusDot} aria-hidden="true" />
            <RefreshCw size={14} />
            {syncStatus}
          </div>
        ) : null}

        {/* Offline notice */}
        {isOffline ? (
          <div className={styles.offlineNotice}>
            <AlertTriangle size={14} />
            当前离线，同步状态暂存本地
          </div>
        ) : null}

        {/* Lock button */}
        {unlocked ? (
          <Button
            variant="secondary"
            className={styles.lockBtn ?? ""}
            onClick={onLockVault}
          >
            <Lock size={16} />
            锁定密码库
          </Button>
        ) : null}

        {/* Account section toggle */}
        <button
          className={styles.accountToggle}
          type="button"
          onClick={onToggleAccountSection}
        >
          <Settings size={18} />
          <span className={styles.accountToggleCopy}>
            <span className={styles.accountToggleTitle}>身份节点</span>
            <span className={styles.accountToggleValue}>{user ? user.email : "注册 / 登录"}</span>
          </span>
        </button>

        {showAccountSection ? (
          <div className={styles.accountBody}>
            {user ? (
              <>
                {canRestoreFromCloud && !encryptedVault ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={loading}
                    onClick={onRestoreFromCloud}
                  >
                    <UploadCloud size={14} />
                    {loading ? "恢复中..." : "从云端恢复"}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  loading={loading}
                  onClick={onSyncNow}
                >
                  <RefreshCw size={14} />
                  {loading ? "同步中..." : "立即同步"}
                </Button>
                <Button variant="ghost" size="sm" onClick={onLogout}>
                  <Lock size={14} />
                  退出登录
                </Button>
              </>
            ) : (
              <form className={styles.accountForm} onSubmit={onRegister}>
                <input
                  className={styles.accountInput}
                  autoComplete="email"
                  type="email"
                  value={accountEmail}
                  onChange={(e) => onAccountEmailChange(e.target.value)}
                  placeholder="输入邮箱地址"
                />
                <input
                  className={styles.accountInput}
                  autoComplete="current-password"
                  minLength={12}
                  type="password"
                  value={accountPassword}
                  onChange={(e) => onAccountPasswordChange(e.target.value)}
                  placeholder="账户密码"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={loading}
                >
                  {loading ? "处理中..." : "注册"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={loading}
                  onClick={onLogin}
                >
                  {loading ? "处理中..." : "登录"}
                </Button>
              </form>
            )}
          </div>
        ) : null}
      </div>
    </aside>
    </>
  );
}
