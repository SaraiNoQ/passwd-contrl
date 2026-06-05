"use client";

import { Plus, RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";
import styles from "./action-dock.module.css";

interface ActionDockProps {
  onAddCredential: () => void;
  onSyncNow: () => void;
  loading: boolean;
}

export function ActionDock({ onAddCredential, onSyncNow, loading }: ActionDockProps) {
  return (
    <div className={styles.dock} aria-label="快捷操作">
      <button
        type="button"
        className={styles.dockBtn}
        onClick={onAddCredential}
        title="添加凭据"
        aria-label="添加凭据"
      >
        <Plus size={18} />
      </button>
      <button
        type="button"
        className={cn(styles.dockBtn, loading && styles.spinning)}
        onClick={onSyncNow}
        disabled={loading}
        title="立即同步"
        aria-label="立即同步"
      >
        <RefreshCw size={18} />
      </button>
    </div>
  );
}
