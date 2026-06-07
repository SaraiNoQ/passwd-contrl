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

const ERROR_MESSAGES: Record<
  ErrorKind,
  { title: string; description: string; status: string; icon: ReactNode }
> = {
  crypto: {
    title: "密钥引擎停机",
    description: "加密服务无法初始化。WebAssembly 可能被浏览器扩展或安全策略阻止，当前密文账本已暂停解锁。",
    status: "密钥停机",
    icon: <ShieldAlert size={36} aria-hidden="true" />
  },
  network: {
    title: "同步链路断开",
    description: "无法连接到服务器。请检查网络连接或防火墙设置，本地密码库仍保持封存状态。",
    status: "链路断开",
    icon: <WifiOff size={36} aria-hidden="true" />
  },
  auth: {
    title: "身份节点失效",
    description: "登录状态已过期或凭证无效。请重新登录，让设备重新加入你的授权链路。",
    status: "会话失效",
    icon: <ShieldAlert size={36} aria-hidden="true" />
  },
  sync: {
    title: "区块同步暂停",
    description: "与服务器同步时发生错误。你的本地更改仍在队列中，稍后可以重新推送。",
    status: "同步暂停",
    icon: <RefreshCw size={36} aria-hidden="true" />
  },
  unknown: {
    title: "账本界面异常",
    description: "发生了意外错误。请先重试或刷新页面；如果问题持续，请保留当前设备状态再联系支持。",
    status: "界面异常",
    icon: <AlertTriangle size={36} aria-hidden="true" />
  }
};

const ERROR_BOUNDARY_CSS = `
  .error-boundary {
    display: grid;
    min-height: 100vh;
    place-items: center;
    padding: 24px;
    overflow: hidden;
    background:
      radial-gradient(circle at 18% 20%, rgba(255, 255, 255, 0.92) 0 0.5rem, transparent 0.55rem),
      radial-gradient(circle at 82% 76%, rgba(255, 255, 255, 0.8) 0 0.42rem, transparent 0.48rem),
      linear-gradient(var(--color-paper-white) 1px, transparent 1px),
      linear-gradient(90deg, var(--color-paper-white) 1px, transparent 1px),
      var(--color-cloud-mist);
    background-size: 160px 160px, 128px 128px, 24px 24px, 24px 24px, auto;
    color: var(--color-graphite-ink);
    font-family: var(--font-family);
  }

  .error-boundary__panel {
    position: relative;
    display: flex;
    width: min(100%, 560px);
    flex-direction: column;
    align-items: center;
    gap: 18px;
    padding: 56px 40px 40px;
    overflow: hidden;
    border: 1px solid var(--color-cloud-mist);
    border-radius: 16px;
    background:
      linear-gradient(90deg, rgba(227, 241, 254, 0.62) 1px, transparent 1px) 0 0 / 8px 8px,
      linear-gradient(180deg, rgba(227, 241, 254, 0.42), rgba(255, 255, 255, 0) 46%),
      var(--color-paper-white);
    box-shadow: var(--shadow-elevated);
    text-align: center;
    animation: error-panel-enter 320ms steps(5, end) both;
  }

  .error-boundary__panel::before {
    position: absolute;
    top: 18px;
    left: 24px;
    width: 10px;
    height: 10px;
    background: var(--color-signal-orange);
    box-shadow:
      16px 0 0 var(--color-cloud-mist),
      32px 0 0 var(--color-cloud-mist);
    content: "";
    image-rendering: pixelated;
  }

  .error-boundary__panel::after {
    position: absolute;
    right: 24px;
    bottom: 22px;
    width: 56px;
    height: 32px;
    background:
      linear-gradient(var(--color-cloud-mist) 0 0) 0 16px / 8px 8px no-repeat,
      linear-gradient(var(--color-paper-white) 0 0) 8px 16px / 40px 8px no-repeat,
      linear-gradient(var(--color-cloud-mist) 0 0) 48px 16px / 8px 8px no-repeat,
      linear-gradient(var(--color-paper-white) 0 0) 16px 8px / 24px 8px no-repeat,
      linear-gradient(var(--color-paper-white) 0 0) 24px 0 / 16px 8px no-repeat;
    content: "";
    opacity: 0.82;
    pointer-events: none;
  }

  .error-boundary__status {
    margin: 0;
    color: var(--color-signal-orange);
    font-family: var(--font-display);
    font-size: 36px;
    line-height: 1;
    letter-spacing: -0.02em;
  }

  .error-boundary__icon {
    display: grid;
    width: 80px;
    height: 80px;
    place-items: center;
    border: 1px solid var(--color-signal-orange);
    border-radius: 12px;
    background: var(--color-paper-white);
    color: var(--color-signal-orange);
    box-shadow:
      inset 0 0 0 8px rgba(227, 241, 254, 0.56),
      8px 8px 0 var(--color-cloud-mist);
    image-rendering: pixelated;
  }

  .error-boundary__title {
    margin: 0;
    color: var(--color-graphite-ink);
    font-family: var(--font-display);
    font-size: clamp(36px, 8vw, 48px);
    font-weight: 400;
    line-height: 0.95;
    letter-spacing: -0.025em;
  }

  .error-boundary__description {
    max-width: 390px;
    margin: -4px 0 0;
    color: var(--color-slate-pencil);
    font-family: var(--font-family);
    font-size: var(--text-body-size);
    line-height: 1.75;
  }

  .error-boundary__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
    width: 100%;
    margin-top: 4px;
  }

  .error-boundary__button {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 20px;
    border-radius: 6px;
    font-family: var(--font-family);
    font-size: var(--text-button-size);
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    transition:
      transform 140ms steps(2, end),
      border-color 140ms ease,
      background-color 140ms ease,
      box-shadow 140ms ease;
  }

  .error-boundary__button:hover {
    transform: translateY(-2px);
  }

  .error-boundary__button:active {
    transform: translateY(0);
  }

  .error-boundary__button:focus-visible {
    outline: 3px solid rgba(255, 94, 36, 0.22);
    outline-offset: 3px;
    box-shadow: var(--shadow-orange-ring);
  }

  .error-boundary__button--primary {
    border: 1px solid var(--color-signal-orange);
    background: var(--color-signal-orange);
    color: var(--color-text-inverse);
    box-shadow:
      rgba(255, 94, 36, 0.17) 0px 0.5px 0.5px 0.5px inset,
      rgba(153, 37, 18, 0.2) 0px -1px 0.5px 0px inset;
  }

  .error-boundary__button--secondary {
    border: 1px solid var(--color-cloud-mist);
    background: var(--color-paper-white);
    color: var(--color-graphite-ink);
    box-shadow: 0 3px 0 var(--color-cloud-mist);
  }

  .error-boundary__button--secondary:hover {
    border-color: var(--color-signal-orange);
    background: rgba(255, 94, 36, 0.08);
  }

  @keyframes error-panel-enter {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 520px) {
    .error-boundary {
      padding: 16px;
    }

    .error-boundary__panel {
      gap: 18px;
      padding: 40px 24px 28px;
    }

    .error-boundary__status {
      font-size: 36px;
    }

    .error-boundary__actions {
      flex-direction: column;
    }

    .error-boundary__button {
      width: 100%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .error-boundary__panel {
      animation: none;
    }

    .error-boundary__button {
      transition: none;
    }

    .error-boundary__button:hover {
      transform: none;
    }
  }
`;

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
        <>
          <style>{ERROR_BOUNDARY_CSS}</style>
          <div
            className="error-boundary"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            aria-labelledby="error-boundary-title"
            aria-describedby="error-boundary-description"
          >
            <main className="error-boundary__panel">
              <p className="error-boundary__status" aria-hidden="true">
                {config.status}
              </p>

              <div className="error-boundary__icon">{config.icon}</div>

              <h1 id="error-boundary-title" className="error-boundary__title">
                {config.title}
              </h1>

              <p
                id="error-boundary-description"
                className="error-boundary__description"
              >
                {config.description}
              </p>

              <div className="error-boundary__actions">
                <button
                  type="button"
                  className="error-boundary__button error-boundary__button--primary"
                  onClick={this.handleRetry}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  重试
                </button>
                <button
                  type="button"
                  className="error-boundary__button error-boundary__button--secondary"
                  onClick={() => window.location.reload()}
                >
                  <Wifi size={16} aria-hidden="true" />
                  刷新页面
                </button>
              </div>
            </main>
          </div>
        </>
      );
    }

    return this.props.children;
  }
}
