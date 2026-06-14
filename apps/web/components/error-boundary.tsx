"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
  Wifi,
  WifiOff
} from "lucide-react";
import styles from "./error-boundary.module.css";

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

const ERROR_MESSAGES: Record<
  ErrorKind,
  {
    title: string;
    description: string;
    status: string;
    signal: string;
    recovery: string;
    icon: ReactNode;
  }
> = {
  crypto: {
    title: "加密服务停机",
    description: "加密服务无法初始化。WebAssembly 可能被浏览器扩展或安全策略阻止，当前密码库已暂停解锁。",
    status: "服务暂停",
    signal: "CRYPTO_CORE",
    recovery: "检查浏览器安全策略后重试",
    icon: <ShieldAlert size={36} aria-hidden="true" />
  },
  network: {
    title: "同步连接断开",
    description: "无法连接到服务器。请检查网络连接或防火墙设置，本地密码库仍保持封存状态。",
    status: "同步断开",
    signal: "SYNC_LINK",
    recovery: "确认网络后刷新页面",
    icon: <WifiOff size={36} aria-hidden="true" />
  },
  auth: {
    title: "身份节点失效",
    description: "登录状态已过期或凭证无效。请重新登录，让设备重新加入你的授权同步。",
    status: "会话失效",
    signal: "AUTH_NODE",
    recovery: "刷新并重新完成身份验证",
    icon: <ShieldAlert size={36} aria-hidden="true" />
  },
  sync: {
    title: "记录同步暂停",
    description: "与服务器同步时发生错误。你的本地更改仍在队列中，稍后可以重新推送。",
    status: "同步暂停",
    signal: "BLOCK_QUEUE",
    recovery: "等待同步恢复后重试同步",
    icon: <RefreshCw size={36} aria-hidden="true" />
  },
  unknown: {
    title: "列表界面异常",
    description: "发生了意外错误。请先重试或刷新页面；如果问题持续，请保留当前设备状态再联系支持。",
    status: "界面异常",
    signal: "UI_LEDGER",
    recovery: "重试界面渲染或刷新",
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
          className={styles.errorBoundary}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          aria-labelledby="error-boundary-title"
          aria-describedby="error-boundary-description"
        >
          <main className={styles.panel}>
            <div className={styles.cloudField} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>

            <p className={styles.eyebrow} aria-hidden="true">
              OBSCURA FAILSAFE
            </p>

            <div className={styles.statusRail}>
              <span className={styles.statusDot} aria-hidden="true" />
              <span>{config.status}</span>
            </div>

            <div className={styles.icon}>{config.icon}</div>

            <h1 id="error-boundary-title" className={styles.title}>
              {config.title}
            </h1>

            <p id="error-boundary-description" className={styles.description}>
              {config.description}
            </p>

            <dl className={styles.diagnostics} aria-label="故障诊断摘要">
              <div className={styles.diagnosticItem}>
                <dt>信号</dt>
                <dd>{config.signal}</dd>
              </div>
              <div className={styles.diagnosticItem}>
                <dt>保护</dt>
                <dd>未暴露原始错误</dd>
              </div>
              <div className={styles.diagnosticItem}>
                <dt>下一步</dt>
                <dd>{config.recovery}</dd>
              </div>
            </dl>

            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.button} ${styles.primaryButton}`}
                onClick={this.handleRetry}
              >
                <RefreshCw size={16} aria-hidden="true" />
                重试同步
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.secondaryButton}`}
                onClick={() => window.location.reload()}
              >
                <Wifi size={16} aria-hidden="true" />
                刷新页面
              </button>
            </div>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}
