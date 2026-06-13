/**
 * MobileApiClient — adapter interface for Worker API communication.
 *
 * Implements the same protocol as apps/web/lib/api-client.ts but:
 * - Does not depend on NEXT_PUBLIC_* env vars.
 * - Uses fetch with credentials: "include" for HttpOnly cookie auth.
 * - Handles 401, 403, offline, sync conflict, server revision advanced.
 *
 * OPAQUE client-side: the mobile app must run the OPAQUE client protocol
 * (same as apps/web) before calling login/finish. The OPAQUE WASM module
 * must be loaded separately — this client only handles HTTP transport.
 */

import type {
  LoginStartRequest,
  LoginStartResponse,
  LoginFinishRequest,
  SessionUserResponse,
  ItemLevelSyncPullResponse,
  ItemLevelSyncPlan,
  ItemLevelSyncResponse,
} from "@zero-vault/shared";

export type MobileApiError =
  | "network_error"
  | "request_timeout"
  | "unauthorized"
  | "forbidden"
  | "sync_conflict"
  | "server_revision_advanced"
  | string;

export interface MobileApiClientConfig {
  baseUrl: string;
  timeoutMs?: number;
}

export class MobileApiClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(config: MobileApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    options?: { acceptStatuses?: number[] }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: controller.signal,
        credentials: "include",
        headers: {
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("request_timeout");
      }
      throw new Error("network_error");
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => ({}))) as T & {
      error?: string;
    };
    if (!response.ok && !options?.acceptStatuses?.includes(response.status)) {
      if (response.status === 401) throw new Error("unauthorized");
      if (response.status === 403) throw new Error("forbidden");
      throw new Error(body.error ?? `request_failed_${response.status}`);
    }
    return body;
  }

  /** Expose baseUrl for diagnostic use. */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  /**
   * Direct login for MVP when OPAQUE client is not available.
   * Sends email + password directly to the server.
   * TODO: Replace with OPAQUE two-step loginStart/loginFinish
   *       once @serenity-kit/opaque WASM is ported to React Native.
   */
  async loginDirect(email: string, password: string): Promise<SessionUserResponse> {
    return this.request<SessionUserResponse>("/auth/login/direct", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async loginStart(email: string, startLoginRequest: string): Promise<LoginStartResponse> {
    return this.request<LoginStartResponse>("/auth/login/start", {
      method: "POST",
      body: JSON.stringify({ email, startLoginRequest } satisfies LoginStartRequest),
    });
  }

  async loginFinish(
    loginSessionId: string,
    finishLoginRequest: string
  ): Promise<SessionUserResponse> {
    return this.request<SessionUserResponse>("/auth/login/finish", {
      method: "POST",
      body: JSON.stringify({
        loginSessionId,
        finishLoginRequest,
      } satisfies LoginFinishRequest),
    });
  }

  async fetchCurrentUser(): Promise<SessionUserResponse> {
    return this.request<SessionUserResponse>("/auth/me");
  }

  async logout(csrfToken: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("/auth/logout", {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify({}),
    });
  }

  // ── Sync ────────────────────────────────────────────────────────────────

  async pullItems(serverRevision?: number): Promise<ItemLevelSyncPullResponse> {
    const qs = serverRevision != null ? `?serverRevision=${serverRevision}` : "";
    return this.request<ItemLevelSyncPullResponse>(`/vault/item-sync/pull${qs}`);
  }

  async pushItemLevelSync(
    csrfToken: string,
    plan: ItemLevelSyncPlan
  ): Promise<ItemLevelSyncResponse> {
    return this.request<ItemLevelSyncResponse>(
      "/vault/item-sync",
      {
        method: "POST",
        headers: { "x-zero-vault-csrf": csrfToken },
        body: JSON.stringify(plan),
      },
      { acceptStatuses: [409] }
    );
  }
}
