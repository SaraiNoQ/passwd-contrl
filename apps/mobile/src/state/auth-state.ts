/**
 * Auth state management for mobile app.
 *
 * Handles login via MobileApiClient, session management, CSRF token.
 * Uses MobileApiClient for all HTTP transport.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { SessionUserResponse } from "@zero-vault/shared";
import { MobileApiClient } from "../lib/api/mobile-api-client";

// Singleton API client — configured once at app startup
let apiClient: MobileApiClient | null = null;

export function configureApiClient(config: { baseUrl: string }) {
  apiClient = new MobileApiClient({ baseUrl: config.baseUrl });
}

export function getApiClient(): MobileApiClient | null {
  return apiClient;
}

function getClient(): MobileApiClient {
  if (!apiClient) {
    throw new Error("MobileApiClient not configured. Call configureApiClient first.");
  }
  return apiClient;
}

// ── Error message mapping (zh-CN, same as apps/web) ──────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  user_not_found: "该邮箱未注册",
  invalid_credentials: "邮箱或密码不正确",
  invalid_login_session: "登录会话已过期，请重新开始",
  network_error: "网络连接失败，请检查网络",
  request_timeout: "请求超时，请检查网络连接",
  unauthorized: "请先登录",
  forbidden: "权限不足",
};

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "发生了未知错误";
  return ERROR_MESSAGES[error.message] ?? "发生了未知错误";
}

// ── Auth state hook ──────────────────────────────────────────────────────

export interface AuthState {
  user: SessionUserResponse["user"] | null;
  csrfToken: string | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
  restoreSession: () => Promise<boolean>;
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

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const client = getClient();

      // MVP: direct login (OPAQUE requires WASM port to React Native)
      // TODO: Replace with OPAQUE two-step loginStart/loginFinish
      //       once @serenity-kit/opaque WASM is available in RN.
      const session = await client.loginDirect(email, password);

      if (mountedRef.current) {
        setUser(session.user);
        setCsrfToken(session.csrfToken);
        setIsLoading(false);
      }
      return true;
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError(getErrorMessage(err));
        setIsLoading(false);
      }
      return false;
    }
  }, []);

  const logout = useCallback(async () => {
    if (!csrfToken) return;
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

  const restoreSession = useCallback(async (): Promise<boolean> => {
    try {
      const client = getClient();
      const session = await client.fetchCurrentUser();
      if (mountedRef.current) {
        setUser(session.user);
        setCsrfToken(session.csrfToken);
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  return { user, csrfToken, isLoading, error, login, logout, clearError, restoreSession };
}
