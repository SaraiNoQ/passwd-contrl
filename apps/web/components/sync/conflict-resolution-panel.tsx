"use client";

import { AlertTriangle, ChevronDown, ChevronUp, Clock, Copy, Download, GitMerge, RefreshCw, SkipForward } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "../ui/button";
import { Modal } from "../ui/modal";
import styles from "./conflict-resolution-panel.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConflictItem = {
  itemId: string;
  title: string;
  reason: string;
  localRevision: number | undefined;
  serverRevision: number | undefined;
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
  /** Optional: local version field data for side-by-side comparison */
  localFields?: Record<string, string>;
  /** Optional: remote version field data for side-by-side comparison */
  remoteFields?: Record<string, string>;
};

export type ConflictAction = "keep-local" | "accept-remote" | "create-copy" | "skip";

export type ConflictResolutionPanelProps = {
  conflicts: ConflictItem[];
  onResolve: (itemId: string, action: ConflictAction) => void;
  onResolveAll: (action: ConflictAction) => void;
  /** Optional: whether currently loading */
  loading?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reasonLabel(reason: string): string {
  switch (reason) {
    case "server_revision_advanced":
      return "云端已更新";
    case "item_revision_advanced":
      return "本地版本更新";
    case "item_owner_mismatch":
      return "所有者不匹配";
    default:
      return "版本冲突";
  }
}

function actionLabel(action: ConflictAction): string {
  switch (action) {
    case "keep-local":
      return "保留本地版本";
    case "accept-remote":
      return "采用云端版本";
    case "create-copy":
      return "创建副本";
    case "skip":
      return "跳过此项";
  }
}


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConflictResolutionPanel({
  conflicts,
  onResolve,
  onResolveAll,
  loading = false
}: ConflictResolutionPanelProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState<ConflictAction | null>(null);
  const [expandedComparison, setExpandedComparison] = useState<Set<string>>(new Set());

  const isEmpty = conflicts.length === 0;

  const handleAction = useCallback(
    (itemId: string, action: ConflictAction) => {
      setPendingAction(`${itemId}:${action}`);
      onResolve(itemId, action);
      setTimeout(() => setPendingAction(null), 500);
    },
    [onResolve]
  );

  const handleBulkAction = useCallback(
    (action: ConflictAction) => {
      setShowBulkConfirm(action);
    },
    []
  );

  const confirmBulkAction = useCallback(() => {
    if (showBulkConfirm) {
      onResolveAll(showBulkConfirm);
      setShowBulkConfirm(null);
    }
  }, [showBulkConfirm, onResolveAll]);

  const cancelBulkAction = useCallback(() => {
    setShowBulkConfirm(null);
  }, []);

  const toggleComparison = useCallback((itemId: string) => {
    setExpandedComparison((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  if (isEmpty) {
    return (
      <div className={styles.card}>
        <div className={styles.empty}>
          <span className={styles.emptyMap} aria-hidden="true" />
          <span className={styles.emptyIcon}>
            <GitMerge size={24} />
          </span>
          <h2 className={styles.emptyTitle}>冲突列表为空</h2>
          <p className={styles.emptyText}>当前没有需要仲裁的同步冲突，所有加密数据都停在同一条同步上。</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <span className={styles.kicker}>冲突冲突仲裁</span>
          <h2 className={styles.title}>
            <span className={styles.titleIcon}>
              <AlertTriangle size={18} />
            </span>
            加密内容冲突仲裁台
          </h2>
        </div>
        <span className={styles.badge}>
          {conflicts.length} 条冲突
        </span>
      </div>

      <p className={styles.description}>
        以下密码数据在本地节点与云端节点同时发生修改。请为每条冲突选择仲裁方式，系统不会自动覆盖任何版本。
      </p>
      <div className={styles.forkMap} aria-hidden="true">
        <span className={styles.forkNode} />
        <span className={styles.forkLine} />
        <span className={styles.forkNode} />
        <span className={styles.forkLine} />
        <span className={styles.forkNodeActive} />
      </div>

      {/* Bulk actions */}
      <div className={styles.bulkBar}>
        <span className={styles.bulkLabel}>批量仲裁：</span>
        <button
          type="button"
          className={`${styles.bulkBtn} ${styles.bulkKeepLocal}`}
          onClick={() => handleBulkAction("keep-local")}
          disabled={loading}
        >
          全部保留本地版本
        </button>
        <button
          type="button"
          className={`${styles.bulkBtn} ${styles.bulkAcceptRemote}`}
          onClick={() => handleBulkAction("accept-remote")}
          disabled={loading}
        >
          全部采用云端版本
        </button>
      </div>

      <Modal
        open={Boolean(showBulkConfirm)}
        onClose={cancelBulkAction}
        title="批量仲裁确认"
        eyebrow="FORK ARBITRATION / 冲突仲裁"
        status={`${conflicts.length} 条冲突等待写入决议`}
        footer={
          <>
            <Button variant="secondary" onClick={cancelBulkAction} disabled={loading}>
              取消
            </Button>
            <Button onClick={confirmBulkAction} loading={loading}>
              确认仲裁
            </Button>
          </>
        }
      >
        <div className={styles.arbitrationConfirmBody}>
          <span className={styles.arbitrationConfirmIcon} aria-hidden="true">
            <AlertTriangle size={20} />
          </span>
          <p className={styles.arbitrationConfirmText}>
            确认对 {conflicts.length} 条冲突执行
            「{showBulkConfirm ? actionLabel(showBulkConfirm) : "等待选择"}」？
            该操作会逐项触发当前冲突处理同步。
          </p>
          <div className={styles.arbitrationPath} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
      </Modal>

      {/* Conflict list */}
      <div className={styles.conflictList} role="list" aria-label="冲突冲突列表">
        {conflicts.map((conflict) => {
          const isExpanded = expandedComparison.has(conflict.itemId);
          const hasComparison = conflict.localFields || conflict.remoteFields;
          const comparisonId = `conflict-comparison-${conflict.itemId}`;
          const allFieldKeys = hasComparison
            ? Array.from(
                new Set([
                  ...Object.keys(conflict.localFields ?? {}),
                  ...Object.keys(conflict.remoteFields ?? {})
                ])
              )
            : [];

          return (
            <div key={conflict.itemId} className={styles.conflictItem} role="listitem">
              {/* Item info header */}
              <div className={styles.conflictHeader}>
                <div className={styles.conflictTitleRow}>
                  <span className={styles.conflictIcon}>
                    <PixelForkRecordIcon />
                  </span>
                  <strong className={styles.conflictTitle}>
                    {conflict.title}
                  </strong>
                  <span className={styles.conflictBadge}>{reasonLabel(conflict.reason)}</span>
                </div>

                {/* Revisions and timestamps */}
                <div className={styles.conflictMeta}>
                  <span>本地版本：v{conflict.localRevision ?? "?"}</span>
                  <span>云端版本：v{conflict.serverRevision ?? "?"}</span>
                  {conflict.localUpdatedAt ? (
                    <span className={styles.conflictTimestamp}>
                      <Clock size={10} />
                      本地：{formatTime(conflict.localUpdatedAt)}
                    </span>
                  ) : null}
                  {conflict.remoteUpdatedAt ? (
                    <span className={styles.conflictTimestamp}>
                      <Clock size={10} />
                      云端：{formatTime(conflict.remoteUpdatedAt)}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Comparison toggle */}
              {hasComparison ? (
                <div className={styles.toggleCompareWrapper}>
                  <button
                    type="button"
                    className={styles.toggleCompareBtn}
                    onClick={() => toggleComparison(conflict.itemId)}
                    aria-expanded={isExpanded}
                    aria-controls={comparisonId}
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {isExpanded ? "收起冲突对比" : "展开冲突对比"}
                  </button>
                </div>
              ) : null}

              {/* Side-by-side comparison */}
              {hasComparison && isExpanded ? (
                <div className={styles.comparisonGrid} id={comparisonId}>
                  {/* Comparison header */}
                  <div className={styles.comparisonHeader}>
                    <div className={styles.localHeader}>
                      <Download size={12} />
                      本地版本
                    </div>
                    <div className={styles.remoteHeader}>
                      <RefreshCw size={12} />
                      云端版本
                    </div>
                  </div>
                  {/* Comparison rows */}
                  {allFieldKeys.map((fieldKey) => {
                    const localVal = conflict.localFields?.[fieldKey] ?? "";
                    const remoteVal = conflict.remoteFields?.[fieldKey] ?? "";
                    const isDifferent = localVal !== remoteVal;
                    return (
                      <div key={fieldKey} className={styles.comparisonRow}>
                        <div className={styles.comparisonCell}>
                          <div className={styles.mobileVersionLabel}>本地版本</div>
                          <div className={styles.fieldName}>{fieldKey}</div>
                          <div
                            className={`${styles.fieldValue} ${isDifferent ? styles.fieldDiff : ""}`}
                          >
                            {localVal || <span className={styles.emptyValue}>(空)</span>}
                          </div>
                        </div>
                        <div className={styles.comparisonCell}>
                          <div className={styles.mobileVersionLabel}>云端版本</div>
                          <div className={styles.fieldName}>{fieldKey}</div>
                          <div
                            className={`${styles.fieldValue} ${isDifferent ? styles.fieldDiff : ""}`}
                          >
                            {remoteVal || <span className={styles.emptyValue}>(空)</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {/* Action buttons */}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.keepLocalBtn}`}
                  onClick={() => handleAction(conflict.itemId, "keep-local")}
                  disabled={loading || pendingAction === `${conflict.itemId}:keep-local`}
                  title="使用本地版本覆盖云端"
                  aria-label={`保留本地版本：${conflict.title}`}
                >
                  <Download size={13} />
                  保留本地版本
                </button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.acceptRemoteBtn}`}
                  onClick={() => handleAction(conflict.itemId, "accept-remote")}
                  disabled={loading || pendingAction === `${conflict.itemId}:accept-remote`}
                  title="使用云端版本覆盖本地"
                  aria-label={`采用云端版本：${conflict.title}`}
                >
                  <RefreshCw size={13} />
                  采用云端版本
                </button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.createCopyBtn}`}
                  onClick={() => handleAction(conflict.itemId, "create-copy")}
                  disabled={loading || pendingAction === `${conflict.itemId}:create-copy`}
                  title="保留两个版本作为独立条目"
                  aria-label={`创建副本：${conflict.title}`}
                >
                  <Copy size={13} />
                  创建副本
                </button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.skipBtn}`}
                  onClick={() => handleAction(conflict.itemId, "skip")}
                  disabled={loading || pendingAction === `${conflict.itemId}:skip`}
                  title="暂不处理此冲突"
                  aria-label={`跳过此项：${conflict.title}`}
                >
                  <SkipForward size={13} />
                  跳过此项
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PixelForkRecordIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
    >
      <rect x="1" y="2" width="5" height="5" fill="#e3f1fe" />
      <rect x="2" y="3" width="3" height="3" fill="#ffffff" />
      <rect x="10" y="2" width="5" height="5" fill="#ff5e24" />
      <rect x="11" y="3" width="3" height="3" fill="#ffffff" opacity="0.75" />
      <rect x="6" y="4" width="4" height="2" fill="#5c6066" />
      <rect x="7" y="6" width="2" height="4" fill="#5c6066" />
      <rect x="5" y="10" width="6" height="2" fill="#5c6066" />
      <rect x="5" y="12" width="6" height="3" fill="#ffffff" />
      <rect x="6" y="13" width="4" height="1" fill="#ff5e24" />
    </svg>
  );
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
