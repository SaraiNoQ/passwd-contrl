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
import { cn } from "../../lib/utils";
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
  /** Render statistics and receipts inside a parent sync workspace */
  embedded?: boolean;
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
type StatusTone = "success" | "warning" | "danger" | "muted";

const STATUS_CONFIG: Record<SyncStatusLabel, { label: string; tone: StatusTone; icon: typeof Check }> = {
  synced: { label: "已回执", tone: "success", icon: Check },
  pending: { label: "待投递", tone: "warning", icon: Clock },
  conflict: { label: "有分叉", tone: "danger", icon: AlertTriangle },
  offline: { label: "离线", tone: "muted", icon: WifiOff },
  failed: { label: "投递失败", tone: "danger", icon: X },
  unknown: { label: "等待状态", tone: "muted", icon: RefreshCw }
};

const TONE_CLASS: Record<StatusTone, string> = {
  success: styles.toneSuccess ?? "",
  warning: styles.toneWarning ?? "",
  danger: styles.toneDanger ?? "",
  muted: styles.toneMuted ?? ""
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

const EVENT_TONE: Record<SyncEvent["type"], StatusTone> = {
  push: "muted",
  pull: "success",
  conflict: "danger",
  error: "danger",
  "device-approved": "success",
  "device-rejected": "warning",
  "device-revoked": "danger"
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

function StatCard({ label, count, tone, icon: Icon }: { label: string; count: number; tone: StatusTone; icon: typeof Check }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statCardLabel}>
        <Icon size={14} className={TONE_CLASS[tone]} />
        <span>{label}</span>
      </div>
      <div className={cn(styles.statCardValue, TONE_CLASS[tone])}>{count}</div>
    </div>
  );
}

function EventRow({ event }: { event: SyncEvent }) {
  const Icon = EVENT_ICON[event.type] ?? Activity;
  const tone = EVENT_TONE[event.type] ?? "muted";

  return (
    <div className={styles.eventRow}>
      <div className={cn(styles.eventIcon, styles[`eventIcon${tone[0]?.toUpperCase()}${tone.slice(1)}`])}>
        <Icon size={14} />
      </div>
      <div className={styles.eventContent}>
        <div className={styles.eventDesc}>{event.description}</div>
        <div className={styles.eventMeta}>
          <span className={styles.eventTime}>
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
  embedded = false,
  syncStatus = "仅本地",
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
  const showStats = embedded || itemSyncInfos.length > 0;
  const showEvents = embedded || syncEvents.length > 0;

  return (
    <div className={cn(styles.panelStack, embedded && styles.embeddedStack)}>
      {/* Status + sync button */}
      {!embedded ? (
        <div className={styles.statusCard}>
          <div className={styles.relayPixelGrid} aria-hidden="true" />
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.displayMark}>区块同步链路</span>
              <h2 className={styles.cardTitle}>密文区块中继台</h2>
              <p className={styles.cardIntro}>
                每一次推送与拉取都会被整理成轻量密文区块，在设备节点之间留下可追溯的同步回执。
              </p>
            </div>
            {onSync ? (
              <button
                type="button"
                className={cn(styles.syncButton, loading && styles.loading)}
                onClick={onSync}
                disabled={loading}
                aria-label="立即同步"
              >
                <RefreshCw size={14} className={loading ? styles.spinning : undefined} />
                {loading ? "同步中..." : "立即同步"}
              </button>
            ) : null}
          </div>

          <div className={styles.statusIndicator}>
            <div className={cn(styles.statusIconBlock, TONE_CLASS[statusConfig.tone])}>
              <StatusIcon size={22} />
            </div>
            <div>
              <div className={cn(styles.statusLabel, TONE_CLASS[statusConfig.tone])}>
                {statusConfig.label}
              </div>
              <div className={styles.statusSubtext}>
                {syncStatus}
              </div>
            </div>
          </div>

          <div className={styles.relayTrack} aria-hidden="true">
            <span className={styles.relayNode} />
            <span className={styles.relayLine} />
            <span className={styles.relayNode} />
            <span className={styles.relayLine} />
            <span className={cn(styles.relayNode, styles.relayNodeActive)} />
          </div>

          {/* Last synced */}
          {lastSyncedAt ? (
            <div className={styles.lastSynced}>
              <Clock size={12} />
              上次上链：{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lastSyncedAt))}
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
      ) : null}

      {/* Item-level sync statistics */}
      {showStats ? (
        <section className={cn(styles.card, embedded && styles.embeddedBay)}>
          <h3 className={styles.statsHeader}>
            <Activity size={16} />
            区块高度
            <span className={styles.statsTotal}>
              共 {totalItems} 项
            </span>
          </h3>
          {itemSyncInfos.length > 0 ? (
            <>
              <div className={styles.statsGrid}>
                <StatCard label="已确认区块" count={syncedCount} tone="success" icon={Check} />
                <StatCard label="等待打包" count={pendingCount} tone="warning" icon={Clock} />
                {embedded || conflictCount > 0 ? (
                  <StatCard label="分叉冲突" count={conflictCount} tone="danger" icon={AlertTriangle} />
                ) : null}
                {embedded || localOnlyCount > 0 ? (
                  <StatCard label="本地暂存" count={localOnlyCount} tone="muted" icon={WifiOff} />
                ) : null}
              </div>

              {/* Progress bar */}
              <div className={styles.progressSection}>
                <div className={styles.progressLabels}>
                  <span>链路确认进度</span>
                  <span>
                    {totalItems > 0 ? Math.round((syncedCount / totalItems) * 100) : 0}%
                  </span>
                </div>
                <progress className={styles.progressBar} value={syncedCount} max={totalItems} aria-label="链路确认进度" />
              </div>
            </>
          ) : (
            <div className={styles.emptyBay}>
              <Activity size={18} aria-hidden="true" />
              <span>暂无可统计的同步项目</span>
            </div>
          )}
        </section>
      ) : null}

      {/* Sync activity log */}
      {showEvents ? (
        <section className={cn(styles.card, embedded && styles.embeddedBay)}>
          <div className={styles.eventListHeader}>
            <h3 className={styles.statsHeader}>
              <Clock size={16} className={styles.mutedIcon} />
              最近回执
            </h3>
            {syncEvents.length > 10 ? (
              <button
                type="button"
                className={styles.toggleButton}
                onClick={() => setShowAllEvents((v) => !v)}
                aria-expanded={showAllEvents}
              >
                {showAllEvents ? "收起" : `查看全部 (${syncEvents.length})`}
              </button>
            ) : null}
          </div>
          {syncEvents.length > 0 ? (
            <div className={styles.eventList} role="list" aria-label="最近同步中继记录">
              {displayEvents.map((event) => (
                <div key={event.id} role="listitem">
                  <EventRow event={event} />
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyBay}>
              <Clock size={18} aria-hidden="true" />
              <span>暂无同步回执</span>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
