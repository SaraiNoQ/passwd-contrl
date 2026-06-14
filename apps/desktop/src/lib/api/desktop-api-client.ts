/**
 * DesktopApiClient — adapter interface for Worker API communication.
 *
 * Implements the same protocol as apps/web/lib/api-client.ts and
 * apps/mobile/src/lib/api/mobile-api-client.ts but:
 * - Does not depend on NEXT_PUBLIC_* env vars.
 * - Uses fetch with credentials: "include" for HttpOnly cookie auth.
 * - Handles 401, 403, offline, sync conflict, server revision advanced.
 * - Extends the mobile client pattern with full CRUD, device trust,
 *   and recovery methods.
 *
 * OPAQUE client-side: the desktop app must run the OPAQUE client protocol
 * before calling login/finish. The OPAQUE WASM module is loaded separately
 * — this client only handles HTTP transport.
 */

import type {
  LoginStartRequest,
  LoginStartResponse,
  LoginFinishRequest,
  SessionUserResponse,
  ItemLevelSyncPullResponse,
  ItemLevelSyncPlan,
  ItemLevelSyncResponse,
  ItemLevelEncryptedUpsert,
  RegisterDeviceRequest,
  DeviceListResponse,
  DeviceVaultKeyResponse,
  RecoveryPacketRequest,
  RecoveryPacketResponse,
} from "@zero-vault/shared";

export type DesktopApiError =
  | "network_error"
  | "request_timeout"
  | "unauthorized"
  | "forbidden"
  | "sync_conflict"
  | "server_revision_advanced"
  | string;

export interface DesktopApiClientConfig {
  baseUrl: string;
  timeoutMs?: number;
}

export class DesktopApiClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(config: DesktopApiClientConfig) {
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

  async loginDirect(
    email: string,
    password: string,
  ): Promise<SessionUserResponse> {
    return this.request<SessionUserResponse>("/auth/login/direct", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async loginStart(
    email: string,
    startLoginRequest: string
  ): Promise<LoginStartResponse> {
    return this.request<LoginStartResponse>("/auth/login/start", {
      method: "POST",
      body: JSON.stringify({
        email,
        startLoginRequest,
      } satisfies LoginStartRequest),
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

  async deleteAccount(csrfToken: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("/auth/account", {
      method: "DELETE",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify({}),
    });
  }

  // ── Sync ────────────────────────────────────────────────────────────────

  async pullItems(
    serverRevision?: number
  ): Promise<ItemLevelSyncPullResponse> {
    const qs =
      serverRevision != null ? `?serverRevision=${serverRevision}` : "";
    return this.request<ItemLevelSyncPullResponse>(
      `/vault/item-sync${qs}`
    );
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

  // ── CRUD (extension over mobile) ────────────────────────────────────────

  async createItem(
    csrfToken: string,
    upsert: ItemLevelEncryptedUpsert,
    baseRevision: number
  ): Promise<ItemLevelSyncResponse> {
    return this.pushItemLevelSync(csrfToken, {
      protocol: "item_level_v1",
      baseRevision,
      upserts: [upsert],
      deletes: [],
    });
  }

  async updateItem(
    csrfToken: string,
    upsert: ItemLevelEncryptedUpsert,
    baseRevision: number
  ): Promise<ItemLevelSyncResponse> {
    return this.pushItemLevelSync(csrfToken, {
      protocol: "item_level_v1",
      baseRevision,
      upserts: [upsert],
      deletes: [],
    });
  }

  async deleteItem(
    csrfToken: string,
    itemId: string,
    revision: number,
    ownerUserId: string,
    baseRevision: number
  ): Promise<ItemLevelSyncResponse> {
    return this.pushItemLevelSync(csrfToken, {
      protocol: "item_level_v1",
      baseRevision,
      upserts: [],
      deletes: [
        {
          id: itemId,
          ownerUserId,
          baseItemRevision: revision,
          deletedAt: new Date().toISOString(),
        },
      ],
    });
  }

  // ── Device Trust ────────────────────────────────────────────────────────

  async registerDevice(
    csrfToken: string,
    request: RegisterDeviceRequest
  ): Promise<unknown> {
    return this.request<unknown>("/devices", {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify(request),
    });
  }

  async listDevices(): Promise<DeviceListResponse> {
    return this.request<DeviceListResponse>("/devices");
  }

  async approveDevice(
    csrfToken: string,
    deviceId: string
  ): Promise<unknown> {
    return this.request<unknown>(`/devices/${deviceId}/approve`, {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify({}),
    });
  }

  async rejectDevice(
    csrfToken: string,
    deviceId: string
  ): Promise<unknown> {
    return this.request<unknown>(`/devices/${deviceId}/reject`, {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify({}),
    });
  }

  async revokeDevice(
    csrfToken: string,
    deviceId: string
  ): Promise<unknown> {
    return this.request<unknown>(`/devices/${deviceId}/revoke`, {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify({}),
    });
  }

  async shareVaultKey(
    csrfToken: string,
    deviceId: string,
    encryptedVaultKey: string
  ): Promise<unknown> {
    return this.request<unknown>(`/devices/${deviceId}/share-key`, {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify({ encryptedVaultKey }),
    });
  }

  // ── Recovery ────────────────────────────────────────────────────────────

  async uploadRecoveryPacket(
    csrfToken: string,
    packet: RecoveryPacketRequest
  ): Promise<unknown> {
    return this.request<unknown>("/vault/recovery-packet", {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify(packet),
    });
  }

  async downloadRecoveryPacket(): Promise<RecoveryPacketResponse> {
    return this.request<RecoveryPacketResponse>("/vault/recovery-packet");
  }
}
