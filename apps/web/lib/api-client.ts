import { client, ready } from "@serenity-kit/opaque";
import type {
  ItemLevelSyncPlan,
  ItemLevelSyncResponse,
  LoginStartResponse,
  RegisterStartResponse,
  SessionUserResponse,
  SyncPullResponse,
  SyncPushRequest,
  VaultItemHistoryResponse
} from "@zero-vault/shared";
import {
  itemLevelSyncResponseSchema,
  syncConflictResponseSchema
} from "@zero-vault/shared";
import { createRecoveryPacket, generateRecoveryCode } from "./recovery";
import { toBase64Url, fromBase64Url, encodeText, requestBlob, requestJson } from "./crypto-utils";
import { prepareWebDevice } from "./device-trust";

// ── Error Code Mapping ────────────────────────────────────────────────────────

/**
 * Maps server error codes and client-side error keys to zh-CN user-facing
 * messages. Never exposes raw error codes or stack traces to the UI.
 */
const ERROR_MESSAGE_MAP: Record<string, string> = {
  // OPAQUE / auth
  user_exists: "该邮箱已注册",
  user_not_found: "该邮箱未注册",
  invalid_credentials: "邮箱或密码不正确",
  device_approval_required: "请在已有可信设备上批准此浏览器后重试",
  invalid_device_credential: "浏览器设备身份已失效，请使用新的浏览器并重新批准",
  device_not_trusted: "此设备已被撤销，请重新接入",
  sync_receipt_invalid: "服务器同步确认无效，本地变更已保留，请稍后重试",
  sync_receipt_missing: "服务器未完整确认同步，本地变更已保留，请稍后重试",
  sync_cursor_invalid: "云端同步状态异常，本地数据已保留，请稍后重试",
  invalid_registration_session: "注册会话已过期，请重新开始",
  invalid_login_session: "登录会话已过期，请重新开始",
  csrf_token_required: "安全验证失败，请刷新页面",

  // Infrastructure
  opaque_unavailable: "加密服务暂时不可用，请稍后重试",
  request_timeout: "请求超时，请检查网络连接",
  network_error: "网络连接失败，请检查网络",

  // Sync
  sync_conflict: "同步冲突，请手动解决",
  item_owner_mismatch: "同步记录所有者不匹配，请重新登录后再试",
  invalid_item_sync_request: "同步请求格式无效，请刷新后重试",
  invalid_sync_request: "同步请求格式无效，请刷新后重试",
  approve_failed: "批准设备失败，请刷新设备列表后重试",
  reject_failed: "拒绝设备失败，请刷新设备列表后重试",
  revoke_failed: "撤销设备失败，请刷新设备列表后重试",
  not_authenticated: "请先登录",
  recent_authentication_required: "身份验证已过期，请使用主密码重新登录后再试",
  invalid_delete_account_response: "服务器未确认账户删除，请稍后重试",

  // Generic server error prefix (e.g. `request_failed_500`)
  request_failed_401: "请先登录",
  request_failed_403: "权限不足",
  request_failed_409: "同步冲突，请手动解决",
  request_failed_429: "请求过于频繁，请稍后重试",
  request_failed_500: "服务器内部错误，请稍后重试",
  request_failed_502: "服务器暂时不可用，请稍后重试",
  request_failed_503: "服务器维护中，请稍后重试"
};

const REQUEST_FAILED_PREFIX = "request_failed_";

/**
 * Convert any caught error into a zh-CN user-facing string.
 *
 * Checks known error codes first, then falls back to a safe generic message.
 * Never leaks raw error.message to avoid exposing stack traces or internal
 * implementation details in user-facing text.
 */
export const getErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return "发生了未知错误";
  }

  const raw = error.message;

  // Exact match in the map
  if (ERROR_MESSAGE_MAP[raw]) {
    return ERROR_MESSAGE_MAP[raw];
  }

  // Match `request_failed_NNN` pattern
  if (raw.startsWith(REQUEST_FAILED_PREFIX)) {
    const statusCode = raw.slice(REQUEST_FAILED_PREFIX.length);
    const key = `request_failed_${statusCode}`;
    if (ERROR_MESSAGE_MAP[key]) {
      return ERROR_MESSAGE_MAP[key];
    }
    return `请求失败（${statusCode}），请稍后重试`;
  }

  // Fallback: guard against exposing raw error text that might contain
  // stack traces, WASM paths, or internal details. Only show known-safe
  // user messages.
  if (raw.length < 80 && /^[一-鿿　-〿＀-￯ a-zA-Z0-9.,!?@#$%^&*()_+=\-:;"'<>[\]{}/|\\`~]+$/u.test(raw)) {
    // The message looks like a plain, short, safe string (e.g. thrown from
    // Validation messages like "主密码至少需要 12 个字符。")
    return raw;
  }

  return "发生了未知错误";
};

export const registerAccount = async (email: string, password: string) => {
  await ready;
  const started = client.startRegistration({ password });
  const startResponse = await requestJson<RegisterStartResponse>("/auth/register/start", {
    method: "POST",
    body: JSON.stringify({
      email,
      registrationRequest: started.registrationRequest
    })
  });
  const finished = client.finishRegistration({
    password,
    registrationResponse: startResponse.registrationResponse,
    clientRegistrationState: started.clientRegistrationState,
    identifiers: {
      client: email,
      server: "zero-vault"
    }
  });
  const recoveryCode = generateRecoveryCode();
  const exportKeyBytes = encodeText(finished.exportKey);
  const encryptedRecoveryPacket = await createRecoveryPacket(recoveryCode, exportKeyBytes);

  const result = await requestJson<{ userId: string }>("/auth/register/finish", {
    method: "POST",
    body: JSON.stringify({
      registrationSessionId: startResponse.registrationSessionId,
      email,
      registrationRecord: finished.registrationRecord,
      publicKeyBundle: finished.serverStaticPublicKey,
      encryptedRecoveryPacket
    })
  });
  return { ...result, recoveryCode };
};

type WebSessionResponse = SessionUserResponse & { device?: { id: string; status: "pending" | "approved" } };

export const loginAccount = async (email: string, password: string, deviceBound = typeof window !== "undefined" && !!window.localStorage.getItem("zero-vault.local.bound-session.v1")): Promise<WebSessionResponse> => {
  await ready;
  const started = client.startLogin({ password });
  const startResponse = await requestJson<LoginStartResponse>("/auth/login/start", {
    method: "POST",
    body: JSON.stringify({
      email,
      startLoginRequest: started.startLoginRequest
    })
  });
  const finished = client.finishLogin({
    password,
    loginResponse: startResponse.loginResponse,
    clientLoginState: started.clientLoginState,
    identifiers: {
      client: email,
      server: "zero-vault"
    }
  });
  if (!finished) {
    throw new Error("invalid_credentials");
  }

  const device = deviceBound ? await prepareWebDevice(email) : undefined;
  const session = await requestJson<WebSessionResponse>(deviceBound ? "/auth/web/login/finish" : "/auth/login/finish", {
    method: "POST",
    body: JSON.stringify({
      loginSessionId: startResponse.loginSessionId,
      finishLoginRequest: finished.finishLoginRequest,
      ...(device ? { device } : {})
    })
  });
  if (session.device) {
    window.localStorage.setItem("zero-vault.local.device-id.v1", session.device.id);
    window.localStorage.setItem("zero-vault.local.bound-session.v1", session.device.id);
  } else if (typeof window !== "undefined") {
    window.localStorage.removeItem("zero-vault.local.bound-session.v1");
  }
  return session;
};

export const fetchCurrentUser = () => requestJson<WebSessionResponse>("/auth/me");

export const downloadCloudExport = (exportId: string) => requestBlob(`/exports/${exportId}`);

export const logoutAccount = (csrfToken: string) =>
  requestJson<{ ok: true }>("/auth/logout", {
    method: "POST",
    headers: {
      "x-zero-vault-csrf": csrfToken
    },
    body: JSON.stringify({})
  });

export const pullVault = () => requestJson<SyncPullResponse>("/vault/sync");

export const pullItemLevelSync = async (cursor: number) => {
  const { itemLevelSyncPullResponseSchema } = await import("@zero-vault/shared");
  return itemLevelSyncPullResponseSchema.parse(await requestJson<unknown>(`/vault/item-sync?cursor=${cursor}`));
};

export const pushVault = (csrfToken: string, request: SyncPushRequest) =>
  requestJson<{ serverRevision: number }>("/vault/sync", {
    method: "POST",
    headers: {
      "x-zero-vault-csrf": csrfToken
    },
    body: JSON.stringify(request)
  });

export const pushItemLevelSync = async (csrfToken: string, plan: ItemLevelSyncPlan): Promise<ItemLevelSyncResponse> => {
  const response = await requestJson<unknown>("/vault/item-sync", {
    method: "POST",
    headers: {
      "x-zero-vault-csrf": csrfToken
    },
    body: JSON.stringify(plan)
  }, { acceptStatuses: [409] });

  if (typeof response === "object" && response !== null && "error" in response) {
    const conflict = syncConflictResponseSchema.parse(response);
    return {
      protocol: "item_level_v1",
      serverRevision: conflict.serverRevision,
      applied: conflict.applied,
      conflicts: conflict.conflicts
    };
  }

  return itemLevelSyncResponseSchema.parse(response);
};

export const encodeJsonForEnvelope = (value: unknown) => toBase64Url(encodeText(JSON.stringify(value)));

export const decodeJsonFromEnvelope = <T>(value: string): T => {
  const bytes = fromBase64Url(value);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
};

export const fetchRecoveryPacket = async (): Promise<import("./recovery").RecoveryPacket | null> => {
  try {
    const response = await requestJson<unknown>("/vault/recovery-packet");
    if (
      typeof response !== "object" ||
      response === null ||
      !("encryptedRecoveryPacket" in response)
    ) {
      throw new Error("recovery_packet_response_invalid");
    }
    const packet = response.encryptedRecoveryPacket;
    if (packet === null) return null;
    if (typeof packet !== "object") {
      throw new Error("recovery_packet_response_invalid");
    }
    return packet as import("./recovery").RecoveryPacket;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "recovery_packet_not_found" || error.message === "request_failed_404")
    ) {
      return null;
    }
    throw error;
  }
};

export const fetchItemHistory = async (itemId: string): Promise<VaultItemHistoryResponse> =>
  requestJson<VaultItemHistoryResponse>(`/vault/items/${itemId}/history`);

export const deleteAccount = async (csrfToken: string): Promise<void> => {
  const result = await requestJson<{ ok?: unknown }>("/auth/account", {
    method: "DELETE",
    headers: {
      "x-zero-vault-csrf": csrfToken
    },
    body: JSON.stringify({})
  });
  if (result.ok !== true) {
    throw new Error("invalid_delete_account_response");
  }
};
