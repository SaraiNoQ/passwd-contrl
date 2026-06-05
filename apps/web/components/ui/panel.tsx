"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import styles from "./panel.module.css";

export interface PanelProps {
  title?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, icon: Icon, children, className }: PanelProps) {
  return (
    <section className={cn(styles.panel, className)}>
      {(title || Icon) && (
        <div className={styles.header}>
          {Icon && <Icon className={styles.headerIcon} aria-hidden="true" />}
          {title && <h2 className={styles.title}>{title}</h2>}
        </div>
      )}
      <div className={styles.content}>{children}</div>
    </section>
  );
}
