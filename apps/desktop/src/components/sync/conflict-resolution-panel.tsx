"use client";

import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Download,
  GitMerge,
  RefreshCw,
  SkipForward,
} from "lucide-react";
import { useCallback, useState } from "react";
import type { ItemLevelSyncConflict } from "@zero-vault/shared";
import type { StoredItem } from "../../lib/storage/desktop-ciphertext-store";
import { cn } from "../../lib/utils";
import styles from "./conflict-resolution-panel.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConflictDisplayItem = {
  itemId: string;
  title: string;
  reason: ItemLevelSyncConflict["reason"];
  localRevision: number | undefined;
  serverRevision: number;
  serverItemRevision: number | undefined;
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
  /** Optional: local version field data for side-by-side comparison */
  localFields?: Record<string, string>;
  /** Optional: remote version field data for side-by-side comparison */
  remoteFields?: Record<string, string>;
};

export type ConflictAction = "keep-local" | "accept-remote" | "create-copy" | "skip";

export type ConflictResolutionPanelProps = {
  /** List of conflicts to display. */
  conflicts: ConflictDisplayItem[];
  /** Resolve a single conflict. */
  onResolve: (itemId: string, action: ConflictAction) => Promise<void>;
  /** Resolve all conflicts with a single action. */
  onResolveAll: (action: ConflictAction) => Promise<void>;
  /** Whether currently loading. */
  loading?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reasonLabel(reason: ItemLevelSyncConflict["reason"]): string {
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
      return "接受远端版本";
    case "create-copy":
      return "创建副本";
    case "skip":
      return "跳过";
  }
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConflictResolutionPanel({
  conflicts,
  onResolve,
  onResolveAll,
  loading = false,
}: ConflictResolutionPanelProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState<ConflictAction | null>(
    null,
  );
  const [expandedComparison, setExpandedComparison] = useState<Set<string>>(
    new Set(),
  );

  const isEmpty = conflicts.length === 0;

  const handleAction = useCallback(
    async (itemId: string, action: ConflictAction) => {
      setPendingAction(`${itemId}:${action}`);
      try {
        await onResolve(itemId, action);
      } finally {
        setTimeout(() => setPendingAction(null), 500);
      }
    },
    [onResolve],
  );

  const handleBulkAction = useCallback((action: ConflictAction) => {
    setShowBulkConfirm(action);
  }, []);

  const confirmBulkAction = useCallback(async () => {
    if (showBulkConfirm) {
      try {
        await onResolveAll(showBulkConfirm);
      } finally {
        setShowBulkConfirm(null);
      }
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

  // ── Empty state ─────────────────────────────────────────────────────────────

  if (isEmpty) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <GitMerge size={24} />
          </span>
          <h3 className={styles.emptyTitle}>暂无分叉冲突</h3>
          <p className={styles.emptyText}>
            当前没有需要仲裁的同步分叉，所有密文条目都保持一致。
          </p>
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.eyebrow}>CONFLICT RESOLUTION</span>
          <h2 className={styles.heading}>分叉冲突仲裁</h2>
          <p className={styles.subheading}>
            以下条目在本地与远端同时发生修改。请为每条分叉选择仲裁方式，系统不会自动覆盖任何版本。
          </p>
        </div>
        <span className={styles.conflictBadge}>{conflicts.length} 条分叉</span>
      </div>

      {/* Bulk actions */}
      <div className={styles.bulkBar}>
        <span className={styles.bulkLabel}>批量仲裁：</span>
        <button
          type="button"
          className={cn(styles.bulkButton, styles.bulkKeepLocal)}
          onClick={() => handleBulkAction("keep-local")}
          disabled={loading}
        >
          <Download size={12} />
          全部保留本地
        </button>
        <button
          type="button"
          className={cn(styles.bulkButton, styles.bulkAcceptRemote)}
          onClick={() => handleBulkAction("accept-remote")}
          disabled={loading}
        >
          <RefreshCw size={12} />
          全部接受远端
        </button>
      </div>

      {/* Bulk confirm dialog */}
      {showBulkConfirm && (
        <div
          className={styles.bulkConfirmOverlay}
          onClick={cancelBulkAction}
        >
          <div
            className={styles.bulkConfirmDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-confirm-title"
            aria-describedby="bulk-confirm-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.bulkConfirmHeader}>
              <span className={styles.bulkConfirmIcon}>
                <AlertTriangle size={18} />
              </span>
              <h3 className={styles.bulkConfirmTitle} id="bulk-confirm-title">
                批量仲裁确认
              </h3>
            </div>
            <p className={styles.bulkConfirmBody} id="bulk-confirm-desc">
              确认对 {conflicts.length} 条分叉执行「
              {actionLabel(showBulkConfirm)}」？该操作会逐项触发当前冲突处理链路。
            </p>
            <div className={styles.bulkConfirmActions}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={cancelBulkAction}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.confirmBtn}
                onClick={() => void confirmBulkAction()}
              >
                确认仲裁
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conflict list */}
      <div className={styles.conflictList} role="list" aria-label="冲突列表">
        {conflicts.map((conflict) => {
          const isExpanded = expandedComparison.has(conflict.itemId);
          const hasComparison = conflict.localFields || conflict.remoteFields;
          const comparisonId = `conflict-comparison-${conflict.itemId}`;
          const allFieldKeys = hasComparison
            ? Array.from(
                new Set([
                  ...Object.keys(conflict.localFields ?? {}),
                  ...Object.keys(conflict.remoteFields ?? {}),
                ]),
              )
            : [];

          return (
            <div
              key={conflict.itemId}
              className={styles.conflictCard}
              role="listitem"
            >
              {/* Conflict header */}
              <div className={styles.conflictHeader}>
                <div className={styles.conflictTitleRow}>
                  <span className={styles.conflictIcon}>
                    <AlertTriangle size={14} />
                  </span>
                  <strong className={styles.conflictTitle}>
                    {conflict.title}
                  </strong>
                  <span className={styles.reasonBadge}>
                    {reasonLabel(conflict.reason)}
                  </span>
                </div>

                {/* Revisions */}
                <div className={styles.revisionRow}>
                  <span className={styles.revisionLocal}>
                    <Download size={10} />
                    本地 v{conflict.localRevision ?? "?"}
                  </span>
                  <span className={styles.revisionRemote}>
                    <RefreshCw size={10} />
                    远端 v{conflict.serverItemRevision ?? conflict.serverRevision}
                  </span>
                  {conflict.localUpdatedAt && (
                    <span className={styles.timestamp}>
                      <Clock size={10} />
                      本地：{formatTime(conflict.localUpdatedAt)}
                    </span>
                  )}
                  {conflict.remoteUpdatedAt && (
                    <span className={styles.timestamp}>
                      <Clock size={10} />
                      远端：{formatTime(conflict.remoteUpdatedAt)}
                    </span>
                  )}
                </div>
              </div>

              {/* Comparison toggle */}
              {hasComparison && (
                <button
                  type="button"
                  className={styles.comparisonToggle}
                  onClick={() => toggleComparison(conflict.itemId)}
                  aria-expanded={isExpanded}
                  aria-controls={comparisonId}
                >
                  {isExpanded ? (
                    <ChevronUp size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                  {isExpanded ? "收起对比" : "展开对比"}
                </button>
              )}

              {/* Side-by-side comparison */}
              {hasComparison && isExpanded && (
                <div className={styles.comparisonGrid} id={comparisonId}>
                  <div className={styles.comparisonHeader}>
                    <div className={styles.comparisonLocalHeader}>
                      <Download size={11} />
                      本地版本
                    </div>
                    <div className={styles.comparisonRemoteHeader}>
                      <RefreshCw size={11} />
                      远端版本
                    </div>
                  </div>
                  {allFieldKeys.map((fieldKey) => {
                    const localVal = conflict.localFields?.[fieldKey] ?? "";
                    const remoteVal = conflict.remoteFields?.[fieldKey] ?? "";
                    const isDifferent = localVal !== remoteVal;
                    return (
                      <div key={fieldKey} className={styles.comparisonRow}>
                        <div
                          className={cn(
                            styles.comparisonCell,
                            isDifferent && styles.comparisonCellDiff,
                          )}
                        >
                          <div className={styles.fieldName}>{fieldKey}</div>
                          <div className={styles.fieldValue}>
                            {localVal || (
                              <span className={styles.emptyValue}>(空)</span>
                            )}
                          </div>
                        </div>
                        <div
                          className={cn(
                            styles.comparisonCell,
                            isDifferent && styles.comparisonCellDiff,
                          )}
                        >
                          <div className={styles.fieldName}>{fieldKey}</div>
                          <div className={styles.fieldValue}>
                            {remoteVal || (
                              <span className={styles.emptyValue}>(空)</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Action buttons */}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={cn(styles.actionButton, styles.keepLocalBtn)}
                  onClick={() => void handleAction(conflict.itemId, "keep-local")}
                  disabled={
                    loading ||
                    pendingAction === `${conflict.itemId}:keep-local`
                  }
                  title="使用本地版本覆盖远端"
                  aria-label={`保留本地版本：${conflict.title}`}
                >
                  <Download size={13} />
                  保留本地
                </button>
                <button
                  type="button"
                  className={cn(styles.actionButton, styles.acceptRemoteBtn)}
                  onClick={() =>
                    void handleAction(conflict.itemId, "accept-remote")
                  }
                  disabled={
                    loading ||
                    pendingAction === `${conflict.itemId}:accept-remote`
                  }
                  title="使用远端版本覆盖本地"
                  aria-label={`接受远端版本：${conflict.title}`}
                >
                  <RefreshCw size={13} />
                  接受远端
                </button>
                <button
                  type="button"
                  className={cn(styles.actionButton, styles.createCopyBtn)}
                  onClick={() =>
                    void handleAction(conflict.itemId, "create-copy")
                  }
                  disabled={
                    loading ||
                    pendingAction === `${conflict.itemId}:create-copy`
                  }
                  title="保留两个版本作为独立条目"
                  aria-label={`创建副本：${conflict.title}`}
                >
                  <Copy size={13} />
                  创建副本
                </button>
                <button
                  type="button"
                  className={cn(styles.actionButton, styles.skipBtn)}
                  onClick={() => void handleAction(conflict.itemId, "skip")}
                  disabled={
                    loading || pendingAction === `${conflict.itemId}:skip`
                  }
                  title="暂不处理此冲突"
                  aria-label={`跳过：${conflict.title}`}
                >
                  <SkipForward size={13} />
                  跳过
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
