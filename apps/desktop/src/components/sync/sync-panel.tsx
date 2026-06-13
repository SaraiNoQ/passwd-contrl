"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  RefreshCw,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { StoredItem } from "../../lib/storage/desktop-ciphertext-store";
import { cn } from "../../lib/utils";
import styles from "./sync-panel.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncEvent = {
  id: string;
  timestamp: string;
  type:
    | "push"
    | "pull"
    | "conflict"
    | "error"
    | "device-approved"
    | "device-rejected"
    | "device-revoked";
  description: string;
  itemCount?: number;
};

export type SyncPanelProps = {
  /** All stored ciphertext items for computing stats. */
  storedItems: StoredItem[];
  /** Conflict item IDs. */
  conflictIds: Set<string>;
  /** Last synced timestamp. */
  lastSyncedAt: string | null;
  /** Sync activity log (most recent first). */
  syncEvents?: SyncEvent[];
  /** Whether currently syncing. */
  loading?: boolean;
  /** Whether offline. */
  isOffline?: boolean;
  /** Trigger a manual sync. */
  onSync?: () => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type SyncStatusLabel = "synced" | "pending" | "conflict" | "offline" | "unknown";

const STATUS_CONFIG: Record<
  SyncStatusLabel,
  { label: string; icon: LucideIcon; iconClass: string; accentClass: string }
> = {
  synced: {
    label: "已同步",
    icon: Check,
    iconClass: styles.statusIconSuccess ?? "",
    accentClass: styles.statusCardAccentOnline ?? "",
  },
  pending: {
    label: "待同步",
    icon: Clock,
    iconClass: styles.statusIconWarning ?? "",
    accentClass: styles.statusCardAccentOnline ?? "",
  },
  conflict: {
    label: "有冲突",
    icon: AlertTriangle,
    iconClass: styles.statusIconDanger ?? "",
    accentClass: styles.statusCardAccentConflict ?? "",
  },
  offline: {
    label: "离线",
    icon: WifiOff,
    iconClass: styles.statusIconMuted ?? "",
    accentClass: styles.statusCardAccentOffline ?? "",
  },
  unknown: {
    label: "未知",
    icon: RefreshCw,
    iconClass: styles.statusIconMuted ?? "",
    accentClass: styles.statusCardAccentOnline ?? "",
  },
};

const EVENT_ICON: Record<SyncEvent["type"], LucideIcon> = {
  push: ArrowUp,
  pull: ArrowDown,
  conflict: AlertTriangle,
  error: X,
  "device-approved": Check,
  "device-rejected": X,
  "device-revoked": X,
};

const EVENT_ICON_CLASS: Record<SyncEvent["type"], string> = {
  push: styles.eventIconMuted ?? "",
  pull: styles.eventIconSuccess ?? "",
  conflict: styles.eventIconDanger ?? "",
  error: styles.eventIconDanger ?? "",
  "device-approved": styles.eventIconSuccess ?? "",
  "device-rejected": styles.eventIconWarning ?? "",
  "device-revoked": styles.eventIconDanger ?? "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveStatus(
  isOffline: boolean,
  conflictCount: number,
  pendingCount: number,
): SyncStatusLabel {
  if (isOffline) return "offline";
  if (conflictCount > 0) return "conflict";
  if (pendingCount > 0) return "pending";
  return "synced";
}

function formatEventTime(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} 小时前`;
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  } catch {
    return iso;
  }
}

function formatLastSynced(iso: string | null): string {
  if (!iso) return "从未同步";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  count,
  tone,
  icon: Icon,
}: {
  label: string;
  count: number;
  tone: "success" | "warning" | "danger" | "muted";
  icon: LucideIcon;
}) {
  const toneClass =
    tone === "success"
      ? styles.toneSuccess
      : tone === "warning"
        ? styles.toneWarning
        : tone === "danger"
          ? styles.toneDanger
          : styles.toneMuted;
  return (
    <div className={styles.statCard}>
      <div className={styles.statCardLabel}>
        <Icon size={14} className={toneClass} />
        <span>{label}</span>
      </div>
      <div className={cn(styles.statCardValue, toneClass)}>{count}</div>
    </div>
  );
}

function EventRow({ event }: { event: SyncEvent }) {
  const Icon = EVENT_ICON[event.type] ?? Activity;
  const iconClass = EVENT_ICON_CLASS[event.type] ?? styles.eventIconMuted;

  return (
    <div className={styles.eventRow}>
      <div className={cn(styles.eventIcon, iconClass)}>
        <Icon size={14} />
      </div>
      <div className={styles.eventContent}>
        <div className={styles.eventDesc}>{event.description}</div>
        <div className={styles.eventMeta}>
          <span className={styles.eventTime}>
            <Clock size={10} />
            {formatEventTime(event.timestamp)}
          </span>
          {event.itemCount !== undefined && (
            <span>{event.itemCount} 项</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SyncPanel({
  storedItems,
  conflictIds,
  lastSyncedAt,
  syncEvents = [],
  loading = false,
  isOffline = false,
  onSync,
}: SyncPanelProps) {
  const [showAllEvents, setShowAllEvents] = useState(false);

  // Compute item-level stats
  const totalItems = storedItems.length;
  const syncedCount = useMemo(
    () => storedItems.filter((i) => !i.hasConflict).length,
    [storedItems],
  );
  const conflictCount = conflictIds.size;
  const pendingCount = useMemo(
    () => storedItems.filter((i) => i.hasConflict).length,
    [storedItems],
  );

  const syncLabel = deriveStatus(isOffline, conflictCount, pendingCount);
  const statusConfig = STATUS_CONFIG[syncLabel];
  const StatusIcon = statusConfig.icon;

  // Display events (last 10, or all if expanded)
  const displayEvents = showAllEvents ? syncEvents : syncEvents.slice(0, 10);

  return (
    <div className={styles.container}>
      {/* Status card */}
      <div className={styles.statusCard}>
        <div
          className={cn(styles.statusCardAccent, statusConfig.accentClass)}
        />
        <div className={styles.statusHeader}>
          <div className={styles.statusText}>
            <span className={styles.eyebrow}>SYNC STATUS</span>
            <h2 className={styles.heading}>同步状态</h2>
            <p className={styles.subheading}>
              查看当前同步状态、待处理变更和最近的同步活动。
            </p>
          </div>
          {onSync && (
            <button
              type="button"
              className={cn(styles.syncButton, loading && styles.syncing)}
              onClick={onSync}
              disabled={loading}
              aria-label="立即同步"
            >
              <RefreshCw
                size={14}
                className={loading ? styles.spinning : undefined}
              />
              {loading ? "同步中..." : "立即同步"}
            </button>
          )}
        </div>

        {/* Status indicator */}
        <div className={styles.statusIndicator}>
          <div className={cn(styles.statusIconBlock, statusConfig.iconClass)}>
            <StatusIcon size={22} />
          </div>
          <div>
            <div className={styles.statusLabel}>{statusConfig.label}</div>
            <div className={styles.statusSubtext}>
              {isOffline
                ? "当前处于离线状态，连接网络后将自动同步"
                : conflictCount > 0
                  ? `${conflictCount} 条冲突需要处理`
                  : totalItems > 0
                    ? `${totalItems} 项已同步`
                    : "等待首次同步"}
            </div>
          </div>
        </div>

        {/* Meta row */}
        <div className={styles.metaRow}>
          <span className={styles.lastSynced}>
            <Clock size={12} />
            上次同步：{formatLastSynced(lastSyncedAt)}
          </span>
          {isOffline && (
            <span className={styles.offlineNotice}>
              <WifiOff size={12} />
              离线模式
            </span>
          )}
        </div>
      </div>

      {/* Stats grid */}
      {totalItems > 0 && (
        <section className={styles.statsSection}>
          <h3 className={styles.statsHeader}>
            <Activity size={16} />
            同步统计
            <span
              style={{
                fontSize: "var(--text-caption-size)",
                fontWeight: 400,
                color: "var(--color-text-muted)",
              }}
            >
              共 {totalItems} 项
            </span>
          </h3>
          <div className={styles.statsGrid}>
            <StatCard
              label="已同步"
              count={syncedCount}
              tone="success"
              icon={Check}
            />
            <StatCard
              label="待处理"
              count={pendingCount}
              tone="warning"
              icon={Clock}
            />
            {conflictCount > 0 && (
              <StatCard
                label="冲突"
                count={conflictCount}
                tone="danger"
                icon={AlertTriangle}
              />
            )}
          </div>

          {/* Progress bar */}
          <div className={styles.progressSection}>
            <div className={styles.progressLabels}>
              <span>同步进度</span>
              <span>
                {totalItems > 0
                  ? Math.round((syncedCount / totalItems) * 100)
                  : 0}
                %
              </span>
            </div>
            <progress
              className={styles.progressBar}
              value={syncedCount}
              max={totalItems}
              aria-label="同步进度"
            />
          </div>
        </section>
      )}

      {/* Activity log */}
      <section className={styles.activitySection}>
        <div className={styles.activityHeader}>
          <h3 className={styles.statsHeader}>
            <Clock size={16} className={styles.toneMuted} />
            最近活动
          </h3>
          {syncEvents.length > 10 && (
            <button
              type="button"
              className={styles.toggleButton}
              onClick={() => setShowAllEvents((v) => !v)}
              aria-expanded={showAllEvents}
            >
              {showAllEvents ? "收起" : `查看全部 (${syncEvents.length})`}
            </button>
          )}
        </div>
        {syncEvents.length > 0 ? (
          <div className={styles.activityList} role="list" aria-label="同步活动记录">
            {displayEvents.map((event) => (
              <div key={event.id} role="listitem">
                <EventRow event={event} />
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>
              <Clock size={20} />
            </div>
            <div className={styles.emptyContent}>
              <span className={styles.emptyTitle}>暂无同步记录</span>
              <span className={styles.emptyText}>
                同步操作完成后，活动记录将在此显示。
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
