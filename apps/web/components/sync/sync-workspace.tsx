"use client";

import type { ReactNode } from "react";
import {
  Blocks,
  Check,
  Clock,
  LogIn,
  Laptop,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  WifiOff,
} from "lucide-react";
import type { ItemSyncInfo } from "../../lib/item-sync";
import { cn } from "../../lib/utils";
import styles from "./sync-workspace.module.css";

type ExtensionBridgeState = {
  configured: boolean;
  runtimeAvailable: boolean;
  communication: string;
  lastPublish: string;
  lastClear: string;
};

export type SyncWorkspaceProps = {
  syncStatus: string;
  lastSyncedAt: string | null;
  itemSyncInfos: ItemSyncInfo[];
  approvedDeviceCount: number;
  pendingDeviceCount: number;
  isOffline: boolean;
  loading: boolean;
  onSync: () => void;
  extensionBridge: ExtensionBridgeState;
  devicePanel: ReactNode;
  receiptPanel: ReactNode;
};

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function getRelayState(syncStatus: string, isOffline: boolean) {
  if (isOffline) {
    return { label: "同步离线", tone: "muted" as const, icon: WifiOff };
  }
  if (syncStatus.includes("冲突")) {
    return { label: "检测到冲突", tone: "warning" as const, icon: Blocks };
  }
  if (syncStatus.includes("同步中")) {
    return { label: "同步中", tone: "active" as const, icon: RefreshCw };
  }
  if (syncStatus.includes("已同步") || syncStatus.includes("版本")) {
    return { label: "已同步", tone: "success" as const, icon: Check };
  }
  return { label: "尚未同步", tone: "muted" as const, icon: Clock };
}

export default function SyncWorkspace({
  syncStatus,
  lastSyncedAt,
  itemSyncInfos,
  approvedDeviceCount,
  pendingDeviceCount,
  isOffline,
  loading,
  onSync,
  extensionBridge,
  devicePanel,
  receiptPanel,
}: SyncWorkspaceProps) {
  const relayState = getRelayState(syncStatus, isOffline);
  const RelayIcon = relayState.icon;
  const syncedCount = itemSyncInfos.filter((item) => item.status === "synced").length;
  const pendingCount = itemSyncInfos.filter((item) => item.status === "pending").length;
  const conflictCount = itemSyncInfos.filter((item) => item.status === "conflict").length;

  return (
    <section className={styles.workspace} aria-labelledby="sync-workspace-title">
      <div className={styles.relayMap}>
        <span className={styles.pixelCloudA} aria-hidden="true" />
        <span className={styles.pixelCloudB} aria-hidden="true" />

        <div className={styles.mapIntro}>
          <span className={styles.eyebrow}>DEVICE SYNC / 04</span>
          <h2 id="sync-workspace-title">设备同步地图</h2>
          <p>
            明文密码只在你的设备上解锁。Obscura 只同步加密后的更新、授权状态和同步状态。
          </p>
        </div>

        <button
          type="button"
          className={styles.syncAction}
          onClick={onSync}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? styles.spinning : undefined} />
          {loading ? "正在同步" : "立即同步"}
        </button>

        <div className={styles.topology} aria-label="本地密码库到可信设备的同步路径">
          <article className={styles.topologyNode}>
            <span className={styles.nodeIndex}>01</span>
            <span className={styles.nodeIcon}><ShieldCheck size={20} /></span>
            <span className={styles.nodeLabel}>本地密码库</span>
            <strong>{itemSyncInfos.length} 条密码记录</strong>
            <small>明文只在解锁后显示</small>
          </article>

          <span className={styles.connector} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>

          <article className={cn(styles.topologyNode, styles.relayNode)}>
            <span className={styles.nodeIndex}>02</span>
            <span className={cn(styles.nodeIcon, styles[`tone${relayState.tone}`])}>
              <RelayIcon size={20} />
            </span>
            <span className={styles.nodeLabel}>加密同步</span>
            <strong>{relayState.label}</strong>
            <small>{syncStatus}</small>
          </article>

          <span className={styles.connector} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>

          <article className={styles.topologyNode}>
            <span className={styles.nodeIndex}>03</span>
            <span className={styles.nodeIcon}><Smartphone size={20} /></span>
            <span className={styles.nodeLabel}>可信设备</span>
            <strong>{approvedDeviceCount} 台设备</strong>
            <small>{pendingDeviceCount > 0 ? `${pendingDeviceCount} 台等待授权` : "没有待授权设备"}</small>
          </article>

          <span className={styles.connector} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>

          <article className={styles.topologyNode}>
            <span className={styles.nodeIndex}>04</span>
            <span className={styles.nodeIcon}><Laptop size={20} /></span>
            <span className={styles.nodeLabel}>浏览器桥</span>
            <strong>
              {extensionBridge.runtimeAvailable
                ? extensionBridge.communication
                : extensionBridge.configured
                  ? "等待连接"
                  : "尚未配置"}
            </strong>
            <small>只接收授权后的自动填充数据</small>
          </article>
        </div>

        <div className={styles.mapFooter}>
          <span>
            <Check size={13} />
            已同步 {syncedCount}
          </span>
          <span>
            <Clock size={13} />
            待同步 {pendingCount}
          </span>
          {conflictCount > 0 ? (
            <span className={styles.warning}>
              <Blocks size={13} />
              冲突 {conflictCount}
            </span>
          ) : null}
          <span className={styles.lastReceipt}>
            {lastSyncedAt ? `上次同步 ${formatDateTime(lastSyncedAt)}` : "尚未同步到其他设备"}
          </span>
        </div>
      </div>

      <div className={styles.bayGrid}>
        <div className={styles.deviceBay}>
          {devicePanel ?? (
            <div className={styles.authGate}>
              <span><LogIn size={18} /></span>
              <div>
                <strong>设备授权暂不可用</strong>
                <p>登录后才能批准、拒绝或撤销可信设备。</p>
              </div>
            </div>
          )}
        </div>
        <div className={styles.receiptBay}>{receiptPanel}</div>
        <aside className={styles.bridgeBay} aria-labelledby="bridge-bay-title">
          <div className={styles.bayHeader}>
            <div>
              <span>浏览器扩展 / 03</span>
              <h3 id="bridge-bay-title">浏览器桥</h3>
            </div>
            <span
              className={cn(
                styles.bridgeSignal,
                extensionBridge.runtimeAvailable && styles.bridgeSignalLive,
              )}
            >
              {extensionBridge.runtimeAvailable ? "在线" : "静默"}
            </span>
          </div>

          {!extensionBridge.configured || !extensionBridge.runtimeAvailable ? (
            <p className={styles.bridgeNotice}>
              未检测到可用扩展，自动填充同步保持关闭。
            </p>
          ) : (
            <p className={styles.bridgeNotice}>
              扩展已接入，只会接收当前会话授权的自动填充数据。
            </p>
          )}

          <dl className={styles.bridgeLedger}>
            <div>
              <dt>扩展授权</dt>
              <dd>{extensionBridge.configured ? "已配置" : "缺失"}</dd>
            </div>
            <div>
              <dt>通信状态</dt>
              <dd>{extensionBridge.runtimeAvailable ? extensionBridge.communication : "不可用"}</dd>
            </div>
            <div>
              <dt>最近发布</dt>
              <dd>{extensionBridge.lastPublish}</dd>
            </div>
            <div>
              <dt>最近清空</dt>
              <dd>{extensionBridge.lastClear}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
