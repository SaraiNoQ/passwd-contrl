"use client";

import type { ReactNode } from "react";
import { cn } from "../lib/utils";

/**
 * CSS-only shimmer animation.
 * Applied via a global style injected once per page load.
 * The animation uses the dark theme surface colors for contrast.
 */
const SHIMMER_CSS = `
@keyframes vault-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;

let shimmerStyleInjected = false;

function injectShimmerStyle() {
  if (typeof document === "undefined" || shimmerStyleInjected) return;
  const style = document.createElement("style");
  style.textContent = SHIMMER_CSS;
  document.head.appendChild(style);
  shimmerStyleInjected = true;
}

/**
 * A single shimmer bar (ghost row) that pulses with a subtle gradient animation.
 */
function ShimmerBar({
  width = "100%",
  height = "16px",
  className
}: {
  width?: string;
  height?: string;
  className?: string;
}) {
  injectShimmerStyle();

  return (
    <div
      className={cn("vault-shimmer-bar", className)}
      style={{
        width,
        height,
        borderRadius: "var(--radius-sm)",
        background:
          "linear-gradient(90deg, var(--color-bg-panel) 25%, var(--color-bg-panel-soft) 37%, var(--color-bg-panel) 63%)",
        backgroundSize: "200% 100%",
        animation: "vault-shimmer 1.6s ease-in-out infinite"
      }}
      aria-hidden="true"
    />
  );
}

/**
 * Placeholder for the vault password list (5 ghost rows matching the credential table).
 */
export function VaultSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        width: "100%"
      }}
      role="status"
      aria-label="加载凭据列表"
    >
      {/* Stats row */}
      <div
        className="stats-grid"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))"
        }}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="stat-card"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              padding: "16px"
            }}
          >
            <ShimmerBar width="60%" height="12px" />
            <ShimmerBar width="40%" height="20px" />
          </div>
        ))}
      </div>

      {/* Filter tabs placeholder */}
      <div style={{ display: "flex", gap: "6px" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <ShimmerBar key={i} width="64px" height="28px" />
        ))}
      </div>

      {/* Credential list header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "4px"
        }}
      >
        <ShimmerBar width="120px" height="24px" />
        <ShimmerBar width="100px" height="36px" />
      </div>

      {/* 5 ghost rows mimicking the credential table */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "var(--color-border)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          gap: "1px"
        }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns:
                "minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 0.6fr) auto auto",
              gap: "12px",
              padding: "12px 16px",
              alignItems: "center",
              background: "var(--color-bg-panel)",
              minHeight: "48px"
            }}
          >
            <div>
              <ShimmerBar width="70%" height="14px" />
              <div style={{ marginTop: "4px" }}>
                <ShimmerBar width="50%" height="10px" />
              </div>
            </div>
            <ShimmerBar width="60%" height="13px" />
            <ShimmerBar width="80%" height="13px" />
            <ShimmerBar width="40%" height="13px" />
            <ShimmerBar width="24px" height="24px" />
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
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        padding: "24px"
      }}
      role="status"
      aria-label="加载中"
    >
      <div
        style={{
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          padding: "32px",
          width: "100%",
          maxWidth: "420px",
          display: "flex",
          flexDirection: "column",
          gap: "24px"
        }}
      >
        {/* Title area */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "14px"
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "var(--radius-md)",
              flexShrink: 0
            }}
          >
            <ShimmerBar width="32px" height="32px" />
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
            <ShimmerBar width="70%" height="20px" />
            <ShimmerBar width="50%" height="14px" />
          </div>
        </div>

        {/* Form fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <ShimmerBar width="50px" height="13px" />
            <ShimmerBar width="100%" height="40px" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <ShimmerBar width="50px" height="13px" />
            <ShimmerBar width="100%" height="40px" />
          </div>
        </div>

        {/* Submit button */}
        <ShimmerBar width="100%" height="40px" />
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
    <div
      style={{
        background: "var(--color-bg-root)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-family)",
        minHeight: "100vh"
      }}
    >
      {/* Simulated empty sidebar */}
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <div
          style={{
            width: "var(--sidebar-width)",
            flexShrink: 0,
            background: "var(--color-bg-shell)",
            borderRight: "1px solid var(--color-border)"
          }}
        />
        <div
          style={{
            flex: 1,
            padding: "24px"
          }}
        >
          {variant === "auth" ? <AuthSkeleton /> : <VaultSkeleton />}
        </div>
      </div>
    </div>
  );
}
