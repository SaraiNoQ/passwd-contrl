"use client";

import { cn } from "../lib/utils";
import styles from "./loading-skeleton.module.css";

type ShimmerSize = "xs" | "sm" | "md" | "lg" | "xl" | "button" | "icon";
type ShimmerWidth = "full" | "wide" | "mid" | "short" | "tiny" | "action";

const statCards = Array.from({ length: 3 });
const filterTabs = Array.from({ length: 4 });
const credentialRows = Array.from({ length: 5 });

/**
 * A single shimmer bar (ghost row) that pulses with a subtle gradient animation.
 */
function ShimmerBar({
  size = "md",
  width = "full",
  className
}: {
  size?: ShimmerSize;
  width?: ShimmerWidth;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        styles.shimmerBar,
        styles[`shimmerHeight${capitalize(size)}`],
        styles[`shimmerWidth${capitalize(width)}`],
        className
      )}
      aria-hidden="true"
    />
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Placeholder for the vault password list (5 ghost rows matching the credential table).
 */
export function VaultSkeleton() {
  return (
    <div
      className={styles.vaultSkeleton}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-atomic="true"
    >
      <span className={styles.srOnly}>密文账本正在装载，请稍候。</span>
      <span className={styles.loadingMarker} aria-hidden="true">
        CIPHER LEDGER
      </span>

      <div className={styles.ledgerHero} aria-hidden="true">
        <div className={styles.pixelSeal}>
          <span />
          <span />
          <span />
        </div>
        <div className={styles.heroCopy}>
          <ShimmerBar width="wide" size="lg" />
          <ShimmerBar width="mid" size="sm" />
        </div>
      </div>

      <div className={styles.statsGrid}>
        {statCards.map((_, i) => (
          <div key={i} className={styles.statCard}>
            <ShimmerBar width="mid" size="xs" />
            <ShimmerBar width="short" size="xl" />
          </div>
        ))}
      </div>

      <div className={styles.filterTabs} aria-hidden="true">
        {filterTabs.map((_, i) => (
          <ShimmerBar key={i} width="action" size="button" />
        ))}
      </div>

      <div className={styles.listHeader} aria-hidden="true">
        <ShimmerBar width="mid" size="lg" />
        <ShimmerBar width="action" size="button" />
      </div>

      <div className={styles.credentialList} aria-hidden="true">
        {credentialRows.map((_, i) => (
          <div key={i} className={styles.credentialRow}>
            <div className={styles.rowIdentity}>
              <ShimmerBar width="wide" size="sm" />
              <ShimmerBar width="mid" size="xs" className={styles.rowSubline} />
            </div>
            <ShimmerBar width="mid" size="sm" />
            <ShimmerBar width="wide" size="sm" />
            <ShimmerBar width="short" size="sm" />
            <ShimmerBar width="tiny" size="icon" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Placeholder for the login / register / unlock form.
 */
export function AuthSkeleton() {
  return (
    <div
      className={styles.authShell}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-atomic="true"
    >
      <span className={styles.srOnly}>正在加载身份验证表单，请稍候。</span>
      <div className={styles.authCard}>
        <span className={styles.loadingMarker} aria-hidden="true">
          AUTH NODE
        </span>

        <div className={styles.authTitleRow} aria-hidden="true">
          <ShimmerBar width="tiny" size="icon" className={styles.authIcon} />
          <div className={styles.authTitleStack}>
            <ShimmerBar width="wide" size="lg" />
            <ShimmerBar width="mid" size="sm" />
          </div>
        </div>

        <div className={styles.formStack} aria-hidden="true">
          <div className={styles.fieldStack}>
            <ShimmerBar width="tiny" size="xs" />
            <ShimmerBar width="full" size="button" />
          </div>
          <div className={styles.fieldStack}>
            <ShimmerBar width="tiny" size="xs" />
            <ShimmerBar width="full" size="button" />
          </div>
        </div>

        <ShimmerBar width="full" size="button" />
      </div>
    </div>
  );
}

/**
 * Top-level Suspense fallback that picks the right skeleton based on context.
 * Used in layout.tsx as the default loading state.
 */
export function AppLoadingFallback({ variant }: { variant?: "vault" | "auth" }) {
  return (
    <div className={styles.appFallback} aria-busy="true">
      <div className={styles.appFrame}>
        <div className={styles.sidebarGhost} aria-hidden="true" />
        <div className={styles.contentGhost}>
          {variant === "auth" ? <AuthSkeleton /> : <VaultSkeleton />}
        </div>
      </div>
    </div>
  );
}
