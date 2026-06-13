"use client";

import {
  AlertTriangle,
  LayoutDashboard,
  Lock,
  RefreshCw,
  Settings,
  Shield,
  Smartphone,
} from "lucide-react";
import styles from "./sidebar.module.css";

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
}

const NAV_ITEMS = [
  { id: "dashboard", label: "仪表盘", icon: LayoutDashboard },
  { id: "credentials", label: "凭据", icon: Shield },
  { id: "sync", label: "同步", icon: RefreshCw },
  { id: "devices", label: "设备", icon: Smartphone },
  { id: "settings", label: "设置", icon: Settings },
] as const;

import { memo } from "react";

export const Sidebar = memo(function Sidebar({
  currentPage,
  onNavigate,
  onLock,
  syncStatus,
  isOffline = false,
}: SidebarProps) {
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
