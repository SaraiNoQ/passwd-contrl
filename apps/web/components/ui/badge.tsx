"use client";

import type { ReactNode } from "react";
import {
  Lock,
  Unlock,
  CheckCircle2,
  Clock,
  AlertTriangle,
  WifiOff,
  ShieldBan,
  LogIn,
  Globe,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import styles from "./badge.module.css";

export type BadgeVariant =
  | "locked"
  | "unlocked"
  | "synced"
  | "pending"
  | "conflict"
  | "offline"
  | "blocked"
  | "fillable"
  | "similar"
  | "trusted";

export interface BadgeProps {
  variant: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variantIcons: Record<BadgeVariant, LucideIcon> = {
  locked: Lock,
  unlocked: Unlock,
  synced: CheckCircle2,
  pending: Clock,
  conflict: AlertTriangle,
  offline: WifiOff,
  blocked: ShieldBan,
  fillable: LogIn,
  similar: Globe,
  trusted: ShieldCheck,
};

export function Badge({ variant, children, className }: BadgeProps) {
  const Icon = variantIcons[variant];

  return (
    <span className={cn(styles.badge, styles[variant], className)}>
      <Icon className={styles.icon} aria-hidden="true" />
      {children}
    </span>
  );
}
