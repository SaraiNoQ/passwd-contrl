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
      <div className={styles.commandDeck}>
        <div className={styles.commandCopy}>
          <span className={styles.commandKicker}>快捷操作 / NEXT STEP</span>
          <h2>继续整理你的密码库</h2>
          <p>添加新账号、导入旧密码，或立即同步到可信设备。</p>
        </div>
        <div className={styles.quickActions}>
          <button className={styles.quickActionPrimary} type="button" onClick={onAddNew}>
            <PlusCircle size={18} />添加凭据
          </button>
          <button className={styles.quickActionBtn} type="button" onClick={onImport}>
            <Upload size={18} />导入 CSV
          </button>
          <button className={styles.quickActionBtn} type="button" onClick={onSyncNow}>
            <RefreshCw size={18} />立即同步
          </button>
        </div>
      </div>

      <div className={styles.dashboardGrid}>
        <PasswordHealth
          items={items}
          onEditItem={onEditItem}
          breachChecking={breachChecking}
          breachProgress={breachProgress}
          breachedIds={breachedIds}
          breachCounts={breachCounts}
          onCheckBreach={handleCheckBreach}
        />

        <div className={styles.activitySection}>
          <div className={styles.activityHeader}>
            <div>
              <span>最近同步</span>
              <h3>最近活动</h3>
            </div>
            {lastSyncedAt ? <small>上次同步<br />{formatDateTime(lastSyncedAt)}</small> : null}
          </div>

          {recentEvents.length > 0 ? (
            <div className={styles.activityList}>
              {recentEvents.map((event) => {
                const { Icon, iconClass } = getActivityIcon(event.type);
                return (
                  <div className={styles.activityItem} key={event.id}>
                    <div className={iconClass}><Icon size={14} /></div>
                    <div className={styles.activityInfo}>
                      <div className={styles.activityDesc}>{event.description}</div>
                      <div className={styles.activityTime}>{formatDateTime(event.timestamp)}</div>
                    </div>
                    {event.itemCount != null && event.itemCount > 0 ? (
                      <span className={styles.activityCount}>{event.itemCount} 项</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.activityEmpty}>
              <div className={styles.emptyLedgerArt} aria-hidden="true">
                <span className={styles.emptyLedgerBlock} />
                <span className={styles.emptyLedgerBlock} />
                <span className={styles.emptyLedgerBlock} />
              </div>
              <div className={styles.activityEmptyCopy}>
                <span>还没有同步记录</span>
                <h4>等待第一次同步</h4>
                <p>同步后，这里会显示密码库更新、设备授权和冲突提醒。</p>
              </div>
              <button className={styles.activityEmptyAction} type="button" onClick={onSyncNow}>
                <RefreshCw size={16} />
                立即同步
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
