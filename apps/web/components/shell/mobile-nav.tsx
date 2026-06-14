"use client";

import { KeyRound, LayoutDashboard, RefreshCw, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import styles from "./mobile-nav.module.css";

interface MobileNavTab {
  id: string;
  label: string;
  icon: ReactNode;
}

interface MobileNavProps {
  activeNav: string;
  onNavChange: (id: string) => void;
  navIds: Record<string, string>;
}

const TABS: MobileNavTab[] = [
  { id: "dashboard", label: "总览", icon: <LayoutDashboard size={18} /> },
  { id: "credentials", label: "列表", icon: <KeyRound size={18} /> },
  { id: "sync", label: "同步", icon: <RefreshCw size={18} /> },
  { id: "settings", label: "工具", icon: <Settings size={18} /> },
];

export function MobileNav({ activeNav, onNavChange, navIds }: MobileNavProps) {
  return (
    <nav className={styles.bar} aria-label="移动端导航">
      <span className={styles.dockRail} aria-hidden="true" />
      {TABS.map((tab) => {
        const navId = navIds[tab.id.toUpperCase() as keyof typeof navIds] ?? tab.id;
        const isActive = activeNav === navId;

        return (
          <button
            key={tab.id}
            type="button"
            className={cn(styles.tab, isActive && styles.tabActive)}
            onClick={() => onNavChange(navId)}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
          >
            <span className={styles.tabIcon}>{tab.icon}</span>
            <span className={styles.tabLabel}>{tab.label}</span>
            {isActive ? <span className={styles.activeDot} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </nav>
  );
}
