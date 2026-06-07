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
    return { label: "链路离线", tone: "muted" as const, icon: WifiOff };
  }
  if (syncStatus.includes("冲突")) {
    return { label: "检测到分叉", tone: "warning" as const, icon: Blocks };
  }
  if (syncStatus.includes("同步中")) {
    return { label: "区块投递中", tone: "active" as const, icon: RefreshCw };
  }
  if (syncStatus.includes("已同步") || syncStatus.includes("版本")) {
    return { label: "回执已确认", tone: "success" as const, icon: Check };
  }
  return { label: "等待首枚回执", tone: "muted" as const, icon: Clock };
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
          <span className={styles.eyebrow}>NODE RELAY / 04</span>
          <h2 id="sync-workspace-title">节点中继地图</h2>
          <p>
            明文停留在设备边界内。Obscura 只把加密修订、授权状态与同步回执送入这条节点链。
          </p>
        </div>

        <button
          type="button"
          className={styles.syncAction}
          onClick={onSync}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? styles.spinning : undefined} />
          {loading ? "正在取得回执" : "立即取得回执"}
        </button>

        <div className={styles.topology} aria-label="本地密码库到可信设备的同步路径">
          <article className={styles.topologyNode}>
            <span className={styles.nodeIndex}>01</span>
            <span className={styles.nodeIcon}><ShieldCheck size={20} /></span>
            <span className={styles.nodeLabel}>本地密码库</span>
            <strong>{itemSyncInfos.length} 枚密文</strong>
            <small>明文只在此处显形</small>
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
            <span className={styles.nodeLabel}>加密中继</span>
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
            <strong>{approvedDeviceCount} 个节点</strong>
            <small>{pendingDeviceCount > 0 ? `${pendingDeviceCount} 个等待准入` : "准入队列为空"}</small>
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
            <small>只接收自动填充密文</small>
          </article>
        </div>

        <div className={styles.mapFooter}>
          <span>
            <Check size={13} />
            已确认 {syncedCount}
          </span>
          <span>
            <Clock size={13} />
            待打包 {pendingCount}
          </span>
          {conflictCount > 0 ? (
            <span className={styles.warning}>
              <Blocks size={13} />
              分叉 {conflictCount}
            </span>
          ) : null}
          <span className={styles.lastReceipt}>
            {lastSyncedAt ? `上次回执 ${formatDateTime(lastSyncedAt)}` : "尚未取得远端回执"}
          </span>
        </div>
      </div>

      <div className={styles.bayGrid}>
        <div className={styles.deviceBay}>
          {devicePanel ?? (
            <div className={styles.authGate}>
              <span><LogIn size={18} /></span>
              <div>
                <strong>设备准入舱保持封闭</strong>
                <p>登录身份节点后，才能批准、拒绝或撤销可信设备。</p>
              </div>
            </div>
          )}
        </div>
        <div className={styles.receiptBay}>{receiptPanel}</div>
        <aside className={styles.bridgeBay} aria-labelledby="bridge-bay-title">
          <div className={styles.bayHeader}>
            <div>
              <span>边缘节点 / 03</span>
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
              未检测到可用扩展，自动填充链路保持关闭。
            </p>
          ) : (
            <p className={styles.bridgeNotice}>
              扩展已接入，只会接收当前会话授权的自动填充密文。
            </p>
          )}

          <dl className={styles.bridgeLedger}>
            <div>
              <dt>扩展密钥</dt>
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
