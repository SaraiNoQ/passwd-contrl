"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Monitor,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";
import type { TrustedDevice } from "@zero-vault/shared";
import { cn } from "../../lib/utils";
import type { DesktopCryptoAdapter } from "../../lib/crypto/desktop-crypto-adapter";
import styles from "./device-management-panel.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeviceManagementPanelProps = {
  /** List of trusted devices. */
  devices: TrustedDevice[];
  /** Current device ID for highlighting. */
  currentDeviceId?: string;
  /** CSRF token for API calls. */
  csrfToken: string;
  /** Crypto adapter for keypair generation and vault key encryption. */
  cryptoAdapter: DesktopCryptoAdapter;
  /** Register a new device (sends name + publicKey to server; privateKey remains local). */
  onRegister: (name: string, publicKey: string, privateKey?: string) => Promise<void>;
  /** Approve a pending device (encrypts vault key for the device, shares via API). */
  onApprove: (deviceId: string, encryptedVaultKey: string) => Promise<void>;
  /** Reject a pending device. */
  onReject: (deviceId: string) => Promise<void>;
  /** Revoke an approved device. */
  onRevoke: (deviceId: string) => Promise<void>;
  /** Vault key for encrypting when approving devices. */
  vaultKey?: Uint8Array;
  /** Whether currently loading. */
  loading?: boolean;
  /** Refresh device list. */
  onRefresh?: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusLabel(status: TrustedDevice["status"]): {
  text: string;
  badgeClass: string;
} {
  switch (status) {
    case "approved":
      return { text: "已信任", badgeClass: styles.badgeTrusted ?? "" };
    case "pending":
      return { text: "待确认", badgeClass: styles.badgePending ?? "" };
    case "revoked":
      return { text: "已撤销", badgeClass: styles.badgeRevoked ?? "" };
    case "rejected":
      return { text: "已拒绝", badgeClass: styles.badgeRevoked ?? "" };
    default:
      return { text: "未知", badgeClass: "" };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeviceManagementPanel({
  devices,
  currentDeviceId = "",
  csrfToken,
  cryptoAdapter,
  onRegister,
  onApprove,
  onReject,
  onRevoke,
  vaultKey,
  loading = false,
  onRefresh,
}: DeviceManagementPanelProps) {
  const [expandedDevice, setExpandedDevice] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    deviceId: string;
    action: "approve" | "reject" | "revoke" | "register";
  } | null>(null);
  const [registerName, setRegisterName] = useState("");

  const pendingDevices = devices.filter((d) => d.status === "pending");
  const activeDevices = devices.filter((d) => d.status === "approved");
  const inactiveDevices = devices.filter(
    (d) => d.status === "revoked" || d.status === "rejected",
  );

  // ── Toggle expanded ─────────────────────────────────────────────────────────

  const toggleExpanded = useCallback((deviceId: string) => {
    setExpandedDevice((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) {
        next.delete(deviceId);
      } else {
        next.add(deviceId);
      }
      return next;
    });
  }, []);

  // ── Register new device ─────────────────────────────────────────────────────

  const handleRegister = useCallback(async () => {
    if (!registerName.trim()) return;
    setPendingAction("register");
    try {
      // Generate X25519 keypair — private key stays on device
      const keypair = await cryptoAdapter.generateDeviceKeypair();
      const publicKeyB64 = uint8ArrayToBase64url(keypair.publicKey);
      const privateKeyB64 = uint8ArrayToBase64url(keypair.privateKey);
      await onRegister(registerName.trim(), publicKeyB64, privateKeyB64);
      setRegisterName("");
      setConfirmAction(null);
    } catch {
      // Error handled by caller
    } finally {
      setPendingAction(null);
    }
  }, [registerName, cryptoAdapter, onRegister]);

  // ── Approve device ──────────────────────────────────────────────────────────

  const handleApprove = useCallback(
    async (deviceId: string) => {
      if (!vaultKey) return;
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return;

      setPendingAction(deviceId);
      try {
        // Encrypt vault key for the target device using its public key
        const devicePubKey = base64urlToUint8Array(device.publicKey);
        const encryptedVaultKey =
          await cryptoAdapter.encryptVaultKeyForDevice(vaultKey, devicePubKey);
        const encryptedB64 = uint8ArrayToBase64url(encryptedVaultKey);
        await onApprove(deviceId, encryptedB64);
        setConfirmAction(null);
      } catch {
        // Error handled by caller
      } finally {
        setPendingAction(null);
      }
    },
    [vaultKey, devices, cryptoAdapter, onApprove],
  );

  // ── Reject device ───────────────────────────────────────────────────────────

  const handleReject = useCallback(
    async (deviceId: string) => {
      setPendingAction(deviceId);
      try {
        await onReject(deviceId);
        setConfirmAction(null);
      } catch {
        // Error handled by caller
      } finally {
        setPendingAction(null);
      }
    },
    [onReject],
  );

  // ── Revoke device ───────────────────────────────────────────────────────────

  const handleRevoke = useCallback(
    async (deviceId: string) => {
      setPendingAction(deviceId);
      try {
        await onRevoke(deviceId);
        setConfirmAction(null);
      } catch {
        // Error handled by caller
      } finally {
        setPendingAction(null);
      }
    },
    [onRevoke],
  );

  // ── Confirm dialog content ──────────────────────────────────────────────────

  const confirmDevice = confirmAction
    ? devices.find((d) => d.id === confirmAction.deviceId)
    : null;

  const confirmMessages: Record<
    string,
    { title: string; desc: string; warning?: string; danger: boolean }
  > = {
    approve: {
      title: "批准设备入链",
      desc: `确认允许「${confirmDevice?.name ?? ""}」成为可信设备？系统将使用该设备的公钥加密主密钥，加密后的密钥将通过服务器中转。`,
      danger: false,
    },
    reject: {
      title: "拒绝设备准入",
      desc: `确认拒绝「${confirmDevice?.name ?? ""}」的准入请求？该设备将无法加入同步链路。`,
      danger: false,
    },
    revoke: {
      title: "撤销设备密钥",
      desc: `确认撤销「${confirmDevice?.name ?? ""}」的节点密钥？该设备将立即失去同步能力。此操作不可轻易撤销。`,
      warning: "撤销后该设备将无法再接收任何新数据",
      danger: true,
    },
    register: {
      title: "注册新设备",
      desc: `将生成 X25519 密钥对，私钥仅保存在本设备。公钥「${registerName}」将发送至服务器进行注册。`,
      danger: false,
    },
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.eyebrow}>DEVICE TRUST</span>
          <h2 className={styles.heading}>设备信任管理</h2>
          <p className={styles.subheading}>
            管理已注册的可信设备节点。每台设备拥有独立的 X25519 密钥对，私钥永不离开设备。
          </p>
        </div>
        <button
          type="button"
          className={styles.registerButton}
          onClick={() =>
            setConfirmAction({ deviceId: "", action: "register" })
          }
          disabled={loading}
        >
          <Plus size={14} />
          注册新设备
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className={styles.loading} aria-live="polite" aria-busy="true">
          <div className={styles.loadingDots} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span>正在加载设备列表...</span>
        </div>
      )}

      {/* Pending devices */}
      {!loading && pendingDevices.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <AlertTriangle size={14} className={styles.sectionTitleIcon} />
            待确认设备 ({pendingDevices.length})
          </h3>
          <div className={styles.deviceList}>
            {pendingDevices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                isCurrent={false}
                expanded={expandedDevice.has(device.id)}
                onToggleExpand={toggleExpanded}
                onApprove={(id) =>
                  setConfirmAction({ deviceId: id, action: "approve" })
                }
                onReject={(id) =>
                  setConfirmAction({ deviceId: id, action: "reject" })
                }
                onRevoke={undefined}
                pendingAction={pendingAction}
              />
            ))}
          </div>
        </section>
      )}

      {/* Active devices */}
      {!loading && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <ShieldCheck size={14} className={styles.sectionTitleIcon} />
            已信任设备 ({activeDevices.length})
          </h3>
          {activeDevices.length > 0 ? (
            <div className={styles.deviceList}>
              {activeDevices.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  isCurrent={device.id === currentDeviceId}
                  expanded={expandedDevice.has(device.id)}
                  onToggleExpand={toggleExpanded}
                  onApprove={undefined}
                  onReject={undefined}
                  onRevoke={
                    device.id !== currentDeviceId
                      ? (id) =>
                          setConfirmAction({ deviceId: id, action: "revoke" })
                      : undefined
                  }
                  pendingAction={pendingAction}
                />
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>
                <Smartphone size={20} />
              </div>
              <h4 className={styles.emptyTitle}>暂无已信任设备</h4>
              <p className={styles.emptyText}>
                还没有设备通过信任验证。注册新设备以启用跨设备同步。
              </p>
            </div>
          )}
        </section>
      )}

      {/* Inactive devices */}
      {!loading && inactiveDevices.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <ShieldOff size={14} className={styles.sectionTitleIcon} />
            已撤销/已拒绝 ({inactiveDevices.length})
          </h3>
          <div className={styles.deviceList}>
            {inactiveDevices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                isCurrent={false}
                expanded={expandedDevice.has(device.id)}
                onToggleExpand={toggleExpanded}
                onApprove={undefined}
                onReject={undefined}
                onRevoke={undefined}
                pendingAction={pendingAction}
              />
            ))}
          </div>
        </section>
      )}

      {/* Confirm dialog */}
      {confirmAction && (
        <div
          className={styles.confirmOverlay}
          onClick={() => setConfirmAction(null)}
        >
          <div
            className={cn(
              styles.confirmDialog,
              confirmMessages[confirmAction.action]?.danger &&
                styles.confirmDialogDanger,
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby="device-confirm-title"
            aria-describedby="device-confirm-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.confirmHeader}>
              <div
                className={cn(
                  styles.confirmIcon,
                  confirmMessages[confirmAction.action]?.danger &&
                    styles.confirmIconDanger,
                )}
              >
                {confirmAction.action === "revoke" ? (
                  <ShieldOff size={18} />
                ) : confirmAction.action === "approve" ? (
                  <Check size={18} />
                ) : confirmAction.action === "register" ? (
                  <Plus size={18} />
                ) : (
                  <X size={18} />
                )}
              </div>
              <h3 className={styles.confirmTitle} id="device-confirm-title">
                {confirmMessages[confirmAction.action]?.title ?? "确认操作"}
              </h3>
            </div>
            {confirmAction.action === "register" ? (
              <div style={{ padding: "0 var(--space-5)" }}>
                <input
                  type="text"
                  placeholder="输入设备名称（如 MacBook Pro）"
                  value={registerName}
                  onChange={(e) => setRegisterName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "var(--space-2) var(--space-3)",
                    border: "1px solid var(--color-cloud-mist)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "var(--text-body-sm-size)",
                    color: "var(--color-text-primary)",
                    background: "var(--color-bg-input)",
                    outline: "none",
                  }}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && registerName.trim()) {
                      void handleRegister();
                    }
                  }}
                />
              </div>
            ) : (
              <p className={styles.confirmBody} id="device-confirm-desc">
                {confirmMessages[confirmAction.action]?.desc}
              </p>
            )}
            {confirmMessages[confirmAction.action]?.warning && (
              <div className={styles.confirmWarning}>
                <AlertTriangle size={14} />
                {confirmMessages[confirmAction.action]?.warning}
              </div>
            )}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => setConfirmAction(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={cn(
                  styles.confirmBtn,
                  confirmMessages[confirmAction.action]?.danger &&
                    styles.confirmBtnDanger,
                )}
                onClick={() => {
                  if (confirmAction.action === "register") {
                    void handleRegister();
                  } else if (confirmAction.action === "approve") {
                    void handleApprove(confirmAction.deviceId);
                  } else if (confirmAction.action === "reject") {
                    void handleReject(confirmAction.deviceId);
                  } else if (confirmAction.action === "revoke") {
                    void handleRevoke(confirmAction.deviceId);
                  }
                }}
                disabled={
                  pendingAction !== null ||
                  (confirmAction.action === "register" &&
                    !registerName.trim())
                }
              >
                {confirmAction.action === "revoke"
                  ? "确认撤销"
                  : confirmAction.action === "register"
                    ? "生成密钥并注册"
                    : "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Device card sub-component
// ---------------------------------------------------------------------------

type DeviceCardProps = {
  device: TrustedDevice;
  isCurrent: boolean;
  expanded: boolean;
  onToggleExpand: (deviceId: string) => void;
  onApprove?: ((deviceId: string) => void) | undefined;
  onReject?: ((deviceId: string) => void) | undefined;
  onRevoke?: ((deviceId: string) => void) | undefined;
  pendingAction: string | null;
};

function DeviceCard({
  device,
  isCurrent,
  expanded,
  onToggleExpand,
  onApprove,
  onReject,
  onRevoke,
  pendingAction,
}: DeviceCardProps) {
  const status = statusLabel(device.status);
  const isPending = device.status === "pending";
  const isRevoked = device.status === "revoked" || device.status === "rejected";

  return (
    <div
      className={cn(
        styles.deviceCard,
        isCurrent && styles.currentDevice,
        isPending && styles.pendingDevice,
        isRevoked && styles.revokedDevice,
      )}
    >
      <div className={styles.deviceInfo}>
        <div className={styles.deviceTitleRow}>
          {isCurrent ? (
            <Monitor size={14} className={styles.deviceIconCurrent} />
          ) : isPending ? (
            <Smartphone size={14} className={styles.deviceIconPending} />
          ) : isRevoked ? (
            <ShieldOff size={14} className={styles.deviceIconRevoked} />
          ) : (
            <Smartphone size={14} className={styles.deviceIcon} />
          )}
          <strong
            className={cn(
              styles.deviceName,
              isCurrent && styles.currentDeviceName,
            )}
          >
            {device.name}
          </strong>
          {isCurrent && (
            <span className={cn(styles.badge, styles.badgeCurrent)}>
              当前设备
            </span>
          )}
          <span className={cn(styles.badge, status.badgeClass)}>
            {status.text}
          </span>
        </div>

        <div className={styles.deviceMeta}>
          <Clock size={10} />
          注册于 {formatDateTime(device.createdAt)}
        </div>

        {/* Expandable details */}
        <button
          type="button"
          className={styles.expandButton}
          onClick={() => onToggleExpand(device.id)}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? "收起详情" : "查看详情"}
        </button>

        {expanded && (
          <div className={styles.detailsContent}>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>设备 ID</span>
              <span className={styles.detailValue}>{device.id}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>公钥</span>
              <span className={styles.detailValue}>
                {device.publicKey.slice(0, 24)}...
              </span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>创建时间</span>
              <span className={styles.detailValue}>
                {formatDateTime(device.createdAt)}
              </span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>更新时间</span>
              <span className={styles.detailValue}>
                {formatDateTime(device.updatedAt)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {(onApprove || onReject || onRevoke) && (
        <div className={styles.deviceActions}>
          {onApprove && (
            <button
              type="button"
              className={styles.approveButton}
              onClick={() => onApprove(device.id)}
              disabled={pendingAction === device.id}
              aria-label={`批准设备 ${device.name}`}
            >
              <Check size={13} />
              批准
            </button>
          )}
          {onReject && (
            <button
              type="button"
              className={styles.rejectButton}
              onClick={() => onReject(device.id)}
              disabled={pendingAction === device.id}
              aria-label={`拒绝设备 ${device.name}`}
            >
              <X size={13} />
              拒绝
            </button>
          )}
          {onRevoke && (
            <button
              type="button"
              className={styles.revokeButton}
              onClick={() => onRevoke(device.id)}
              disabled={pendingAction === device.id}
              aria-label={`撤销设备 ${device.name}`}
            >
              <ShieldOff size={13} />
              撤销
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Byte conversion helpers
// ---------------------------------------------------------------------------

function uint8ArrayToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlToUint8Array(b64: string): Uint8Array {
  const standard = b64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
