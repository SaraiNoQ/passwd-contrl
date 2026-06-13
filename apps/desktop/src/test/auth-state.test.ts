/**
 * Tests for useAuthState hook.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useAuthState,
  configureApiClient,
  getApiClient,
} from "../state/auth-state";
import type { DesktopApiClient } from "../lib/api/types";

// ── Helpers ─────────────────────────────────────────────────────────────

function createMockClient(
  overrides: Partial<DesktopApiClient> = {},
): DesktopApiClient {
  return {
    loginDirect: vi.fn().mockResolvedValue({
      user: { id: "u1", email: "test@example.com", serverRevision: 1 },
      csrfToken: "csrf-abc",
    }),
    fetchCurrentUser: vi.fn().mockResolvedValue({
      user: { id: "u1", email: "test@example.com", serverRevision: 1 },
      csrfToken: "csrf-abc",
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("configureApiClient / getApiClient", () => {
  beforeEach(() => {
    // Reset singleton by passing null (cast for testing)
    configureApiClient(null as unknown as DesktopApiClient);
  });

  it("returns null before configuration", () => {
    expect(getApiClient()).toBeNull();
  });

  it("stores and retrieves the singleton client", () => {
    const client = createMockClient();
    configureApiClient(client);
    expect(getApiClient()).toBe(client);
  });
});

describe("useAuthState", () => {
  let mockClient: DesktopApiClient;

  beforeEach(() => {
    mockClient = createMockClient();
    configureApiClient(mockClient);
  });

  // ── Initial state ──────────────────────────────────────────────────

  it("returns initial state with null user and no error", () => {
    const { result } = renderHook(() => useAuthState());

    expect(result.current.user).toBeNull();
    expect(result.current.csrfToken).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // ── Login flow ─────────────────────────────────────────────────────

  it("sets user and csrfToken on successful login", async () => {
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.login("test@example.com", "password123");
    });

    expect(result.current.user).toEqual({
      id: "u1",
      email: "test@example.com",
      serverRevision: 1,
    });
    expect(result.current.csrfToken).toBe("csrf-abc");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockClient.loginDirect).toHaveBeenCalledWith(
      "test@example.com",
      "password123",
    );
  });

  it("sets Chinese error on invalid_credentials", async () => {
    (mockClient.loginDirect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("invalid_credentials"),
    );
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.login("bad@example.com", "wrong");
    });

    expect(result.current.error).toBe("邮箱或密码不正确");
    expect(result.current.user).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("sets network error message on network_error", async () => {
    (mockClient.loginDirect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network_error"),
    );
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.login("test@example.com", "pw");
    });

    expect(result.current.error).toBe("网络错误，请检查连接");
  });

  it("sets timeout error message", async () => {
    (mockClient.loginDirect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("request_timeout"),
    );
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.login("test@example.com", "pw");
    });

    expect(result.current.error).toBe("请求超时");
  });

  it("sets unknown error for non-Error throws", async () => {
    (mockClient.loginDirect as ReturnType<typeof vi.fn>).mockRejectedValue(
      "string error",
    );
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.login("test@example.com", "pw");
    });

    expect(result.current.error).toBe("发生了未知错误");
  });

  it("sets isLoading true while login is in progress", async () => {
    let resolveLogin!: (v: unknown) => void;
    (mockClient.loginDirect as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      }),
    );

    const { result } = renderHook(() => useAuthState());

    act(() => {
      result.current.login("test@example.com", "pw");
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveLogin({
        user: { id: "u1", email: "test@example.com", serverRevision: 1 },
        csrfToken: "tok",
      });
    });

    expect(result.current.isLoading).toBe(false);
  });

  // ── clearError ─────────────────────────────────────────────────────

  it("clearError resets error to null", async () => {
    (mockClient.loginDirect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("invalid_credentials"),
    );
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.login("x@y.com", "bad");
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  // ── Session restore ────────────────────────────────────────────────

  it("restores session from fetchCurrentUser", async () => {
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.restoreSession();
    });

    expect(result.current.user).toEqual({
      id: "u1",
      email: "test@example.com",
      serverRevision: 1,
    });
    expect(result.current.csrfToken).toBe("csrf-abc");
    expect(mockClient.fetchCurrentUser).toHaveBeenCalled();
  });

  it("clears state silently on 401 during restore", async () => {
    (mockClient.fetchCurrentUser as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("unauthorized"),
    );
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.restoreSession();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.csrfToken).toBeNull();
    expect(result.current.error).toBeNull(); // silent — no error shown
  });

  // ── Logout ─────────────────────────────────────────────────────────

  it("calls api.logout and clears state", async () => {
    const { result } = renderHook(() => useAuthState());

    // Login first to get a csrfToken
    await act(async () => {
      await result.current.login("test@example.com", "pw");
    });
    expect(result.current.csrfToken).toBe("csrf-abc");

    await act(async () => {
      await result.current.logout();
    });

    expect(mockClient.logout).toHaveBeenCalledWith("csrf-abc");
    expect(result.current.user).toBeNull();
    expect(result.current.csrfToken).toBeNull();
  });

  it("clears local state even when api.logout throws", async () => {
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.login("test@example.com", "pw");
    });

    (mockClient.logout as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network_error"),
    );

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.csrfToken).toBeNull();
  });

  it("logout is a no-op (clears state) when no csrfToken exists", async () => {
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.logout();
    });

    expect(mockClient.logout).not.toHaveBeenCalled();
    expect(result.current.user).toBeNull();
    expect(result.current.csrfToken).toBeNull();
  });

  // ── Singleton not configured ───────────────────────────────────────

  it("throws when api client is not configured", async () => {
    configureApiClient(null as unknown as DesktopApiClient);
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.login("x@y.com", "pw");
    });

    expect(result.current.error).toBe("发生了未知错误");
  });

  // ── Error messages ─────────────────────────────────────────────────

  it("maps forbidden to Chinese error", async () => {
    (mockClient.loginDirect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("forbidden"),
    );
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.login("x@y.com", "pw");
    });

    expect(result.current.error).toBe("访问被拒绝");
  });

  it("maps user_not_found to Chinese error", async () => {
    (mockClient.loginDirect as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("user_not_found"),
    );
    const { result } = renderHook(() => useAuthState());

    await act(async () => {
      await result.current.login("x@y.com", "pw");
    });

    expect(result.current.error).toBe("该邮箱未注册");
  });
});
