"use client";

import { useCallback, useMemo } from "react";
import { PlusCircle, Upload, RefreshCw, AlertCircle, ArrowDown, ArrowUp, Monitor, XCircle, CheckCircle2 } from "lucide-react";
import type { VaultItem } from "../../lib/local-vault";
import { isLogin } from "../../lib/item-types";
import { useBreachCheck } from "../../hooks/useBreachCheck";
import { PasswordHealth } from "./password-health";
import styles from "./dashboard-page.module.css";

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

type SyncEvent = {
  id: string;
  timestamp: string;
  type: "push" | "pull" | "conflict" | "error" | "device-approved" | "device-rejected" | "device-revoked";
  description: string;
  itemCount?: number;
};

export interface DashboardPageProps {
  items: VaultItem[];
  syncEvents: SyncEvent[];
  lastSyncedAt: string | null;
  onEditItem: (item: VaultItem) => void;
  onAddNew: () => void;
  onImport: () => void;
  onSyncNow: () => void;
}

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function getActivityIcon(type: SyncEvent["type"]): {
  Icon: React.ComponentType<{ size?: number }>;
  iconClass: string | undefined;
} {
  switch (type) {
    case "push":       return { Icon: ArrowUp,     iconClass: styles.activityIconPush };
    case "pull":       return { Icon: ArrowDown,   iconClass: styles.activityIconPull };
    case "conflict":   return { Icon: AlertCircle, iconClass: styles.activityIconConflict };
    case "error":      return { Icon: XCircle,     iconClass: styles.activityIconError };
    case "device-approved": return { Icon: CheckCircle2, iconClass: styles.activityIconDevice };
    case "device-rejected": return { Icon: XCircle,      iconClass: styles.activityIconError };
    case "device-revoked":  return { Icon: Monitor,      iconClass: styles.activityIconError };
  }
}

/* ---------------------------------------------------------------------------
   DashboardPage
   --------------------------------------------------------------------------- */

export function DashboardPage({
  items,
  syncEvents,
  lastSyncedAt,
  onEditItem,
  onAddNew,
  onImport,
  onSyncNow
}: DashboardPageProps) {
  const {
    checking: breachChecking,
    progress: breachProgress,
    breachedIds,
    breachCounts,
    startCheck,
  } = useBreachCheck();

  const handleCheckBreach = useCallback(async () => {
    await startCheck(items.filter(isLogin).map((item) => ({ id: item.id, password: item.password })));
  }, [items, startCheck]);

  const recentEvents = syncEvents.slice(0, 5);

  return (
    <div className={styles.container}>
      {/* Quick actions row */}
      <div className={styles.quickActions}>
        <button className={styles.quickActionBtn} type="button" onClick={onAddNew}>
          <PlusCircle size={18} />
          添加凭据
        </button>
        <button className={styles.quickActionBtn} type="button" onClick={onImport}>
          <Upload size={18} />
          导入 CSV
        </button>
        <button className={styles.quickActionBtn} type="button" onClick={onSyncNow}>
          <RefreshCw size={18} />
          立即同步
        </button>
      </div>

      {/* Password Health */}
      <PasswordHealth
        items={items}
        onEditItem={onEditItem}
        breachChecking={breachChecking}
        breachProgress={breachProgress}
        breachedIds={breachedIds}
        breachCounts={breachCounts}
        onCheckBreach={handleCheckBreach}
      />

      {/* Recent Activity */}
      <div className={`${styles.activitySection} pixel-border pixel-scanlines`}>
        <div className={styles.activityHeader}>
          <h3>最近活动</h3>
          {lastSyncedAt ? (
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              上次同步: {formatDateTime(lastSyncedAt)}
            </span>
          ) : null}
        </div>

        {recentEvents.length > 0 ? (
          <div className={styles.activityList}>
            {recentEvents.map((event) => {
              const { Icon, iconClass } = getActivityIcon(event.type);
              return (
                <div className={styles.activityItem} key={event.id}>
                  <div className={iconClass}>
                    <Icon size={14} />
                  </div>
                  <div className={styles.activityInfo}>
                    <div className={styles.activityDesc}>{event.description}</div>
                    <div className={styles.activityTime}>{formatDateTime(event.timestamp)}</div>
                  </div>
                  {event.itemCount != null && event.itemCount > 0 ? (
                    <span className={styles.activityCount}>
                      {event.itemCount} 项
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.activityList}>
            <div className={styles.activityEmpty}>
              暂无活动记录。开始使用同步功能后将在此显示。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
