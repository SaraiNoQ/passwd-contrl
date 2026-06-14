"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Eye,
  EyeOff,
  Copy,
  Check,
  Pencil,
  Trash2,
  X,
  Sparkles,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  KeyRound,
} from "lucide-react";
import type { VaultItem, VaultLogin } from "../../lib/local-vault";
import { isLogin } from "../../lib/item-types";
import { cn } from "../../lib/utils";
import styles from "./credential-list.module.css";

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

const isWeakPassword = (password: string): boolean => {
  if (password.length < 8) return true;
  const hasLower = /[a-z]/u.test(password);
  const hasUpper = /[A-Z]/u.test(password);
  const hasDigit = /[0-9]/u.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/u.test(password);
  const variety = (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0);
  return variety < 3;
};

/* ---------------------------------------------------------------------------
   Password Strength
   --------------------------------------------------------------------------- */

type PasswordStrength = { score: number; label: string; tone: "strong" | "medium" | "weak" | "empty" };

function getPasswordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: "无", tone: "empty" };

  const hasLower = /[a-z]/u.test(password);
  const hasUpper = /[A-Z]/u.test(password);
  const hasDigit = /[0-9]/u.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/u.test(password);
  const variety = (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0);

  // Strong: 12+ chars, mixed case, numbers, symbols
  if (password.length >= 12 && variety >= 4) {
    return { score: 100, label: "强", tone: "strong" };
  }
  // Medium: 8+ chars with some variety
  if (password.length >= 8 && variety >= 3) {
    return { score: 66, label: "中", tone: "medium" };
  }
  // Medium-low: 8+ chars but low variety
  if (password.length >= 8) {
    return { score: 40, label: "中", tone: "medium" };
  }
  // Weak: less than 8 chars or very simple
  return { score: 20, label: "弱", tone: "weak" };
}

/* ---------------------------------------------------------------------------
   Sorting
   --------------------------------------------------------------------------- */

export type SortField = "name" | "updatedAt" | "createdAt";
export type SortDirection = "asc" | "desc";

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "name", label: "名称" },
  { value: "updatedAt", label: "最近更新" },
  { value: "createdAt", label: "创建时间" },
];

function sortCredentials(items: VaultItem[], field: SortField, direction: SortDirection): VaultItem[] {
  const sorted = [...items].sort((a, b) => {
    let cmp = 0;
    if (field === "name") {
      cmp = a.title.localeCompare(b.title, "zh-CN");
    } else if (field === "updatedAt") {
      cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    } else if (field === "createdAt") {
      cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    return direction === "asc" ? cmp : -cmp;
  });
  return sorted;
}

/* ---------------------------------------------------------------------------
   CSV Export
   --------------------------------------------------------------------------- */

function credentialsToCsv(items: VaultItem[]): string {
  const header = "Title,Origin,Username,Password,Notes,CreatedAt,UpdatedAt";
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const loginItems = items.filter(isLogin);
  const rows = loginItems.map(
    (i) =>
      `${escape(i.title)},${escape(i.origin)},${escape(i.username)},${escape(i.password)},${escape(i.notes)},${escape(i.createdAt)},${escape(i.updatedAt)}`,
  );
  return [header, ...rows].join("\n");
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------------
   Types
   --------------------------------------------------------------------------- */

export interface CredentialListProps {
  /** Pre-filtered list of credentials to display. */
  items: VaultItem[];
  /** Current search query (used for empty-state messaging). */
  searchQuery: string;
  /** Active filter mode. */
  filterMode: string;
  /** Called when the user selects a different filter tab. */
  onFilterModeChange: (mode: string) => void;
  /** ID of the credential whose password is currently revealed, or null. */
  passwordRevealedId: string | null;
  /** Toggle password reveal for the given credential. */
  onTogglePasswordReveal: (id: string) => void;
  /** Copy the username of the given credential. */
  onCopyUsername: (id: string, username: string) => void;
  /** Copy the password of the given credential. */
  onCopyPassword: (id: string, password: string) => void;
  /** Open the edit drawer for the given credential. */
  onEdit: (item: VaultItem) => void;
  /** Open the create drawer for adding a new credential. */
  onAdd: () => void;
  /** Delete the credential with the given ID. */
  onDelete: (id: string) => void;
  /** ID of the credential currently awaiting delete confirmation, or null. */
  deleteConfirmId: string | null;
  /** Enter delete-confirm state for the given credential. */
  onDeleteConfirm: (id: string) => void;
  /** Cancel the pending delete confirmation. */
  onDeleteCancel: () => void;
  /** Whether the parent is in a loading state. */
  loading: boolean;
  /** Called when the user requests batch deletion of selected credentials. */
  onBatchDelete?: (ids: string[]) => void;
  /** Called when the user requests batch export of selected credentials. If not provided, a default CSV download is used. */
  onBatchExport?: (items: VaultItem[]) => void;
  /** Currently selected folder filter. null = all, "" = uncategorized, "name" = folder. */
  folderFilter: string | null;
  /** Called when the selection changes, allowing the parent to sync selected IDs. */
  onSelectionChange?: (ids: Set<string>) => void;
  /** Called when the user requests batch password update for selected credentials. */
  onBatchUpdatePassword?: (ids: string[]) => void;
}

/* ---------------------------------------------------------------------------
   CredentialList
   --------------------------------------------------------------------------- */

export function CredentialList({
  items,
  searchQuery,
  filterMode,
  onFilterModeChange,
  passwordRevealedId,
  onTogglePasswordReveal,
  onCopyUsername,
  onCopyPassword,
  onEdit,
  onAdd,
  onDelete,
  deleteConfirmId,
  onDeleteConfirm,
  onDeleteCancel,
  loading,
  onBatchDelete,
  onBatchExport,
  folderFilter,
  onSelectionChange,
  onBatchUpdatePassword,
}: CredentialListProps) {
  // Local state for copy-feedback highlighting.
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Sorting state.
  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Batch selection state.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);

  /* ---- Derived counts for filter tabs ---- */

  const totalCount = items.length;

  const weakCount = useMemo(() => items.filter((i) => isLogin(i) && isWeakPassword(i.password)).length, [items]);

  const duplicateCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!isLogin(item)) continue;
      counts.set(item.password, (counts.get(item.password) ?? 0) + 1);
    }
    let dupes = 0;
    for (const c of counts.values()) {
      if (c > 1) dupes += c;
    }
    return dupes;
  }, [items]);

  /* ---- Sorted items (login items only for credential list) ---- */

  const loginItems = useMemo(() => items.filter(isLogin), [items]);
  const sortedItems = useMemo(() => sortCredentials(loginItems, sortField, sortDirection) as VaultLogin[], [loginItems, sortField, sortDirection]);

  /* ---- Sort handler ---- */

  const handleSortFieldChange = useCallback((field: SortField) => {
    setSortField(field);
  }, []);

  const toggleSortDirection = useCallback(() => {
    setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
  }, []);

  /* ---- Batch selection handlers ---- */

  const isAllSelected = sortedItems.length > 0 && sortedItems.every((i) => selectedIds.has(i.id));

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedItems.map((i) => i.id)));
    }
  }, [isAllSelected, sortedItems]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setBatchDeleteConfirmOpen(false);
  }, []);

  // Sync selection to parent (using ref to avoid stale/dynamic callback deps)
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  useEffect(() => {
    onSelectionChangeRef.current?.(selectedIds);
  }, [selectedIds]);

  /* ---- Batch action handlers ---- */

  const handleBatchDelete = useCallback(() => {
    setBatchDeleteConfirmOpen(true);
  }, []);

  const handleBatchDeleteConfirm = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (onBatchDelete) {
      onBatchDelete(ids);
    }
    clearSelection();
  }, [selectedIds, onBatchDelete, clearSelection]);

  const handleBatchDeleteCancel = useCallback(() => {
    setBatchDeleteConfirmOpen(false);
  }, []);

  const handleBatchExport = useCallback(() => {
    const selected = sortedItems.filter((i) => selectedIds.has(i.id));
    if (selected.length === 0) return;
    if (onBatchExport) {
      onBatchExport(selected);
    } else {
      // Default: download CSV
      const csv = credentialsToCsv(selected);
      downloadCsv(csv, `credentials-export-${Date.now()}.csv`);
    }
    clearSelection();
  }, [selectedIds, sortedItems, onBatchExport, clearSelection]);

  const handleBatchUpdatePassword = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (onBatchUpdatePassword) {
      onBatchUpdatePassword(ids);
    }
  }, [selectedIds, onBatchUpdatePassword]);

  /* ---- Copy handler with feedback ---- */

  const handleCopy = (text: string, fieldId: string, callback: (id: string, value: string) => void, id: string) => {
    callback(id, text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const emptyStateCopy = searchQuery
    ? {
        title: "没有找到匹配项",
        body: `没有找到与“${searchQuery}”匹配的密码记录。换一个关键词，或清空搜索重新查看。`,
        status: "SEARCH MISS",
      }
    : filterMode !== "all"
      ? {
          title: "这个筛选下没有记录",
          body: "当前筛选条件下没有凭据。可以切换筛选条件，或添加新的账号密码。",
          status: "FILTER EMPTY",
        }
      : folderFilter !== null
        ? {
            title: folderFilter === "" ? "未分类里还没有凭据" : "这个文件夹还没有凭据",
            body:
              folderFilter === ""
                ? "未分类文件夹还没有凭据。可以先把零散账号放在这里，再慢慢整理。"
                : `“${folderFilter}”文件夹还没有凭据。添加第一条账号密码记录。`,
            status: "FOLDER EMPTY",
          }
        : {
            title: "密码库还是空的",
            body: "还没有保存任何凭据。点击新增凭据，把网站、用户名和密码保存到本地加密密码库。",
            status: "VAULT GENESIS",
          };

  /* ---- Render ---- */

  return (
    <div className={styles.container}>
      {/* Credential Table Header */}
      <div className={styles.tableHeader}>
        <div>
          <span className={styles.tableEyebrow}>PASSWORD VAULT</span>
          <h2>凭据</h2>
          <p>每条记录都只在本机解锁后显示；复制、编辑与删除都在当前设备内完成。</p>
        </div>
        <button className={styles.addButton} type="button" onClick={onAdd}>
          新增凭据
        </button>
      </div>

      <div className={styles.controlsRail} aria-label="密码库筛选和排序">
        {/* Sort Selector */}
        <div className={styles.sortBar}>
          <span className={styles.sortLabel}>排序</span>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={cn(styles.sortButton, sortField === opt.value && styles.sortButtonActive)}
              type="button"
              onClick={() => handleSortFieldChange(opt.value)}
            >
              {opt.label}
              {sortField === opt.value ? (
                sortDirection === "asc" ? (
                  <ArrowUp size={12} />
                ) : (
                  <ArrowDown size={12} />
                )
              ) : (
                <ArrowUpDown size={12} className={styles.sortIconMuted} />
              )}
            </button>
          ))}
          <button
            className={styles.sortDirToggle}
            type="button"
            onClick={toggleSortDirection}
            title={sortDirection === "asc" ? "升序" : "降序"}
            aria-label={sortDirection === "asc" ? "切换为降序" : "切换为升序"}
          >
            {sortDirection === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </button>
        </div>

        {/* Filter Tabs */}
        <div className={styles.filterTabs}>
          <button
            className={cn(styles.filterTab, filterMode === "all" && styles.filterTabActive)}
            type="button"
            onClick={() => onFilterModeChange("all")}
          >
            全部<span className={styles.filterTabCount}>({totalCount})</span>
          </button>
          <button
            className={cn(styles.filterTab, filterMode === "weak" && styles.filterTabActive)}
            type="button"
            onClick={() => onFilterModeChange("weak")}
          >
            弱密码<span className={styles.filterTabCount}>({weakCount})</span>
          </button>
          <button
            className={cn(styles.filterTab, filterMode === "duplicate" && styles.filterTabActive)}
            type="button"
            onClick={() => onFilterModeChange("duplicate")}
          >
            复用密码<span className={styles.filterTabCount}>({duplicateCount})</span>
          </button>
          <button
            className={cn(styles.filterTab, filterMode === "unsynced" && styles.filterTabActive)}
            type="button"
            onClick={() => onFilterModeChange("unsynced")}
          >
            未同步
          </button>
        </div>
      </div>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className={cn(styles.batchBar, batchDeleteConfirmOpen && styles.batchBarConfirm)}>
          {batchDeleteConfirmOpen ? (
            <>
              <div className={styles.batchConfirmCopy} role="alert">
                <Trash2 size={18} aria-hidden="true" />
                <span>
                  确认删除 <strong>{selectedIds.size}</strong> 条密码记录？此操作不可撤销。
                </span>
              </div>
              <button
                className={cn(styles.batchBtn, styles.batchBtnDangerFilled)}
                type="button"
                onClick={handleBatchDeleteConfirm}
                disabled={loading}
              >
                确认删除
              </button>
              <button
                className={styles.batchBtn}
                type="button"
                onClick={handleBatchDeleteCancel}
                disabled={loading}
              >
                返回列表
              </button>
            </>
          ) : (
            <>
              <span className={styles.batchCount}>已选择 {selectedIds.size} 项</span>
              <button
                className={styles.batchBtn}
                type="button"
                onClick={handleBatchExport}
                title="导出选中凭据为 CSV"
              >
                <Download size={14} />
                导出 CSV
              </button>
              {onBatchUpdatePassword ? (
                <button
                  className={styles.batchBtn}
                  type="button"
                  onClick={handleBatchUpdatePassword}
                  title="为选中凭据生成新密码"
                >
                  <KeyRound size={14} />
                  批量更新密码
                </button>
              ) : null}
              <button
                className={cn(styles.batchBtn, styles.batchBtnDanger)}
                type="button"
                onClick={handleBatchDelete}
                title="批量删除选中凭据"
              >
                <Trash2 size={14} />
                批量删除
              </button>
              <button
                className={styles.batchClearBtn}
                type="button"
                onClick={clearSelection}
                title="取消选择"
                aria-label="取消选择"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className={styles.loading} aria-live="polite" aria-busy="true">
          <div className={styles.loadingGlyph} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className={styles.loadingCopy}>
            <span className={styles.loadingKicker}>LEDGER SYNC</span>
            <span className={styles.loadingText}>正在读取本地密码库...</span>
          </div>
        </div>
      )}

      {/* Credential List */}
      {!loading && (
        <div className={styles.list} aria-live="polite">
          {sortedItems.length > 0 ? (
            <div className={styles.ledgerList}>
              <div className={styles.ledgerToolbar}>
                <label className={styles.selectAllControl}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={toggleSelectAll}
                    aria-label="全选"
                  />
                  全选当前列表
                </label>
                <span>{sortedItems.length} 个加密条目</span>
              </div>

              {sortedItems.map((item, index) => {
                const strength = getPasswordStrength(item.password);
                const strengthToneClass = styles[`strengthTone${strength.tone[0]?.toUpperCase()}${strength.tone.slice(1)}`] ?? "";
                const isSelected = selectedIds.has(item.id);
                return (
                  <article
                    className={cn(styles.ledgerCard, isSelected && styles.ledgerCardSelected)}
                    key={item.id}
                  >
                    {/* Checkbox */}
                    <label className={styles.checkboxCell} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(item.id)}
                        aria-label={`选择 ${item.title}`}
                      />
                    </label>

                    <button
                      type="button"
                      className={styles.cardMain}
                      onClick={() => onEdit(item)}
                      aria-label={`编辑 ${item.title}`}
                    >
                      <span className={styles.cardIndex}>{String(index + 1).padStart(2, "0")}</span>
                      <div className={styles.cardIdentity}>
                        <div className={styles.cellName}>{item.title}</div>
                        <div className={styles.cellOrigin}>
                          {item.origin}
                          {item.folder ? <span className={styles.folderTag}>{item.folder}</span> : null}
                        </div>
                      </div>
                    </button>

                    <div className={styles.secretPanel}>
                      <div className={styles.secretLine}>
                        <span className={styles.secretLabel}>用户</span>
                        <span className={styles.cellText}>{item.username || "无用户名"}</span>
                      </div>
                      <div className={styles.secretLine}>
                        <span className={styles.secretLabel}>密码</span>
                        <span
                          className={cn(
                            styles.cellPassword,
                            passwordRevealedId === item.id && styles.cellPasswordRevealed,
                          )}
                        >
                          {passwordRevealedId === item.id ? item.password : "••••••••••••"}
                        </span>
                      </div>
                      <div className={styles.strengthContainer} aria-label={`密码强度 ${strength.label}`}>
                        <progress className={cn(styles.strengthBar, strengthToneClass)} value={strength.score} max={100} />
                        <span className={cn(styles.strengthLabel, strengthToneClass)}>
                          {strength.label}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
                      {/* Toggle password visibility */}
                      <button
                        className={styles.actionButton}
                        type="button"
                        onClick={() => onTogglePasswordReveal(item.id)}
                        title={passwordRevealedId === item.id ? "隐藏密码" : "显示密码"}
                        aria-label={`${passwordRevealedId === item.id ? "隐藏" : "显示"} ${item.title} 的密码`}
                        aria-pressed={passwordRevealedId === item.id}
                      >
                        {passwordRevealedId === item.id ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>

                      {/* Copy username */}
                      {item.username ? (
                        <button
                          className={styles.actionButton}
                          type="button"
                          onClick={() => handleCopy(item.username, `user-${item.id}`, onCopyUsername, item.id)}
                          title="复制用户名"
                          aria-label={copiedField === `user-${item.id}` ? `已复制 ${item.title} 的用户名` : `复制 ${item.title} 的用户名`}
                        >
                          {copiedField === `user-${item.id}` ? (
                            <Check size={14} className={styles.actionSuccessIcon} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      ) : null}

                      {/* Copy password */}
                      <button
                        className={styles.actionButton}
                        type="button"
                        onClick={() => handleCopy(item.password, `pass-${item.id}`, onCopyPassword, item.id)}
                        title="复制密码"
                        aria-label={copiedField === `pass-${item.id}` ? `已复制 ${item.title} 的密码` : `复制 ${item.title} 的密码`}
                      >
                        {copiedField === `pass-${item.id}` ? (
                          <Check size={14} className={styles.actionSuccessIcon} />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>

                      {/* Edit */}
                      <button
                        className={cn(styles.actionButton, styles.actionButtonEdit)}
                        type="button"
                        onClick={() => onEdit(item)}
                        title="编辑凭据"
                        aria-label="编辑凭据"
                      >
                        <Pencil size={14} />
                      </button>

                      {/* Delete (with confirm) */}
                      {deleteConfirmId === item.id ? (
                        <div className={styles.deleteConfirm} role="alert">
                          <span>删除？</span>
                          <button
                            className={styles.deleteConfirmButton}
                            type="button"
                            onClick={() => onDelete(item.id)}
                            disabled={loading}
                          >
                            确认
                          </button>
                          <button
                            className={styles.deleteCancelButton}
                            type="button"
                            onClick={onDeleteCancel}
                            aria-label="取消删除"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className={cn(styles.actionButton, styles.actionButtonDanger)}
                          type="button"
                          onClick={() => onDeleteConfirm(item.id)}
                          title="删除凭据"
                          aria-label="删除凭据"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <div className={styles.emptyPixelLedger} aria-hidden="true">
                <span className={styles.emptyLedgerBlock} />
                <span className={styles.emptyLedgerBlock} />
                <span className={styles.emptyLedgerBlock} />
                <span className={styles.emptyKeySlot}>
                  <Sparkles size={18} />
                </span>
              </div>
              <span className={styles.emptyStatus}>{emptyStateCopy.status}</span>
              <h3>{emptyStateCopy.title}</h3>
              <p>{emptyStateCopy.body}</p>
              <button className={styles.emptyAction} type="button" onClick={onAdd}>
                写入第一枚凭据
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
