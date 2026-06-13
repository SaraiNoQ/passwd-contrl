"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { Search, Plus, Sparkles } from "lucide-react";
import type { VaultItem, VaultLogin } from "@zero-vault/shared";
import { cn } from "../../lib/utils";
import { CredentialRow } from "./credential-row";
import { copyToClipboard } from "../../lib/clipboard";
import styles from "./credential-list.module.css";

function isLogin(item: VaultItem): item is VaultLogin {
  return item.type === "login";
}

const CredentialRowItem = memo(function CredentialRowItem({
  item,
  onSelect,
}: {
  item: VaultItem;
  onSelect: (item: VaultItem) => void;
}) {
  const login = isLogin(item) ? item : null;
  const handleClick = useCallback(() => onSelect(item), [item, onSelect]);
  const handleCopyUsername = useCallback(() => {
    if (login?.username) void copyToClipboard(login.username);
  }, [login?.username]);
  const handleCopyPassword = useCallback(() => {
    if (login?.password) void copyToClipboard(login.password);
  }, [login?.password]);

  return (
    <CredentialRow
      item={item}
      onClick={handleClick}
      {...(login?.username == null ? {} : { onCopyUsername: handleCopyUsername })}
      {...(login?.password == null ? {} : { onCopyPassword: handleCopyPassword })}
    />
  );
});

export interface CredentialListProps {
  /** All decrypted vault items. */
  items: VaultItem[];
  /** Current search query. */
  searchQuery: string;
  /** Called when the user selects a credential to view/edit. */
  onSelect: (item: VaultItem) => void;
  /** Called when the user requests to add a new credential. */
  onAdd: () => void;
  /** Loading state. */
  loading?: boolean;
  className?: string;
}

export function CredentialList({
  items,
  searchQuery,
  onSelect,
  onAdd,
  loading = false,
  className,
}: CredentialListProps) {
  const [localFilter, setLocalFilter] = useState("");

  const effectiveQuery = searchQuery || localFilter;

  const filteredItems = useMemo(() => {
    const loginItems = items.filter(isLogin);
    if (!effectiveQuery.trim()) return loginItems;

    const q = effectiveQuery.toLowerCase();
    return loginItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.origin.toLowerCase().includes(q) ||
        item.username.toLowerCase().includes(q),
    );
  }, [items, effectiveQuery]);

  const sortedItems = useMemo(
    () =>
      [...filteredItems].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [filteredItems],
  );

  const totalCount = useMemo(() => items.filter(isLogin).length, [items]);

  const emptyState = effectiveQuery.trim()
    ? {
        title: "未找到匹配凭据",
        body: `没有与"${effectiveQuery}"匹配的凭据。尝试其他关键词或清空搜索。`,
      }
    : {
        title: "密码库等待第一枚凭据",
        body: "还没有凭据被写入本地账本。点击下方按钮，添加第一条加密记录。",
      };

  return (
    <div className={cn(styles.container, className)}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>CREDENTIALS</span>
          <h2 className={styles.heading}>凭据</h2>
          <p className={styles.subheading}>
            {totalCount} 条加密记录，搜索与复制均在本地完成。
          </p>
        </div>
        <button
          type="button"
          className={styles.addButton}
          onClick={onAdd}
        >
          <Plus size={16} />
          新增凭据
        </button>
      </div>

      {/* Local search (when TopBar search is not used) */}
      {!searchQuery && (
        <div className={styles.searchRow}>
          <Search size={16} className={styles.searchIcon} aria-hidden="true" />
          <input
            className={styles.searchInput}
            type="search"
            placeholder="搜索凭据名称、站点或用户名..."
            value={localFilter}
            onChange={(e) => setLocalFilter(e.target.value)}
            aria-label="搜索凭据"
          />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className={styles.loading} aria-live="polite" aria-busy="true">
          <div className={styles.loadingDots} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span>正在扫描本地密文账本...</span>
        </div>
      )}

      {/* List */}
      {!loading && (
        <div className={styles.list} aria-live="polite">
          {sortedItems.length > 0 ? (
            <>
              <div className={styles.listMeta}>
                <span>{sortedItems.length} 个加密条目</span>
              </div>
              <div className={styles.listItems}>
                {sortedItems.map((item) => (
                  <CredentialRowItem
                    key={item.id}
                    item={item}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyGlyph} aria-hidden="true">
                <Sparkles size={20} />
              </div>
              <h3 className={styles.emptyTitle}>{emptyState.title}</h3>
              <p className={styles.emptyBody}>{emptyState.body}</p>
              {!effectiveQuery.trim() && (
                <button
                  type="button"
                  className={styles.emptyAction}
                  onClick={onAdd}
                >
                  写入第一枚凭据
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
