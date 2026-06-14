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
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Modal } from "../ui/modal";
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
  /** Render as a functional bay inside SyncWorkspace without duplicate hero/status CTA. */
  embedded?: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type SyncStatusLabel = "synced" | "pending" | "conflict" | "offline" | "failed" | "unknown";
type StatusTone = "success" | "warning" | "danger" | "muted";

const STATUS_CONFIG: Record<SyncStatusLabel, { label: string; tone: StatusTone; icon: typeof Check }> = {
  synced: { label: "已同步", tone: "success", icon: Check },
  pending: { label: "待同步", tone: "warning", icon: Clock },
  conflict: { label: "有冲突", tone: "danger", icon: AlertTriangle },
  offline: { label: "离线", tone: "muted", icon: WifiOff },
  failed: { label: "同步失败", tone: "danger", icon: X },
  unknown: { label: "等待状态", tone: "muted", icon: RefreshCw }
};

const TONE_CLASS: Record<StatusTone, string> = {
  success: styles.toneSuccess ?? "",
  warning: styles.toneWarning ?? "",
  danger: styles.toneDanger ?? "",
  muted: styles.toneMuted ?? ""
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveSyncStatus(statusStr: string, isOffline: boolean): SyncStatusLabel {
  if (isOffline) return "offline";
  // Chinese keywords
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

function deviceStatusLabel(status: DeviceInfo["status"]): { text: string; tone: StatusTone } {
  switch (status) {
    case "approved":
      return { text: "已连接", tone: "success" };
    case "pending":
      return { text: "待确认", tone: "warning" };
    case "rejected":
      return { text: "已拒绝", tone: "danger" };
    case "revoked":
      return { text: "已撤销", tone: "danger" };
    default:
      return { text: "未知", tone: "muted" };
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
  syncStatus = "仅本地",
  lastSyncedAt = null,
  itemSyncInfos = [],
  devices = [],
  currentDeviceId = "",
  loading = false,
  isOffline = false,
  onRefreshDevices,
  embedded = false
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
  const confirmMessages: Record<typeof confirmAction extends null ? never : NonNullable<typeof confirmAction>["action"], { title: string; desc: string }> = {
    approve: {
      title: "批准加入同步",
      desc: `确认允许「${confirmDevice?.name ?? ""}」成为可信设备？它将只能同步加密后的密码数据。`
    },
    reject: {
      title: "拒绝设备授权",
      desc: `确认拒绝「${confirmDevice?.name ?? ""}」的准入请求？该设备将无法加入同步连接。`
    },
    revoke: {
      title: "撤销设备授权",
      desc: `确认撤销「${confirmDevice?.name ?? ""}」的设备授权？该设备将立即失去同步能力，本地数据不会被删除，但无法再接收新记录。此操作不可轻易撤销。`
    }
  };

  return (
    <div className={cn(styles.wrapper, embedded && styles.embeddedWrapper)}>
      {/* Sync status card */}
      {!embedded ? (
        <div className={styles.relayHero}>
          <PixelRelayCloud />
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.displayMark}>设备授权</span>
              <h2 className={styles.cardTitle}>可信设备</h2>
              <p className={styles.cardIntro}>
                管理可以同步密码库的设备。只同步加密后的密码数据，不暴露明文密码。
              </p>
            </div>
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
          </div>

          <div className={styles.statusDisplay}>
            <div className={cn(styles.statusIconBlock, TONE_CLASS[statusConfig.tone])}>
              <StatusIcon size={22} />
            </div>
            <div>
              <div className={cn(styles.statusText, TONE_CLASS[statusConfig.tone])}>
                {statusConfig.label}
              </div>
              <div className={styles.statusSubtext}>{syncStatus}</div>
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
                <span className={cn(styles.dot, styles.dotSuccess)} />
                <span>已确认 {syncedCount}</span>
              </div>
              <div className={styles.dotStat}>
                <span className={cn(styles.dot, styles.dotWarning)} />
                <span>待打包 {pendingCount}</span>
              </div>
              {conflictCount > 0 ? (
                <div className={styles.dotStat}>
                  <span className={cn(styles.dot, styles.dotDanger)} />
                  <span>冲突 {conflictCount}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Trusted devices */}
      <div className={cn(styles.card, embedded && styles.embeddedCard)}>
        <div className={styles.deviceHeader}>
          <div>
            <span className={styles.cardEyebrow}>准入网关</span>
            <h2 className={styles.sectionTitle}>设备清单</h2>
          </div>
          <button
            type="button"
            className={styles.deviceToggle}
            onClick={toggleDevices}
            aria-expanded={showDevices}
            aria-controls="trusted-device-network"
          >
            <Smartphone size={14} />
            {showDevices ? "收起" : "展开"}
          </button>
        </div>
        <div className={styles.nodeAccessRail} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>

        {showDevices ? (
          <div id="trusted-device-network">
            {/* Pending device requests */}
            {pendingDevices.length > 0 ? (
              <div className={styles.pendingSection}>
                <h3 className={styles.pendingTitle}>
                  <AlertTriangle size={14} />
                  待准入节点 ({pendingDevices.length})
                </h3>
                {pendingDevices.map((device) => (
                  <div key={device.id} className={styles.deviceRow}>
                    <div className={styles.deviceInfo}>
                      <div className={styles.deviceTitleLine}>
                        <Smartphone size={14} className={styles.deviceIconWarning} />
                        <strong className={styles.deviceName}>
                          {device.name}
                        </strong>
                        <span className={styles.deviceBadgeWarning}>
                          待准入
                        </span>
                      </div>
                      <div className={styles.deviceMeta}>
                        <Clock size={10} />
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
                        aria-label={`批准加入同步 ${device.name}`}
                      >
                        <Check size={14} />
                        批准加入
                      </button>
                      <button
                        type="button"
                        className={styles.rejectBtn}
                        onClick={() => requestConfirm(device.id, "reject")}
                        disabled={pendingDeviceAction === device.id}
                        aria-label={`拒绝设备授权 ${device.name}`}
                      >
                        <X size={14} />
                        拒绝准入
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
                已激活节点 ({activeDevices.length})
              </h3>
              {activeDevices.length === 0 ? (
                <p className={styles.emptyText}>暂无已激活节点，当前同步连接还没有可用设备。</p>
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
                        <div className={styles.deviceTitleLine}>
                          {isCurrentDevice ? (
                            <Monitor size={14} className={styles.deviceIconCurrent} />
                          ) : (
                            <Smartphone size={14} className={styles.deviceIconMuted} />
                          )}
                          <strong className={isCurrentDevice ? styles.currentDeviceName : styles.deviceName}>
                            {device.name}
                          </strong>
                          {isCurrentDevice ? (
                            <span className={styles.currentDeviceBadge}>
                              当前节点
                            </span>
                          ) : null}
                          <span className={cn(styles.deviceBadge, TONE_CLASS[devStatus.tone])}>
                            {devStatus.text}
                          </span>
                        </div>
                        <div className={styles.deviceMeta}>
                          <Clock size={10} />
                          已写入设备列表
                        </div>
                      </div>
                      {/* Revoke button for non-current approved devices */}
                      {!isCurrentDevice && onRevokeDevice ? (
                        <div className={styles.revokeWrap}>
                          <button
                            type="button"
                            className={styles.revokeBtn}
                            onClick={() => requestConfirm(device.id, "revoke")}
                            disabled={pendingDeviceAction === device.id}
                            aria-label={`撤销设备授权 ${device.name}`}
                          >
                            <ShieldOff size={13} />
                            撤销节点
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
              ? `${devices.length} 台设备已写入设备列表。点击展开查看节点详情。`
              : "暂无注册设备。"}
          </p>
        )}
      </div>

      <Modal
        open={Boolean(confirmAction && confirmDevice)}
        onClose={cancelConfirm}
        title={confirmAction ? confirmMessages[confirmAction.action].title : "设备授权确认"}
        eyebrow={
          confirmAction?.action === "approve"
            ? "NODE ACCESS / 设备授权"
            : confirmAction?.action === "reject"
              ? "ACCESS DENIED / 拒绝加入"
              : "DEVICE REVOKE / 撤销设备"
        }
        status={confirmDevice ? `目标节点：${confirmDevice.name}` : "正在读取目标节点"}
        footer={
          confirmAction ? (
            <>
              <Button variant="secondary" onClick={cancelConfirm}>
                取消
              </Button>
              <Button
                variant={confirmAction.action === "approve" ? "primary" : "danger"}
                onClick={() => {
                  if (confirmAction.action === "approve") handleApprove(confirmAction.deviceId);
                  else if (confirmAction.action === "reject") handleReject(confirmAction.deviceId);
                  else handleRevoke(confirmAction.deviceId);
                }}
                disabled={pendingDeviceAction === confirmAction.deviceId}
              >
                {confirmAction.action === "revoke" ? "确认撤销" : "确认"}
              </Button>
            </>
          ) : null
        }
      >
        {confirmAction ? (
          <div className={styles.nodeConfirmBody}>
            <div
              className={cn(
                styles.nodeConfirmGlyph,
                confirmAction.action !== "approve" && styles.nodeConfirmGlyphDanger,
              )}
              aria-hidden="true"
            >
              {confirmAction.action === "revoke" ? (
                <ShieldOff size={22} />
              ) : confirmAction.action === "approve" ? (
                <Check size={22} />
              ) : (
                <X size={22} />
              )}
            </div>
            <p className={styles.nodeConfirmDescription}>
              {confirmMessages[confirmAction.action].desc}
            </p>
            {confirmAction.action === "revoke" ? (
              <div className={styles.nodeConfirmWarning} role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                撤销后该设备将无法再接收任何新记录
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function PixelRelayCloud() {
  return (
    <svg
      aria-hidden="true"
      className={styles.relayCloud}
      viewBox="0 0 176 88"
      shapeRendering="crispEdges"
    >
      <path d="M24 52h16V36h16V20h48v8h16v8h24v16h16v20H24z" fill="#e3f1fe" />
      <path d="M40 52h16V36h16V28h32v8h24v16h16v12H40z" fill="#ffffff" />
      <rect x="56" y="52" width="16" height="8" fill="#ff5e24" />
      <rect x="80" y="44" width="16" height="8" fill="#5c6066" />
      <rect x="104" y="52" width="16" height="8" fill="#ff5e24" />
      <rect x="68" y="60" width="40" height="4" fill="#5c6066" />
    </svg>
  );
}
