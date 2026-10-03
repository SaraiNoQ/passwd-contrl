/**
 * MobileApiClient — adapter interface for Worker API communication.
 *
 * Implements the same protocol as apps/web/lib/api-client.ts but:
 * - Does not depend on NEXT_PUBLIC_* env vars.
 * - Uses an Android bearer session returned by the mobile OPAQUE finish route.
 * - Handles 401, 403, offline, sync conflict, server revision advanced.
 *
 * OPAQUE client-side: the mobile app must run the OPAQUE client protocol
 * (same as apps/web) before calling login/finish. The OPAQUE WASM module
 * must be loaded separately — this client only handles HTTP transport.
 */

import type {
  LoginStartRequest,
  LoginStartResponse,
  MobileRegisterFinishRequest,
  RegisterStartResponse,
  MobileDeviceLogin,
  MobileSessionResponse,
  SessionUserResponse,
  ItemLevelSyncPullResponse,
  ItemLevelSyncPlan,
  ItemLevelSyncResponse,
  SyncConflictResponse,
  TrustedDevice,
  DeviceVaultKeyPacket,
  DeviceVaultKeyResponse,
  RecoveryStartRequest,
  RecoveryStartResponse,
  RecoveryFinishRequest,
  RecoveryFinishResponse,
  RecoveryV2RotationRequest,
  VaultItemHistoryResponse,
  CloudExportMetadata,
} from "@zero-vault/shared";
import {
  deviceListResponseSchema,
  deviceVaultKeyResponseSchema,
  itemLevelSyncPullResponseSchema,
  itemLevelSyncResponseSchema,
  loginStartResponseSchema,
  mobileSessionResponseSchema,
  recoveryStartResponseSchema,
  recoveryStartRequestSchema,
  recoveryFinishResponseSchema,
  recoveryFinishRequestSchema,
  recoveryV2RotationRequestSchema,
  registerStartResponseSchema,
  sessionUserResponseSchema,
  syncConflictResponseSchema,
  trustedDeviceSchema,
  vaultItemHistoryResponseSchema,
  cloudExportListResponseSchema,
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
  onSessionInvalidated?: (sessionToken: string) => void;
}

export class MobileApiClient {
  private baseUrl: string;
  private timeoutMs: number;
  private sessionToken: string | null = null;
  private onSessionInvalidated: ((sessionToken: string) => void) | null;

  constructor(config: MobileApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.onSessionInvalidated = config.onSessionInvalidated ?? null;
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    options?: { acceptStatuses?: number[] }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const requestSessionToken = this.sessionToken;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const upstreamSignal = init?.signal;
    const abortFromCaller = () => controller.abort();
    if (upstreamSignal?.aborted) controller.abort();
    upstreamSignal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          signal: controller.signal,
          credentials: "omit",
          headers: {
            "content-type": "application/json",
            ...(requestSessionToken ? { authorization: "Bearer " + requestSessionToken } : {}),
            ...(init?.headers ?? {}),
          },
        });
      } catch {
        if (controller.signal.aborted) {
          throw new Error(timedOut ? "request_timeout" : "operation_cancelled");
        }
        throw new Error("network_error");
      }

      let body: T & { error?: string };
      try {
        body = await response.json() as T & { error?: string };
      } catch {
        if (controller.signal.aborted) {
          throw new Error(timedOut ? "request_timeout" : "operation_cancelled");
        }
        body = {} as T & { error?: string };
      }
      if (!response.ok && !options?.acceptStatuses?.includes(response.status)) {
        if (response.status === 401) {
          if (requestSessionToken) this.onSessionInvalidated?.(requestSessionToken);
          throw new Error(body.error ?? "unauthorized");
        }
        if (response.status === 403) throw new Error(body.error ?? "forbidden");
        throw new Error(body.error ?? "request_failed_" + response.status);
      }
      return body;
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", abortFromCaller);
    }
  }

  /** Expose baseUrl for diagnostic use. */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  setSessionToken(token: string | null): void {
    this.sessionToken = token;
  }

  setSessionInvalidationHandler(
    handler: ((sessionToken: string) => void) | null,
  ): void {
    this.onSessionInvalidated = handler;
  }

  clearSessionTokenIfMatches(token: string): boolean {
    if (this.sessionToken !== token) return false;
    this.sessionToken = null;
    return true;
  }

  async withSessionToken<T>(
    token: string,
    operation: (scopedClient: MobileApiClient) => Promise<T>,
  ): Promise<T> {
    const scopedClient = new MobileApiClient({
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      ...(this.onSessionInvalidated
        ? { onSessionInvalidated: this.onSessionInvalidated }
        : {}),
    });
    scopedClient.setSessionToken(token);
    return operation(scopedClient);
  }

  async withoutSessionToken<T>(
    operation: (scopedClient: MobileApiClient) => Promise<T>,
  ): Promise<T> {
    return operation(new MobileApiClient({
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      ...(this.onSessionInvalidated
        ? { onSessionInvalidated: this.onSessionInvalidated }
        : {}),
    }));
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  async loginStart(
    email: string,
    startLoginRequest: string,
    signal?: AbortSignal,
  ): Promise<LoginStartResponse> {
    const response = await this.request<unknown>("/auth/login/start", {
      method: "POST",
      ...(signal ? { signal } : {}),
      body: JSON.stringify({ email, startLoginRequest } satisfies LoginStartRequest),
    });
    return loginStartResponseSchema.parse(response);
  }

  async registerStart(
    email: string,
    registrationRequest: string,
    signal?: AbortSignal,
  ): Promise<RegisterStartResponse> {
    const response = await this.request<unknown>("/auth/register/start", {
      method: "POST",
      ...(signal ? { signal } : {}),
      body: JSON.stringify({ email, registrationRequest }),
    });
    return registerStartResponseSchema.parse(response);
  }

  async mobileRegisterFinish(
    request: MobileRegisterFinishRequest,
    signal?: AbortSignal,
  ): Promise<MobileSessionResponse> {
    try {
      return mobileSessionResponseSchema.parse(await this.request<unknown>("/auth/mobile/register/finish", {
        method: "POST",
        ...(signal ? { signal } : {}),
        body: JSON.stringify(request),
      }));
    } catch (error) {
      if (error instanceof Error && error.message === "not_found") {
        throw new Error("mobile_registration_unavailable");
      }
      throw error;
    }
  }

  async loginFinish(
    loginSessionId: string,
    finishLoginRequest: string,
    device: MobileDeviceLogin,
    signal?: AbortSignal,
  ): Promise<MobileSessionResponse> {
    const response = await this.request<unknown>("/auth/mobile/login/finish", {
      method: "POST",
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        loginSessionId,
        finishLoginRequest,
        device,
      }),
    });
    return mobileSessionResponseSchema.parse(response);
  }

  async fetchCurrentUser(): Promise<SessionUserResponse> {
    return sessionUserResponseSchema.parse(await this.request<unknown>("/auth/me"));
  }

  async logout(csrfToken: string): Promise<{ ok: true }> {
    const result = await this.request<{ ok: true }>("/auth/logout", {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify({}),
    });
    this.setSessionToken(null);
    return result;
  }

  async deleteAccount(csrfToken: string): Promise<{ ok: true }> {
    const result = await this.request<{ ok: true }>("/auth/account", {
      method: "DELETE",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify({}),
    });
    if (result.ok !== true) throw new Error("invalid_delete_account_response");
    this.setSessionToken(null);
    return result;
  }

  // ── Sync ────────────────────────────────────────────────────────────────

  async pullItems(cursor = 0): Promise<ItemLevelSyncPullResponse> {
    const qs = `?cursor=${cursor}`;
    return itemLevelSyncPullResponseSchema.parse(
      await this.request<unknown>(`/vault/item-sync${qs}`)
    );
  }

  async pushItemLevelSync(
    csrfToken: string,
    plan: ItemLevelSyncPlan
  ): Promise<ItemLevelSyncResponse | SyncConflictResponse> {
    const response = await this.request<unknown>(
      "/vault/item-sync",
      {
        method: "POST",
        headers: { "x-zero-vault-csrf": csrfToken },
        body: JSON.stringify(plan),
      },
      { acceptStatuses: [409] }
    );
    if (typeof response === "object" && response !== null && "error" in response) {
      return syncConflictResponseSchema.parse(response);
    }
    return itemLevelSyncResponseSchema.parse(response);
  }

  // ── Device trust ───────────────────────────────────────────────────────

  async fetchItemHistory(itemId: string, signal?: AbortSignal): Promise<VaultItemHistoryResponse> {
    return vaultItemHistoryResponseSchema.parse(await this.request<unknown>(
      `/vault/items/${encodeURIComponent(itemId)}/history`,
      signal ? { signal } : undefined,
    ));
  }

  async fetchCurrentDevice(): Promise<TrustedDevice> {
    const response = await this.request<{ device?: unknown }>("/devices/self");
    return trustedDeviceSchema.parse(response.device);
  }

  async listDevices(): Promise<TrustedDevice[]> {
    return deviceListResponseSchema.parse(await this.request<unknown>("/devices")).devices;
  }

  async approveDevice(
    csrfToken: string,
    deviceId: string,
    encryptedVaultKeyPacket: DeviceVaultKeyPacket,
  ): Promise<{ ok: true }> {
    return this.request(`/devices/${encodeURIComponent(deviceId)}/approve`, {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify({ encryptedVaultKeyPacket }),
    });
  }

  async rejectDevice(csrfToken: string, deviceId: string): Promise<{ ok: true }> {
    return this.deviceAction(csrfToken, deviceId, "reject");
  }

  async revokeDevice(csrfToken: string, deviceId: string): Promise<{ ok: true }> {
    return this.deviceAction(csrfToken, deviceId, "revoke");
  }

  async getDeviceVaultKey(deviceId: string): Promise<DeviceVaultKeyResponse> {
    return deviceVaultKeyResponseSchema.parse(
      await this.request<unknown>(`/devices/${encodeURIComponent(deviceId)}/key`),
    );
  }

  async shareDeviceVaultKey(
    csrfToken: string,
    deviceId: string,
    encryptedVaultKeyPacket: DeviceVaultKeyPacket,
  ): Promise<{ ok: true }> {
    return this.request(`/devices/${encodeURIComponent(deviceId)}/share-key`, {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify({ encryptedVaultKeyPacket }),
    });
  }

  // ── Recovery ───────────────────────────────────────────────────────────

  async startRecoveryV2(
    request: RecoveryStartRequest,
    signal?: AbortSignal,
  ): Promise<RecoveryStartResponse> {
    const body = recoveryStartRequestSchema.parse(request);
    return recoveryStartResponseSchema.parse(await this.request<unknown>("/auth/recovery/start", {
      method: "POST",
      ...(signal ? { signal } : {}),
      body: JSON.stringify(body),
    }));
  }

  async finishRecoveryV2(
    request: RecoveryFinishRequest,
    signal?: AbortSignal,
  ): Promise<RecoveryFinishResponse> {
    const body = recoveryFinishRequestSchema.parse(request);
    return recoveryFinishResponseSchema.parse(await this.request<unknown>("/auth/recovery/finish", {
      method: "POST",
      ...(signal ? { signal } : {}),
      body: JSON.stringify(body),
    }));
  }

  async rotateRecoveryV2(
    csrfToken: string,
    request: RecoveryV2RotationRequest,
  ): Promise<RecoveryFinishResponse> {
    const body = recoveryV2RotationRequestSchema.parse(request);
    return recoveryFinishResponseSchema.parse(await this.request<unknown>("/vault/recovery/rotate", {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify(body),
    }));
  }

  // ── Encrypted cloud backups ───────────────────────────────────────────

  async listCloudBackups(): Promise<CloudExportMetadata[]> {
    return cloudExportListResponseSchema.parse(
      await this.request<unknown>("/exports"),
    ).exports.filter((entry) => entry.algorithm === "ZERO_VAULT_MOBILE_BACKUP_V2");
  }

  async createCloudBackup(
    csrfToken: string,
    exportId: string,
    encryptedSnapshot: string,
  ): Promise<{ ok: true }> {
    if (!encryptedSnapshot || encryptedSnapshot.length > 50 * 1_048_576) {
      throw new Error("encrypted_backup_invalid");
    }
    return this.request("/exports/create", {
      method: "POST",
      headers: {
        "x-zero-vault-csrf": csrfToken,
        "x-export-id": exportId,
        "x-export-algorithm": "ZERO_VAULT_MOBILE_BACKUP_V2",
        "content-type": "application/octet-stream",
      },
      body: encryptedSnapshot,
    });
  }

  async downloadCloudBackup(exportId: string): Promise<string> {
    const requestSessionToken = this.sessionToken;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/exports/${encodeURIComponent(exportId)}`, {
          signal: controller.signal,
          credentials: "omit",
          headers: requestSessionToken ? { authorization: `Bearer ${requestSessionToken}` } : {},
        });
      } catch {
        throw new Error(controller.signal.aborted ? "request_timeout" : "network_error");
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (response.status === 401 && requestSessionToken) {
          this.onSessionInvalidated?.(requestSessionToken);
        }
        throw new Error(body.error ?? `request_failed_${response.status}`);
      }
      if (response.headers.get("x-export-algorithm") !== "ZERO_VAULT_MOBILE_BACKUP_V2") {
        throw new Error("cloud_backup_incompatible");
      }
      const declaredSize = Number(response.headers.get("content-length") ?? "0");
      if (declaredSize > 50 * 1_048_576) throw new Error("encrypted_backup_too_large");
      const snapshot = await response.text();
      if (!snapshot || snapshot.length > 50 * 1_048_576) throw new Error("encrypted_backup_invalid");
      return snapshot;
    } finally {
      clearTimeout(timeout);
    }
  }

  async deleteCloudBackup(csrfToken: string, exportId: string): Promise<{ ok: true }> {
    return this.request(`/exports/${encodeURIComponent(exportId)}`, {
      method: "DELETE",
      headers: { "x-zero-vault-csrf": csrfToken },
    });
  }

  private deviceAction(
    csrfToken: string,
    deviceId: string,
    action: "reject" | "revoke",
  ): Promise<{ ok: true }> {
    return this.request(`/devices/${encodeURIComponent(deviceId)}/${action}`, {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify({}),
    });
  }
}
