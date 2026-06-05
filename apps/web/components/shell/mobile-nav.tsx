"use client";

import { KeyRound, LayoutDashboard, Menu, RefreshCw, Settings } from "lucide-react";
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
  onOpenMenu: () => void;
  navIds: Record<string, string>;
}

const TABS: MobileNavTab[] = [
  { id: "credentials", label: "凭据", icon: <KeyRound size={18} /> },
  { id: "sync", label: "同步", icon: <RefreshCw size={18} /> },
  { id: "menu", label: "菜单", icon: <Menu size={18} /> },
  { id: "settings", label: "设置", icon: <Settings size={18} /> },
];

export function MobileNav({ activeNav, onNavChange, onOpenMenu, navIds }: MobileNavProps) {
  return (
    <nav className={styles.bar} aria-label="移动端导航">
      {TABS.map((tab) => {
        const isMenu = tab.id === "menu";
        const isActive = !isMenu && (activeNav === tab.id || activeNav === navIds[tab.id.toUpperCase() as keyof typeof navIds]);

        return (
          <button
            key={tab.id}
            type="button"
            className={cn(styles.tab, isActive && styles.tabActive)}
            onClick={() => {
              if (isMenu) {
                onOpenMenu();
              } else {
                const navId = navIds[tab.id.toUpperCase() as keyof typeof navIds] ?? tab.id;
                onNavChange(navId);
              }
            }}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
          >
            <span className={styles.tabIcon}>{tab.icon}</span>
            <span className={styles.tabLabel}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
