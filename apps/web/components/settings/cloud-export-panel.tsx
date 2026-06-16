"use client";

import { useCallback } from "react";
import { Cloud, CloudDownload, CloudUpload, Loader2, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import styles from "./cloud-export-panel.module.css";

export interface CloudExport {
  id: string;
  createdAt: string;
  algorithm: string;
}

export interface CloudExportPanelProps {
  exports: CloudExport[];
  loading: boolean;
  error: string;
  onLoad: () => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  disabled: boolean;
}

export function CloudExportPanel({
  exports,
  loading,
  error,
  onLoad,
  onCreate,
  onDelete,
  disabled,
}: CloudExportPanelProps) {
  const formatDate = useCallback((iso: string) => {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) {
      return "时间未知";
    }

    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Cloud size={16} />
        <h4>云端备份</h4>
      </div>
      <p className={styles.description}>
        将加密备份上传到云端，可在其他设备恢复。备份文件使用与本地相同的加密方式。
      </p>

      {error ? (
        <div className={styles.error}>{error}</div>
      ) : null}

      <div className={styles.actions}>
        <Button
          type="button"
          variant="secondary"
          onClick={onCreate}
          disabled={disabled || loading}
          loading={loading}
        >
          <CloudUpload size={14} />
          {loading ? "上传中..." : "上传到云端"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onLoad}
          disabled={disabled}
        >
          <CloudDownload size={14} />
          刷新列表
        </Button>
      </div>

      {exports.length > 0 ? (
        <div className={styles.list}>
          {exports.map((exp) => (
            <div key={exp.id} className={styles.item}>
              <div className={styles.itemMeta}>
                <span className={styles.itemDate}>{formatDate(exp.createdAt)}</span>
                <span className={styles.itemAlgo}>{exp.algorithm}</span>
              </div>
              <Button
                type="button"
                variant="danger"
                onClick={() => onDelete(exp.id)}
                disabled={disabled}
              >
                <Trash2 size={12} />
                删除
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <Cloud size={16} />
          <span>暂无云端备份</span>
        </div>
      )}
    </div>
  );
}
