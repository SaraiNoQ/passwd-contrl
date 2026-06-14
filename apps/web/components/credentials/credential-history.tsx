"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import type { VaultItem } from "../../lib/local-vault";
import { isLogin } from "../../lib/item-types";
import styles from "./credential-history.module.css";

export interface HistoryVersion {
  revision: number;
  createdAt: string;
  item: VaultItem;
}

export interface CredentialHistoryProps {
  itemId: string;
  versions: HistoryVersion[];
  loading: boolean;
  error: string;
  onLoad: (itemId: string) => void;
}

export function CredentialHistory({
  itemId,
  versions,
  loading,
  error,
  onLoad,
}: CredentialHistoryProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (itemId && versions.length === 0 && !loading) {
      onLoad(itemId);
    }
  }, [itemId]); // Only refetch when itemId changes

  const toggleExpand = useCallback((index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  }, []);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <Loader2 size={16} className={styles.spinner} />
          <span>加载历史版本...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <Clock size={16} />
          <span>暂无历史版本记录</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Clock size={14} />
        <span>历史版本 ({versions.length})</span>
      </div>
      <div className={styles.list}>
        {versions.map((version, index) => {
          const isExpanded = expandedIndex === index;
          const item = version.item;
          const date = new Intl.DateTimeFormat("zh-CN", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(version.createdAt));

          return (
            <div key={`${version.revision}-${index}`} className={styles.version}>
              <button
                type="button"
                className={styles.versionHeader}
                onClick={() => toggleExpand(index)}
                aria-expanded={isExpanded}
              >
                <div className={styles.versionMeta}>
                  <span className={styles.versionRev}>v{version.revision}</span>
                  <span className={styles.versionDate}>{date}</span>
                </div>
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {isExpanded ? (
                <div className={styles.versionDetail}>
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>标题</span>
                    <span className={styles.detailValue}>{item.title}</span>
                  </div>
                  {isLogin(item) ? (
                    <>
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>网站</span>
                        <span className={styles.detailValue}>{item.origin}</span>
                      </div>
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>用户名</span>
                        <span className={styles.detailValue}>{item.username}</span>
                      </div>
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>密码</span>
                        <span className={styles.detailValue}>{"•".repeat(Math.min(item.password.length, 16))}</span>
                      </div>
                    </>
                  ) : null}
                  {item.notes ? (
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>备注</span>
                      <span className={styles.detailValue}>{item.notes}</span>
                    </div>
                  ) : null}
                  {item.folder ? (
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>文件夹</span>
                      <span className={styles.detailValue}>{item.folder}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
