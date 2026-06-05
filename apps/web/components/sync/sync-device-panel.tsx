"use client";

import {
  AlertTriangle,
  Check,
  Clock,
  Monitor,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  WifiOff,
  X
} from "lucide-react";
import { useCallback, useState } from "react";
import type { DeviceInfo } from "../../lib/device-trust";
import type { EncryptedLocalVault, UnlockedVault } from "../../lib/local-vault";
import type { ItemSyncInfo } from "../../lib/item-sync";
import styles from "./sync-device-panel.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncDevicePanelProps = {
  vault: UnlockedVault | EncryptedLocalVault | null;
  onSync: () => void;
  onApproveDevice: (id: string) => void;
  onRejectDevice: (id: string) => void;
  /** Optional: revoke a device (revoke + warning confirmation) */
  onRevokeDevice?: (id: string) => void;
  /** Optional: current sync status string */
  syncStatus?: string;
  /** Optional: last synced timestamp */
  lastSyncedAt?: string | null;
  /** Optional: item-level sync info */
  itemSyncInfos?: ItemSyncInfo[];
  /** Optional: device list */
  devices?: DeviceInfo[];
  /** Optional: current device ID for highlighting */
  currentDeviceId?: string;
  /** Optional: whether currently loading */
  loading?: boolean;
  /** Optional: whether offline */
  isOffline?: boolean;
  /** Optional: refresh device list callback */
  onRefreshDevices?: () => void;
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

function deviceStatusLabel(status: DeviceInfo["status"]): { text: string; color: string } {
  switch (status) {
    case "approved":
      return { text: "已激活", color: "var(--color-success)" };
    case "pending":
      return { text: "待审批", color: "var(--color-warning)" };
    case "rejected":
      return { text: "已拒绝", color: "var(--color-danger)" };
    case "revoked":
      return { text: "已撤销", color: "var(--color-danger)" };
    default:
      return { text: "未知", color: "var(--color-text-muted)" };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SyncDevicePanel({
  onSync,
  onApproveDevice,
  onRejectDevice,
  onRevokeDevice,
  syncStatus = "Local only",
  lastSyncedAt = null,
  itemSyncInfos = [],
  devices = [],
  currentDeviceId = "",
  loading = false,
  isOffline = false,
  onRefreshDevices
}: SyncDevicePanelProps) {
  const [showDevices, setShowDevices] = useState(false);
  const [pendingDeviceAction, setPendingDeviceAction] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ deviceId: string; action: "approve" | "reject" | "revoke" } | null>(null);

  const syncLabel = deriveSyncStatus(syncStatus, isOffline);
  const statusConfig = STATUS_CONFIG[syncLabel];
  const StatusIcon = statusConfig.icon;

  const handleApprove = useCallback(
    (deviceId: string) => {
      setPendingDeviceAction(deviceId);
      onApproveDevice(deviceId);
      setConfirmAction(null);
      setTimeout(() => setPendingDeviceAction(null), 1000);
    },
    [onApproveDevice]
  );

  const handleReject = useCallback(
    (deviceId: string) => {
      setPendingDeviceAction(deviceId);
      onRejectDevice(deviceId);
      setConfirmAction(null);
      setTimeout(() => setPendingDeviceAction(null), 1000);
    },
    [onRejectDevice]
  );

  const handleRevoke = useCallback(
    (deviceId: string) => {
      if (!onRevokeDevice) return;
      setPendingDeviceAction(deviceId);
      onRevokeDevice(deviceId);
      setConfirmAction(null);
      setTimeout(() => setPendingDeviceAction(null), 1000);
    },
    [onRevokeDevice]
  );

  const requestConfirm = useCallback((deviceId: string, action: "approve" | "reject" | "revoke") => {
    setConfirmAction({ deviceId, action });
  }, []);

  const cancelConfirm = useCallback(() => {
    setConfirmAction(null);
  }, []);

  const toggleDevices = useCallback(() => {
    setShowDevices((v) => !v);
    if (!showDevices && onRefreshDevices) {
      onRefreshDevices();
    }
  }, [showDevices, onRefreshDevices]);

  // Sync stats
  const syncedCount = itemSyncInfos.filter((i) => i.status === "synced").length;
  const pendingCount = itemSyncInfos.filter((i) => i.status === "pending").length;
  const conflictCount = itemSyncInfos.filter((i) => i.status === "conflict").length;

  const pendingDevices = devices.filter((d) => d.status === "pending");
  const activeDevices = devices.filter((d) => d.status === "approved");

  // Confirmation dialog content
  const confirmDevice = confirmAction ? devices.find((d) => d.id === confirmAction.deviceId) : null;
  const confirmMessages: Record<typeof confirmAction extends null ? never : NonNullable<typeof confirmAction>["action"], { title: string; desc: string; color: string }> = {
    approve: {
      title: "批准设备",
      desc: `确认批准「${confirmDevice?.name ?? ""}」访问你的保险库？该设备将能同步你的加密数据。`,
      color: "var(--color-success)"
    },
    reject: {
      title: "拒绝设备",
      desc: `确认拒绝「${confirmDevice?.name ?? ""}」的访问请求？该设备将无法同步数据。`,
      color: "var(--color-warning)"
    },
    revoke: {
      title: "撤销设备",
      desc: `确认撤销「${confirmDevice?.name ?? ""}」的访问权限？该设备将立即失去同步能力，本地数据不会被删除，但无法再接收更新。此操作不可轻易撤销。`,
      color: "var(--color-danger)"
    }
  };

  return (
    <div className={styles.wrapper}>
      {/* Sync status card */}
      <div className={`${styles.card} pixel-border pixel-scanlines`}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            同步状态
          </h2>
          <button
            type="button"
            className={styles.syncButton}
            style={loading ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            onClick={onSync}
            disabled={loading}
            aria-label="立即同步"
          >
            <RefreshCw size={14} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
            {loading ? "同步中..." : "立即同步"}
          </button>
        </div>

        {/* Status indicator — large pixel-art badge */}
        <div className={styles.statusDisplay}>
          <div
            className={styles.statusIconBlock}
            style={{ color: statusConfig.color, borderColor: statusConfig.color }}
          >
            <StatusIcon size={22} />
          </div>
          <div>
            <div className={styles.statusText} style={{ color: statusConfig.color }}>
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

        {/* Item sync stats */}
        {itemSyncInfos.length > 0 ? (
          <div className={styles.dotStats}>
            <div className={styles.dotStat}>
              <span className={styles.dot} style={{ background: "var(--color-success)" }} />
              <span>已同步 {syncedCount}</span>
            </div>
            <div className={styles.dotStat}>
              <span className={styles.dot} style={{ background: "var(--color-warning)" }} />
              <span>待同步 {pendingCount}</span>
            </div>
            {conflictCount > 0 ? (
              <div className={styles.dotStat}>
                <span className={styles.dot} style={{ background: "var(--color-danger)" }} />
                <span>冲突 {conflictCount}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Trusted devices */}
      <div className={`${styles.card} pixel-border pixel-scanlines`}>
        <div className={styles.deviceHeader}>
          <h2 className={styles.cardTitle}>
            受信设备
          </h2>
          <button
            type="button"
            className={styles.deviceToggle}
            onClick={toggleDevices}
          >
            <Smartphone size={14} />
            {showDevices ? "收起" : "展开"}
          </button>
        </div>

        {showDevices ? (
          <div>
            {/* Pending device requests */}
            {pendingDevices.length > 0 ? (
              <div className={styles.pendingSection}>
                <h3 className={styles.pendingTitle}>
                  <AlertTriangle size={14} />
                  新设备请求 ({pendingDevices.length})
                </h3>
                {pendingDevices.map((device) => (
                  <div key={device.id} className={styles.deviceRow}>
                    <div className={styles.deviceInfo}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Smartphone size={14} style={{ color: "var(--color-warning)", flexShrink: 0 }} />
                        <strong className={styles.deviceName}>
                          {device.name}
                        </strong>
                        <span className={styles.deviceBadgeWarning}>
                          待审批
                        </span>
                      </div>
                      <div className={styles.deviceMeta}>
                        <Clock size={10} style={{ verticalAlign: -1 }} />{" "}
                        {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
                          new Date()
                        )}
                      </div>
                    </div>
                    <div className={styles.deviceActions}>
                      <button
                        type="button"
                        className={styles.approveBtn}
                        onClick={() => requestConfirm(device.id, "approve")}
                        disabled={pendingDeviceAction === device.id}
                        aria-label={`批准设备 ${device.name}`}
                      >
                        <Check size={14} />
                        批准
                      </button>
                      <button
                        type="button"
                        className={styles.rejectBtn}
                        onClick={() => requestConfirm(device.id, "reject")}
                        disabled={pendingDeviceAction === device.id}
                        aria-label={`拒绝设备 ${device.name}`}
                      >
                        <X size={14} />
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Active devices */}
            <div className={styles.activeSection}>
              <h3 className={styles.activeTitle}>
                <ShieldCheck size={14} />
                已激活设备 ({activeDevices.length})
              </h3>
              {activeDevices.length === 0 ? (
                <p className={styles.emptyText}>暂无已激活设备。</p>
              ) : (
                activeDevices.map((device) => {
                  const devStatus = deviceStatusLabel(device.status);
                  const isCurrentDevice = device.id === currentDeviceId;
                  return (
                    <div
                      key={device.id}
                      className={`${styles.deviceRow}${isCurrentDevice ? ` ${styles.currentDeviceRow}` : ""}`}
                    >
                      <div className={styles.deviceInfo}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {isCurrentDevice ? (
                            <Monitor size={14} style={{ color: "var(--color-primary)", flexShrink: 0 }} />
                          ) : (
                            <Smartphone size={14} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
                          )}
                          <strong className={isCurrentDevice ? styles.currentDeviceName : styles.deviceName}>
                            {device.name}
                          </strong>
                          {isCurrentDevice ? (
                            <span className={styles.currentDeviceBadge}>
                              当前设备
                            </span>
                          ) : null}
                          <span
                            className={styles.deviceBadge}
                            style={{ "--badge-color": devStatus.color } as React.CSSProperties}
                          >
                            {devStatus.text}
                          </span>
                        </div>
                        <div className={styles.deviceMeta}>
                          <Clock size={10} style={{ verticalAlign: -1 }} />{" "}
                          已注册
                        </div>
                      </div>
                      {/* Revoke button for non-current approved devices */}
                      {!isCurrentDevice && onRevokeDevice ? (
                        <div style={{ flexShrink: 0 }}>
                          <button
                            type="button"
                            className={styles.revokeBtn}
                            onClick={() => requestConfirm(device.id, "revoke")}
                            disabled={pendingDeviceAction === device.id}
                            aria-label={`撤销设备 ${device.name}`}
                          >
                            <ShieldOff size={13} />
                            撤销
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <p className={styles.emptyText}>
            {devices.length > 0
              ? `${devices.length} 台设备已注册。点击展开查看详情。`
              : "暂无注册设备。"}
          </p>
        )}
      </div>

      {/* Confirmation dialog */}
      {confirmAction && confirmDevice ? (
        <div
          className={styles.confirmOverlay}
          onClick={cancelConfirm}
        >
          <div
            className={styles.confirmDialog}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.confirmHeader}>
              <div
                className={styles.confirmIcon}
                style={{ "--confirm-icon-color": confirmMessages[confirmAction.action].color } as React.CSSProperties}
              >
                {confirmAction.action === "revoke" ? (
                  <ShieldOff size={18} style={{ color: confirmMessages[confirmAction.action].color }} />
                ) : confirmAction.action === "approve" ? (
                  <Check size={18} style={{ color: confirmMessages[confirmAction.action].color }} />
                ) : (
                  <X size={18} style={{ color: confirmMessages[confirmAction.action].color }} />
                )}
              </div>
              <h3 className={styles.confirmTitle}>
                {confirmMessages[confirmAction.action].title}
              </h3>
            </div>
            <p className={styles.confirmDesc}>
              {confirmMessages[confirmAction.action].desc}
            </p>
            {confirmAction.action === "revoke" ? (
              <div className={styles.confirmWarning}>
                <AlertTriangle size={14} />
                撤销后该设备将无法再同步任何数据
              </div>
            ) : null}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmCancel}
                onClick={cancelConfirm}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.confirmOk}
                style={{
                  background: confirmMessages[confirmAction.action].color,
                  color: confirmAction.action === "approve" ? "var(--color-text-inverse)" : "#fff",
                }}
                onClick={() => {
                  if (confirmAction.action === "approve") handleApprove(confirmAction.deviceId);
                  else if (confirmAction.action === "reject") handleReject(confirmAction.deviceId);
                  else handleRevoke(confirmAction.deviceId);
                }}
                disabled={pendingDeviceAction === confirmAction.deviceId}
              >
                {confirmAction.action === "revoke" ? "确认撤销" : "确认"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
