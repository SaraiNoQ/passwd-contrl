"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
  Wifi,
  WifiOff
} from "lucide-react";

type ErrorKind =
  | "crypto"
  | "network"
  | "auth"
  | "sync"
  | "unknown";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorKind: ErrorKind;
}

const ERROR_MESSAGES: Record<ErrorKind, { title: string; description: string; icon: ReactNode }> = {
  crypto: {
    title: "加密模块加载失败",
    description: "加密服务无法初始化。WebAssembly 可能被浏览器扩展或安全策略阻止，请检查后重试。",
    icon: <ShieldAlert size={36} aria-hidden="true" />
  },
  network: {
    title: "网络连接失败",
    description: "无法连接到服务器。请检查网络连接或防火墙设置。",
    icon: <WifiOff size={36} aria-hidden="true" />
  },
  auth: {
    title: "身份验证失败",
    description: "登录状态已过期或凭证无效，请重新登录。",
    icon: <ShieldAlert size={36} aria-hidden="true" />
  },
  sync: {
    title: "同步失败",
    description: "与服务器同步时发生错误，请稍后重试。",
    icon: <RefreshCw size={36} aria-hidden="true" />
  },
  unknown: {
    title: "应用程序错误",
    description: "发生了意外错误。请尝试刷新页面，如果问题持续请联系支持。",
    icon: <AlertTriangle size={36} aria-hidden="true" />
  }
};

function classifyError(error: Error | null): ErrorKind {
  if (!error) return "unknown";

  const message = error.message.toLowerCase();

  // Crypto / OPAQUE / WebAssembly errors
  if (
    message.includes("webassembly") ||
    message.includes("opaque") ||
    message.includes("crypto") ||
    message.includes("encrypt") ||
    message.includes("decrypt") ||
    message.includes("argon2") ||
    message.includes("derive") ||
    message.includes("key") ||
    message.includes("wasm")
  ) {
    return "crypto";
  }

  // Network errors
  if (
    message.includes("network_error") ||
    message.includes("request_timeout") ||
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("abort") ||
    message.includes("timeout")
  ) {
    return "network";
  }

  // Auth errors
  if (
    message.includes("invalid_credentials") ||
    message.includes("invalid_registration_session") ||
    message.includes("invalid_login_session") ||
    message.includes("csrf") ||
    message.includes("unauthorized") ||
    message.includes("session") ||
    message.includes("user_not_found") ||
    message.includes("user_exists")
  ) {
    return "auth";
  }

  // Sync errors
  if (
    message.includes("sync_conflict") ||
    message.includes("sync") ||
    message.includes("conflict") ||
    message.includes("revision")
  ) {
    return "sync";
  }

  return "unknown";
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorKind: "unknown" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorKind: classifyError(error) };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details to console for debugging only — never expose to UI
    console.error(
      "[ZeroVault ErrorBoundary]",
      error.message,
      "\nComponent stack:",
      errorInfo.componentStack ?? "(not available)"
    );
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorKind: "unknown" });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { errorKind } = this.state;
      const config = ERROR_MESSAGES[errorKind];

      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            background: "var(--color-bg-root)",
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-family)",
            padding: "24px"
          }}
        >
          <div
            style={{
              background: "var(--color-bg-panel)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-lg)",
              padding: "48px 40px",
              maxWidth: "480px",
              width: "100%",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "20px"
            }}
          >
            {/* Icon */}
            <div
              style={{
                width: "72px",
                height: "72px",
                borderRadius: "50%",
                background:
                  errorKind === "crypto" || errorKind === "auth"
                    ? "rgba(251, 113, 133, 0.12)"
                    : errorKind === "network"
                      ? "rgba(245, 158, 11, 0.12)"
                      : "rgba(148, 163, 184, 0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color:
                  errorKind === "crypto" || errorKind === "auth"
                    ? "var(--color-danger)"
                    : errorKind === "network"
                      ? "var(--color-warning)"
                      : "var(--color-text-muted)"
              }}
            >
              {config.icon}
            </div>

            {/* Title */}
            <h1
              style={{
                fontSize: "var(--text-page-title-size)",
                fontWeight: "var(--text-page-title-weight)",
                lineHeight: "var(--text-page-title-height)",
                margin: 0
              }}
            >
              {config.title}
            </h1>

            {/* Description */}
            <p
              style={{
                fontSize: "var(--text-body-size)",
                lineHeight: "var(--text-body-height)",
                color: "var(--color-text-muted)",
                maxWidth: "360px",
                margin: 0
              }}
            >
              {config.description}
            </p>

            {/* Actions */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                marginTop: "4px",
                flexWrap: "wrap",
                justifyContent: "center"
              }}
            >
              <button
                type="button"
                onClick={this.handleRetry}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background:
                    "linear-gradient(135deg, var(--color-primary), #06b6d4)",
                  color: "var(--color-text-inverse)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 20px",
                  fontSize: "var(--text-button-size)",
                  fontWeight: 700,
                  cursor: "pointer",
                  minHeight: "40px"
                }}
              >
                <RefreshCw size={16} aria-hidden="true" />
                重试
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "var(--color-bg-panel-soft)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 20px",
                  fontSize: "var(--text-button-size)",
                  fontWeight: 600,
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                  minHeight: "40px"
                }}
              >
                <Wifi size={16} aria-hidden="true" />
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
