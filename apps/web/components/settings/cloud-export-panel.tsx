"use client";

import { useCallback } from "react";
import { Cloud, CloudDownload, CloudUpload, HardDriveDownload, Trash2 } from "lucide-react";
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
  status?: string;
  onLoad: () => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  disabled: boolean;
  restoringId?: string | null;
}

function formatAlgorithmLabel(algorithm: string): string {
  const normalized = algorithm.trim().toUpperCase();

  if (!normalized || normalized === "UNKNOWN") {
    return "加密备份快照";
  }

  if (normalized === "XCHACHA20_POLY1305") {
    return "XChaCha20-Poly1305";
  }

  return algorithm;
}

export function CloudExportPanel({
  exports,
  loading,
  error,
  status,
  onLoad,
  onCreate,
  onDelete,
  onRestore,
  disabled,
  restoringId,
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
        <h4>云端备份快照</h4>
      </div>
      <div className={styles.callout}>
        <strong>恢复说明</strong>
        <span>从列表恢复会覆盖当前设备上的本地加密库，然后要求重新用原主密码解锁。</span>
      </div>

      {error ? (
        <div className={styles.error}>{error}</div>
      ) : null}
      {status ? (
        <div className={styles.status}>{status}</div>
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
                <span className={styles.itemAlgo}>{formatAlgorithmLabel(exp.algorithm)}</span>
                <span className={styles.itemHint}>
                  {exp.algorithm.trim().toUpperCase() === "UNKNOWN" || !exp.algorithm.trim()
                    ? "该快照缺少算法元数据，仍可按标准 Obscura 加密备份恢复。"
                    : "登录同一账户后，可在当前设备或其他设备打开此列表恢复。"}
                </span>
              </div>
              <div className={styles.itemActions}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onRestore(exp.id)}
                  disabled={disabled}
                  loading={restoringId === exp.id}
                >
                  <HardDriveDownload size={12} />
                  恢复到当前设备
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => onDelete(exp.id)}
                  disabled={disabled || restoringId === exp.id}
                >
                  <Trash2 size={12} />
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <Cloud size={16} />
          <span>暂无云端备份快照</span>
        </div>
      )}
    </div>
  );
}
