"use client";

import { useEffect, useRef, useId } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import styles from "./confirm-delete-dialog.module.css";

/* ---------------------------------------------------------------------------
   Props
   --------------------------------------------------------------------------- */

export interface ConfirmDeleteDialogProps {
  open: boolean;
  itemTitle: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}

/* ---------------------------------------------------------------------------
   ConfirmDeleteDialog
   --------------------------------------------------------------------------- */

export function ConfirmDeleteDialog({
  open,
  itemTitle,
  onConfirm,
  onClose,
  loading = false,
}: ConfirmDeleteDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      const cancelBtn = dialogRef.current?.querySelector<HTMLElement>(
        "button",
      );
      cancelBtn?.focus();
    });

    return () => {
      document.body.style.overflow = "";
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.iconWrapper}>
            <AlertTriangle size={20} />
          </div>
          <h2 id={titleId} className={styles.title}>
            确认删除
          </h2>
        </div>

        <div className={styles.body}>
          <p className={styles.message}>
            确定要删除凭据{" "}
            <span className={styles.itemTitle}>
              &ldquo;{itemTitle}&rdquo;
            </span>{" "}
            吗？此操作无法撤销，所有关联的加密数据将被永久移除。
          </p>
          <p className={styles.warning}>
            删除后，该凭据将从所有已同步设备中移除。
          </p>
        </div>

        <div className={styles.footer}>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            取消
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            loading={loading}
          >
            <Trash2 size={14} />
            确认删除
          </Button>
        </div>
      </div>
    </div>
  );
}
