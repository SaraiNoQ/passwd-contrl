/**
 * Auth state management for desktop app.
 *
 * Handles login via DesktopApiClient, session management, CSRF token.
 * Uses a module-level singleton configured at app startup — no React context.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { client as opaqueClient, ready as opaqueReady } from "@serenity-kit/opaque";
import type { SessionUserResponse } from "@zero-vault/shared";
import type { DesktopApiClient } from "../lib/api/types";

// Singleton API client — configured once at app startup
let apiClient: DesktopApiClient | null = null;

export function configureApiClient(client: DesktopApiClient): void {
  apiClient = client;
}

export function getApiClient(): DesktopApiClient | null {
  return apiClient;
}

function getClient(): DesktopApiClient {
  if (!apiClient) {
    throw new Error(
      "DesktopApiClient not configured. Call configureApiClient first.",
    );
  }
  return apiClient;
}

// ── Error message mapping (zh-CN) ──────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  user_not_found: "该邮箱未注册",
  invalid_credentials: "邮箱或密码不正确",
  invalid_login_session: "登录会话已过期，请重新登录",
  network_error: "网络错误，请检查连接",
  request_timeout: "请求超时",
  unauthorized: "登录已过期，请重新登录",
  forbidden: "访问被拒绝",
  opaque_unavailable: "加密登录组件暂时不可用，请稍后重试",
};

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "发生了未知错误";
  return ERROR_MESSAGES[error.message] ?? "发生了未知错误";
}

// ── Auth state hook ─────────────────────────────────────────────────────

export interface AuthState {
  user: { id: string; email: string; serverRevision: number } | null;
  csrfToken: string | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  restoreSession: () => Promise<void>;
}

export function useAuthState(): AuthState {
  const [user, setUser] = useState<SessionUserResponse["user"] | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const client = getClient();

        await opaqueReady.catch(() => {
          throw new Error("opaque_unavailable");
        });
        const started = opaqueClient.startLogin({ password });
        const startResponse = await client.loginStart(
          email,
          started.startLoginRequest,
        );
        const finished = opaqueClient.finishLogin({
          password,
          loginResponse: startResponse.loginResponse,
          clientLoginState: started.clientLoginState,
          identifiers: {
            client: email,
            server: "zero-vault",
          },
        });
        if (!finished) {
          throw new Error("invalid_credentials");
        }

        const session = await client.loginFinish(
          startResponse.loginSessionId,
          finished.finishLoginRequest,
        );

        if (mountedRef.current) {
          setUser(session.user);
          setCsrfToken(session.csrfToken);
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (mountedRef.current) {
          setError(getErrorMessage(err));
          setIsLoading(false);
        }
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    if (!csrfToken) {
      if (mountedRef.current) {
        setUser(null);
        setCsrfToken(null);
      }
      return;
    }
    try {
      const client = getClient();
      await client.logout(csrfToken);
    } catch {
      // Ignore logout errors — clear local state regardless
    }
    if (mountedRef.current) {
      setUser(null);
      setCsrfToken(null);
    }
  }, [csrfToken]);

  const restoreSession = useCallback(async (): Promise<void> => {
    try {
      const client = getClient();
      const session = await client.fetchCurrentUser();
      if (mountedRef.current) {
        setUser(session.user);
        setCsrfToken(session.csrfToken);
      }
    } catch (err: unknown) {
      // 401 or network error — clear state silently
      if (mountedRef.current) {
        setUser(null);
        setCsrfToken(null);
      }
    }
  }, []);

  return useMemo(
    () => ({
      user,
      csrfToken,
      isLoading,
      error,
      login,
      logout,
      clearError,
      restoreSession,
    }),
    [user, csrfToken, isLoading, error, login, logout, clearError, restoreSession],
  );
}
