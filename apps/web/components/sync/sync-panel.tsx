"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  RefreshCw,
  WifiOff,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ItemSyncInfo } from "../../lib/item-sync";
import styles from "./sync-panel.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncEvent = {
  id: string;
  timestamp: string;
  type: "push" | "pull" | "conflict" | "error" | "device-approved" | "device-rejected" | "device-revoked";
  description: string;
  itemCount?: number;
};

export type SyncPanelProps = {
  /** Current sync status string */
  syncStatus?: string;
  /** Last synced timestamp */
  lastSyncedAt?: string | null;
  /** Item-level sync info for statistics */
  itemSyncInfos?: ItemSyncInfo[];
  /** Sync activity log (most recent first) */
  syncEvents?: SyncEvent[];
  /** Whether currently syncing */
  loading?: boolean;
  /** Whether offline */
  isOffline?: boolean;
  /** Trigger a sync */
  onSync?: () => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type SyncStatusLabel = "synced" | "pending" | "conflict" | "offline" | "failed" | "unknown";

const STATUS_CONFIG: Record<SyncStatusLabel, { label: string; color: string; icon: typeof Check }> = {
  synced: { label: "已同步", color: "var(--color-success)", icon: Check },
  pending: { label: "待同步", color: "var(--color-warning)", icon: Clock },
  conflict: { label: "有冲突", color: "var(--color-danger)", icon: AlertTriangle },
  offline: { label: "离线", color: "var(--color-text-muted)", icon: WifiOff },
  failed: { label: "同步失败", color: "var(--color-danger)", icon: X },
  unknown: { label: "未知", color: "var(--color-text-muted)", icon: RefreshCw }
};

const EVENT_ICON: Record<SyncEvent["type"], typeof ArrowUp> = {
  push: ArrowUp,
  pull: ArrowDown,
  conflict: AlertTriangle,
  error: X,
  "device-approved": Check,
  "device-rejected": X,
  "device-revoked": X
};

const EVENT_COLOR: Record<SyncEvent["type"], string> = {
  push: "var(--color-primary)",
  pull: "var(--color-success)",
  conflict: "var(--color-danger)",
  error: "var(--color-danger)",
  "device-approved": "var(--color-success)",
  "device-rejected": "var(--color-warning)",
  "device-revoked": "var(--color-danger)"
};

const EVENT_BG: Record<SyncEvent["type"], string> = {
  push: "var(--color-primary-soft)",
  pull: "var(--color-success-soft)",
  conflict: "var(--color-danger-soft)",
  error: "var(--color-danger-soft)",
  "device-approved": "var(--color-success-soft)",
  "device-rejected": "var(--color-warning-soft)",
  "device-revoked": "var(--color-danger-soft)"
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveSyncStatus(statusStr: string, isOffline: boolean): SyncStatusLabel {
  if (isOffline) return "offline";
  // Chinese keywords (produced by vault-app.tsx)
  if (statusStr.includes("已同步")) return "synced";
  if (statusStr.includes("冲突")) return "conflict";
  if (statusStr.includes("同步中")) return "pending";
  if (statusStr.includes("版本")) return "synced";
  if (statusStr.includes("同步失败") || statusStr.includes("失败")) return "failed";
  if (statusStr.includes("离线")) return "offline";
  // English fallback (backward compat)
  const lower = statusStr.toLowerCase();
  if (lower.includes("synced")) return "synced";
  if (lower.includes("conflict")) return "conflict";
  if (lower.includes("pending")) return "pending";
  if (lower.includes("fail") || lower.includes("error")) return "failed";
  if (lower.includes("offline")) return "offline";
  return "unknown";
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
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date);
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, count, color, icon: Icon }: { label: string; count: number; color: string; icon: typeof Check }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statCardLabel}>
        <Icon size={14} style={{ color }} />
        <span>{label}</span>
      </div>
      <div className={styles.statCardValue} style={{ color }}>{count}</div>
    </div>
  );
}

function EventRow({ event }: { event: SyncEvent }) {
  const Icon = EVENT_ICON[event.type] ?? Activity;
  const color = EVENT_COLOR[event.type] ?? "var(--color-text-muted)";
  const bg = EVENT_BG[event.type] ?? "var(--color-bg-panel-soft)";

  return (
    <div className={styles.eventRow}>
      <div className={styles.eventIcon} style={{ background: bg, color }}>
        <Icon size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={styles.eventDesc}>{event.description}</div>
        <div className={styles.eventMeta}>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <Clock size={10} />
            {formatEventTime(event.timestamp)}
          </span>
          {event.itemCount !== undefined ? (
            <span>
              {event.itemCount} 项
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SyncPanel({
  syncStatus = "Local only",
  lastSyncedAt = null,
  itemSyncInfos = [],
  syncEvents = [],
  loading = false,
  isOffline = false,
  onSync
}: SyncPanelProps) {
  const [showAllEvents, setShowAllEvents] = useState(false);

  const syncLabel = deriveSyncStatus(syncStatus, isOffline);
  const statusConfig = STATUS_CONFIG[syncLabel];
  const StatusIcon = statusConfig.icon;

  // Compute item-level stats
  const syncedCount = useMemo(() => itemSyncInfos.filter((i) => i.status === "synced").length, [itemSyncInfos]);
  const pendingCount = useMemo(() => itemSyncInfos.filter((i) => i.status === "pending").length, [itemSyncInfos]);
  const conflictCount = useMemo(() => itemSyncInfos.filter((i) => i.status === "conflict").length, [itemSyncInfos]);
  const localOnlyCount = useMemo(() => itemSyncInfos.filter((i) => i.status === "local-only").length, [itemSyncInfos]);
  const totalItems = itemSyncInfos.length;

  // Display events (last 10, or all if expanded)
  const displayEvents = showAllEvents ? syncEvents : syncEvents.slice(0, 10);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Status + sync button */}
      <div className={`${styles.card} pixel-border pixel-scanlines`}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            同步状态
          </h2>
          {onSync ? (
            <button
              type="button"
              className={styles.syncButton}
              style={{
                opacity: loading ? 0.6 : 1,
                cursor: loading ? "not-allowed" : "pointer"
              }}
              onClick={onSync}
              disabled={loading}
              aria-label="立即同步"
            >
              <RefreshCw size={14} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
              {loading ? "同步中..." : "立即同步"}
            </button>
          ) : null}
        </div>

        {/* Status indicator — large pixel-art badge */}
        <div className={styles.statusIndicator}>
          <div
            className={styles.statusIconBlock}
            style={{ color: statusConfig.color, borderColor: statusConfig.color }}
          >
            <StatusIcon size={22} />
          </div>
          <div>
            <div className={styles.statusLabel} style={{ color: statusConfig.color }}>
              {statusConfig.label}
            </div>
            <div className={styles.statusSubtext}>
              {syncStatus}
            </div>
          </div>
        </div>

        {/* Last synced */}
        {lastSyncedAt ? (
          <div className={styles.lastSynced}>
            <Clock size={12} />
            上次同步：{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastSyncedAt))}
          </div>
        ) : null}

        {/* Offline notice */}
        {isOffline ? (
          <div className={styles.offlineNotice}>
            <WifiOff size={14} />
            你当前处于离线状态。连接网络后将自动同步。
          </div>
        ) : null}
      </div>

      {/* Item-level sync statistics */}
      {itemSyncInfos.length > 0 ? (
        <div className={`${styles.card} pixel-border pixel-scanlines`}>
          <h3 className={styles.statsHeader}>
            <Activity size={16} style={{ color: "var(--color-primary)" }} />
            同步统计
            <span style={{ fontSize: 12, fontWeight: 400, color: "var(--color-text-muted)", fontFamily: "var(--font-family)" }}>
              共 {totalItems} 项
            </span>
          </h3>
          <div className={styles.statsGrid}>
            <StatCard label="已同步" count={syncedCount} color="var(--color-success)" icon={Check} />
            <StatCard label="待同步" count={pendingCount} color="var(--color-warning)" icon={Clock} />
            {conflictCount > 0 ? (
              <StatCard label="冲突" count={conflictCount} color="var(--color-danger)" icon={AlertTriangle} />
            ) : null}
            {localOnlyCount > 0 ? (
              <StatCard label="仅本地" count={localOnlyCount} color="var(--color-text-muted)" icon={WifiOff} />
            ) : null}
          </div>

          {/* Progress bar */}
          <div className={styles.progressSection}>
            <div className={styles.progressLabels}>
              <span>同步进度</span>
              <span>
                {totalItems > 0 ? Math.round((syncedCount / totalItems) * 100) : 0}%
              </span>
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{
                  width: `${totalItems > 0 ? (syncedCount / totalItems) * 100 : 0}%`
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Sync activity log */}
      {syncEvents.length > 0 ? (
        <div className={`${styles.card} pixel-border pixel-scanlines`}>
          <div className={styles.eventListHeader}>
            <h3 className={styles.statsHeader}>
              <Clock size={16} style={{ color: "var(--color-text-muted)" }} />
              同步活动记录
            </h3>
            {syncEvents.length > 10 ? (
              <button
                type="button"
                className={styles.toggleButton}
                onClick={() => setShowAllEvents((v) => !v)}
              >
                {showAllEvents ? "收起" : `查看全部 (${syncEvents.length})`}
              </button>
            ) : null}
          </div>
          <div>
            {displayEvents.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
