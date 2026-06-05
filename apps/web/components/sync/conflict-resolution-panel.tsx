"use client";

import { AlertTriangle, ChevronDown, ChevronUp, Clock, Copy, Download, FileText, GitMerge, RefreshCw, SkipForward } from "lucide-react";
import { useCallback, useState } from "react";
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
      <div className={`${styles.card} pixel-border pixel-scanlines`}>
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <GitMerge size={24} />
          </span>
          <p className={styles.emptyText}>无冲突需要解决</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.card} pixel-border pixel-scanlines`}>
      {/* Header */}
      <div className={styles.header}>
        <h2 className={styles.title}>
          <span className={styles.titleIcon}>
            <AlertTriangle size={18} />
          </span>
          冲突解决
          <span className={styles.badge}>
            {conflicts.length}
          </span>
        </h2>
      </div>

      <p className={styles.description}>
        以下条目在本地和云端均有修改。请为每项选择处理方式，冲突解决不会自动覆盖任何版本。
      </p>

      {/* Bulk actions */}
      <div className={styles.bulkBar}>
        <span className={styles.bulkLabel}>批量操作：</span>
        <button
          type="button"
          className={`${styles.bulkBtn} ${styles.bulkKeepLocal}`}
          onClick={() => handleBulkAction("keep-local")}
          disabled={loading}
        >
          全部保留本地
        </button>
        <button
          type="button"
          className={`${styles.bulkBtn} ${styles.bulkAcceptRemote}`}
          onClick={() => handleBulkAction("accept-remote")}
          disabled={loading}
        >
          全部采用云端
        </button>
      </div>

      {/* Bulk confirm dialog */}
      {showBulkConfirm ? (
        <div className={styles.bulkConfirm}>
          <span className={styles.bulkConfirmText}>
            确认对 {conflicts.length} 项冲突执行「{actionLabel(showBulkConfirm)}」？
          </span>
          <div className={styles.bulkConfirmActions}>
            <button
              type="button"
              className={styles.confirmOkBtn}
              onClick={confirmBulkAction}
            >
              确认
            </button>
            <button
              type="button"
              className={styles.confirmCancelBtn}
              onClick={cancelBulkAction}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {/* Conflict list */}
      <div>
        {conflicts.map((conflict) => {
          const isExpanded = expandedComparison.has(conflict.itemId);
          const hasComparison = conflict.localFields || conflict.remoteFields;
          const allFieldKeys = hasComparison
            ? Array.from(
                new Set([
                  ...Object.keys(conflict.localFields ?? {}),
                  ...Object.keys(conflict.remoteFields ?? {})
                ])
              )
            : [];

          return (
            <div key={conflict.itemId} className={styles.conflictItem}>
              {/* Item info header */}
              <div className={styles.conflictHeader}>
                <div className={styles.conflictTitleRow}>
                  <span className={styles.conflictIcon}>
                    <FileText size={14} />
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
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {isExpanded ? "收起对比" : "展开对比"}
                  </button>
                </div>
              ) : null}

              {/* Side-by-side comparison */}
              {hasComparison && isExpanded ? (
                <div className={styles.comparisonGrid}>
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
                          <div className={styles.fieldName}>{fieldKey}</div>
                          <div
                            className={`${styles.fieldValue} ${isDifferent ? styles.fieldDiff : ""}`}
                          >
                            {localVal || <span className={styles.emptyValue}>(空)</span>}
                          </div>
                        </div>
                        <div className={styles.comparisonCell}>
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

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
