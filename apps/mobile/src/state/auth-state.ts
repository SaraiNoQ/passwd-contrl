import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  mobileSessionResponseSchema,
  type MobileSessionResponse,
  type SessionUserResponse,
  type TrustedDevice,
} from "@zero-vault/shared";
import { resetNativeDeviceLogin } from "@zero-vault/zero-vault-native";
import { MobileApiClient } from "../lib/api/mobile-api-client";
import { allowsOfflineSessionFallback } from "../lib/auth/offline-session-policy";
import type { MobileOpaqueAuthAdapter } from "../lib/auth/native-mobile-auth-adapter";
import type { MobileSecureStore } from "../lib/storage/mobile-secure-store";

let apiClient: MobileApiClient | null = null;
let secureStore: MobileSecureStore | null = null;
let opaqueAuth: MobileOpaqueAuthAdapter | null = null;
const SESSION_BUNDLE_KEY = "session_bundle_v1";
const LEGACY_SESSION_TOKEN_KEY = "session_token";
const SESSION_INVALIDATION_ERRORS = new Set([
  "unauthorized",
  "not_authenticated",
  "forbidden",
  "device_not_trusted",
  "invalid_device_credential",
]);

function encodeStoredSession(session: MobileSessionResponse): string {
  return JSON.stringify({ version: 1, session: mobileSessionResponseSchema.parse(session) });
}

function decodeStoredSession(value: string | null): MobileSessionResponse | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { version?: unknown; session?: unknown };
    if (parsed.version !== 1) return null;
    return mobileSessionResponseSchema.parse(parsed.session);
  } catch {
    return null;
  }
}

function invalidatesStoredSession(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return SESSION_INVALIDATION_ERRORS.has(
    typeof code === "string" ? code.toLowerCase() : error.message.toLowerCase(),
  );
}

export function configureApiClient(config: { baseUrl: string }): void {
  apiClient = new MobileApiClient({ baseUrl: config.baseUrl });
}

export function configureAuthDependencies(deps: {
  secureStore: MobileSecureStore;
  opaqueAuth?: MobileOpaqueAuthAdapter;
}): void {
  secureStore = deps.secureStore;
  opaqueAuth = deps.opaqueAuth ?? null;
}

export function getApiClient(): MobileApiClient | null {
  return apiClient;
}

function getClient(): MobileApiClient {
  if (!apiClient) throw new Error("mobile_api_not_configured");
  return apiClient;
}

const ERROR_MESSAGES: Record<string, string> = {
  user_not_found: "该邮箱未注册",
  invalid_credentials: "邮箱或密码不正确",
  invalid_login_session: "登录会话已过期，请重新开始",
  invalid_registration_session: "注册会话已过期，请重新开始",
  invalid_register_start_request: "注册请求无效，请检查邮箱格式后重试",
  invalid_register_finish_request: "注册数据无法被服务器接受，请更新应用后重试",
  user_exists: "该邮箱已注册",
  network_error: "网络连接失败，请检查网络",
  request_timeout: "请求超时，请检查网络连接",
  request_failed_404: "服务器尚未部署移动端注册接口",
  request_failed_500: "服务器注册失败，请稍后重试",
  request_failed_503: "服务器安全登录服务暂不可用，请稍后重试",
  operation_cancelled: "操作已取消",
  unauthorized: "请重新登录",
  not_authenticated: "请重新登录",
  forbidden: "权限不足",
  native_auth_unavailable: "安全登录模块尚未安装，禁止使用不安全登录",
  native_unavailable: "安全登录模块不可用，禁止继续",
  opaque_interop_unverified: "原生安全登录尚未通过兼容性验证，禁止继续",
  opaque_unavailable: "服务器安全登录服务暂不可用，请稍后重试",
  mobile_registration_unavailable: "服务器版本过旧，尚未部署移动端注册服务",
  device_approval_required: "此设备正在等待可信设备批准",
  device_id_conflict: "本机设备标识已被占用，请清除应用数据后重试",
  invalid_device_credential: "本机设备凭据无法通过验证，请在可信设备中检查设备状态",
  device_not_trusted: "此设备已被拒绝或撤销",
  device_identity_mismatch: "本机设备身份与账户不匹配，已安全中止",
  device_credential_missing: "本机设备凭据缺失，请重新注册此设备",
  device_not_initialized: "本机设备身份尚未完成初始化，请重新开始",
  device_key_recipient_mismatch: "密码库密钥包与本机设备不匹配，已安全中止",
  key_not_shared: "可信设备尚未分发密码库密钥",
  auth_invalid: "邮箱、密码或设备认证信息无效",
  auth_expired: "安全验证已过期，请重新开始",
  auth_required: "需要验证设备身份后才能继续",
  auth_unavailable: "当前无法验证设备身份",
  crypto_failure: "加密操作失败，已安全中止",
  invalid_argument: "输入数据无效，请检查后重试",
  invalid_kdf_params: "安全参数无效，请更新应用后重试",
  vault_locked: "密码库已锁定，请重新解锁",
  key_invalidated: "设备安全密钥已失效，请使用恢复流程重新绑定",
  ciphertext_tampered: "本机受保护数据校验失败，已安全中止",
  secure_storage_failure: "本机安全存储失败，未保存登录会话",
  native_failure: "本机安全模块操作失败，已安全中止",
  recovery_material_missing: "恢复码材料不完整，请重新登录后重试",
  registration_local_setup_failed: "账户已在服务器创建，但本机初始化未完成。请返回登录页，使用刚才的邮箱和主密码登录以继续绑定本机",
  registration_commit_unconfirmed: "无法确认账户是否已在服务器创建。请先返回登录页使用刚才的邮箱和主密码登录；仅在确认邮箱未注册后再重新创建",
  recovery_auth_expired: "恢复验证已过期，请重新开始",
  recovery_reconcile_required: "恢复提交状态尚未确认，请使用新主密码重新登录",
  recovery_failed: "恢复失败。邮箱、恢复码或加密恢复材料无效，未执行不安全降级",
  recovery_commit_unconfirmed: "无法确认恢复是否已提交。请使用新主密码执行普通登录，不要删除本机恢复材料",
  account_deletion_storage_unavailable: "云端安全存储暂不可用，账户和本机数据均未删除，请稍后重试",
  account_deletion_incomplete: "云端加密备份清理未完成，账户和本机数据均未删除，请稍后重试",
};

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "发生了未知错误";
  const code = (error as Error & { code?: unknown }).code;
  const codeMessage = typeof code === "string" ? ERROR_MESSAGES[code.toLowerCase()] : undefined;
  if (codeMessage) {
    return codeMessage;
  }
  return ERROR_MESSAGES[error.message.toLowerCase()] ?? "发生了未知错误";
}

async function revokeUnpersistedSession(
  client: MobileApiClient,
  session: MobileSessionResponse,
): Promise<void> {
  try {
    await client.withSessionToken(
      session.sessionToken,
      (scopedClient) => scopedClient.logout(session.csrfToken),
    );
  } catch {
    // No local reference is retained; the next login rotates this device session.
  }
}

export interface AuthState {
  user: SessionUserResponse["user"] | null;
  csrfToken: string | null;
  device: Pick<TrustedDevice, "id" | "status"> | null;
  registrationRecoveryCode: string | null;
  isLoading: boolean;
  isRestoring: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string) => Promise<boolean>;
  recoverAccount: (email: string, recoveryCode: string, newPassword: string) => Promise<boolean>;
  authorizeVaultUnlock: (masterPassword: string) => Promise<boolean>;
  logout: () => Promise<boolean>;
  beginTrustedDeviceRebind: () => Promise<boolean>;
  deleteAccount: () => Promise<boolean>;
  clearError: () => void;
  restoreSession: () => Promise<boolean>;
  refreshDevice: () => Promise<TrustedDevice | null>;
  clearRegistrationRecoveryCode: () => Promise<boolean>;
}

export function useAuthStateController(): AuthState {
  const [user, setUser] = useState<SessionUserResponse["user"] | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [device, setDevice] = useState<Pick<TrustedDevice, "id" | "status"> | null>(null);
  const [registrationRecoveryCode, setRegistrationRecoveryCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const operationGenerationRef = useRef(0);
  const operationAbortRef = useRef<AbortController | null>(null);
  const authQueueRef = useRef<Promise<void>>(Promise.resolve());
  const recoveryEmailRef = useRef<string | null>(null);
  const invalidatingSessionTokensRef = useRef(new Set<string>());

  const invalidateSession = useCallback((rejectedToken: string): void => {
    if (invalidatingSessionTokensRef.current.has(rejectedToken)) return;
    invalidatingSessionTokensRef.current.add(rejectedToken);

    const invalidatedActiveSession = getClient().clearSessionTokenIfMatches(rejectedToken);
    if (invalidatedActiveSession) {
      operationGenerationRef.current += 1;
      operationAbortRef.current?.abort();
      operationAbortRef.current = null;
      recoveryEmailRef.current = null;
      if (mountedRef.current) {
        setUser(null);
        setCsrfToken(null);
        setDevice(null);
        setRegistrationRecoveryCode(null);
        setIsLoading(false);
        setError("请重新登录");
      }
    }

    const cleanup = authQueueRef.current.catch(() => undefined).then(async () => {
      if (!secureStore) return;
      const storedBundle = await secureStore.getItem(SESSION_BUNDLE_KEY).catch(() => null);
      if (decodeStoredSession(storedBundle)?.sessionToken === rejectedToken) {
        await secureStore.deleteItem(SESSION_BUNDLE_KEY).catch(() => undefined);
      }
      const legacyToken = await secureStore.getItem(LEGACY_SESSION_TOKEN_KEY).catch(() => null);
      if (legacyToken === rejectedToken) {
        await secureStore.deleteItem(LEGACY_SESSION_TOKEN_KEY).catch(() => undefined);
      }
    });
    authQueueRef.current = cleanup.then(() => undefined, () => undefined);
    void cleanup.finally(() => {
      invalidatingSessionTokensRef.current.delete(rejectedToken);
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    getClient().setSessionInvalidationHandler(invalidateSession);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        operationGenerationRef.current += 1;
        operationAbortRef.current?.abort();
        operationAbortRef.current = null;
        recoveryEmailRef.current = null;
        setRegistrationRecoveryCode(null);
        setIsLoading(false);
      }
    });
    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      operationAbortRef.current?.abort();
      getClient().setSessionInvalidationHandler(null);
      subscription.remove();
    };
  }, [invalidateSession]);

  const clearError = useCallback(() => setError(null), []);

  const enqueueAuthOperation = useCallback(<T>(
    operation: () => Promise<T>,
  ): Promise<T> => {
    const result = authQueueRef.current.catch(() => undefined).then(operation);
    authQueueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const isCurrentOperation = useCallback((generation: number, signal: AbortSignal): boolean => (
    mountedRef.current &&
    !signal.aborted &&
    AppState.currentState === "active" &&
    operationGenerationRef.current === generation
  ), []);

  const restorePreviousBundleIfOwned = useCallback(async (
    issuedBundle: string,
    previousBundle: string | null,
  ): Promise<void> => {
    if (!secureStore) return;
    const current = await secureStore.getItem(SESSION_BUNDLE_KEY);
    if (current !== issuedBundle) return;
    if (previousBundle === null) {
      await secureStore.deleteItem(SESSION_BUNDLE_KEY);
    } else {
      await secureStore.setItem(SESSION_BUNDLE_KEY, previousBundle);
    }
  }, []);

  const persistSession = useCallback(async (
    session: MobileSessionResponse,
    pendingRecovery?: { email: string; code: string } | null,
    generation?: number,
    signal?: AbortSignal,
  ): Promise<void> => {
    const client = getClient();
    if (!secureStore || generation === undefined || !signal) {
      await revokeUnpersistedSession(client, session);
      throw new Error("native_auth_unavailable");
    }
    const issuedBundle = encodeStoredSession(session);
    let previousBundle: string | null = null;
    let writeMayHaveCommitted = false;
    try {
      previousBundle = await secureStore.getItem(SESSION_BUNDLE_KEY);
      if (!isCurrentOperation(generation, signal)) throw new Error("operation_cancelled");
      writeMayHaveCommitted = true;
      await secureStore.setItem(SESSION_BUNDLE_KEY, issuedBundle);
      await secureStore.deleteItem(LEGACY_SESSION_TOKEN_KEY);
      if (!isCurrentOperation(generation, signal)) throw new Error("operation_cancelled");
    } catch (storageError) {
      if (writeMayHaveCommitted) {
        await restorePreviousBundleIfOwned(issuedBundle, previousBundle).catch(() => undefined);
      }
      await revokeUnpersistedSession(client, session);
      throw storageError;
    }

    client.setSessionToken(session.sessionToken);
    recoveryEmailRef.current = pendingRecovery?.email ?? null;
    setUser(session.user);
    setCsrfToken(session.csrfToken);
    setDevice(session.device);
    setRegistrationRecoveryCode(pendingRecovery?.code ?? null);
    setIsLoading(false);
  }, [isCurrentOperation, restorePreviousBundleIfOwned]);

  const runIssuedSessionOperation = useCallback((
    email: string,
    operation: (
      adapter: MobileOpaqueAuthAdapter,
      client: MobileApiClient,
      signal: AbortSignal,
    ) => Promise<{ session: MobileSessionResponse; recoveryCode: string | null }>,
  ): Promise<boolean> => {
    const generation = operationGenerationRef.current + 1;
    operationGenerationRef.current = generation;
    operationAbortRef.current?.abort();
    const abortController = new AbortController();
    operationAbortRef.current = abortController;
    recoveryEmailRef.current = null;
    setRegistrationRecoveryCode(null);
    setIsLoading(true);
    setError(null);

    return enqueueAuthOperation(async () => {
      try {
        if (!opaqueAuth || !secureStore) throw new Error("native_auth_unavailable");
        if (!isCurrentOperation(generation, abortController.signal)) return false;
        const result = await operation(opaqueAuth, getClient(), abortController.signal);
        if (!isCurrentOperation(generation, abortController.signal)) {
          await revokeUnpersistedSession(getClient(), result.session);
          return false;
        }
        await persistSession(
          result.session,
          result.recoveryCode ? { email, code: result.recoveryCode } : null,
          generation,
          abortController.signal,
        );
        return true;
      } catch (caught: unknown) {
        if (__DEV__) {
          const code = typeof caught === "object" && caught !== null && "code" in caught
            ? String((caught as { code: unknown }).code)
            : caught instanceof Error ? caught.message : "UNKNOWN";
          console.warn("[zero-vault] auth operation failed", { code });
        }
        if (isCurrentOperation(generation, abortController.signal)) {
          setError(getErrorMessage(caught));
          setIsLoading(false);
        }
        return false;
      } finally {
        if (operationAbortRef.current === abortController) operationAbortRef.current = null;
      }
    });
  }, [enqueueAuthOperation, isCurrentOperation, persistSession]);

  const login = useCallback((email: string, password: string): Promise<boolean> => {
    const normalizedEmail = email.trim().toLowerCase();
    return runIssuedSessionOperation(
      normalizedEmail,
      (adapter, client, signal) => adapter.login(normalizedEmail, password, client, signal),
    );
  }, [runIssuedSessionOperation]);

  const authorizeVaultUnlock = useCallback((masterPassword: string): Promise<boolean> => {
    if (!user) {
      setError("请重新登录");
      return Promise.resolve(false);
    }
    return runIssuedSessionOperation(
      user.email,
      (adapter, client, signal) => adapter.login(user.email, masterPassword, client, signal),
    );
  }, [runIssuedSessionOperation, user]);

  const register = useCallback((rawEmail: string, password: string): Promise<boolean> => {
    const email = rawEmail.trim().toLowerCase();
    return runIssuedSessionOperation(
      email,
      (adapter, client, signal) => adapter.register(email, password, client, signal),
    );
  }, [runIssuedSessionOperation]);

  const recoverAccount = useCallback((
    rawEmail: string,
    recoveryCode: string,
    newPassword: string,
  ): Promise<boolean> => {
    const email = rawEmail.trim().toLowerCase();
    if (user && user.email.toLowerCase() !== email) {
      setError("请先退出当前账户，再恢复其他邮箱的密码库");
      return Promise.resolve(false);
    }
    return runIssuedSessionOperation(
      email,
      (adapter, client, signal) =>
        adapter.recover(email, recoveryCode, newPassword, client, signal),
    );
  }, [runIssuedSessionOperation, user]);

  const logout = useCallback((): Promise<boolean> => {
    operationGenerationRef.current += 1;
    operationAbortRef.current?.abort();
    operationAbortRef.current = null;
    return enqueueAuthOperation(async () => {
      const client = getClient();
      let remoteRevoked = true;
      let localDeleted = true;

      try {
        if (csrfToken) await client.logout(csrfToken);
      } catch {
        remoteRevoked = false;
      }
      try {
        if (!secureStore) throw new Error("native_auth_unavailable");
        await secureStore.deleteItem(SESSION_BUNDLE_KEY);
        await secureStore.deleteItem(LEGACY_SESSION_TOKEN_KEY);
      } catch {
        localDeleted = false;
      }

      client.setSessionToken(null);
      recoveryEmailRef.current = null;
      if (mountedRef.current) {
        setUser(null);
        setCsrfToken(null);
        setDevice(null);
        setRegistrationRecoveryCode(null);
        setIsLoading(false);
        if (!localDeleted && !remoteRevoked) {
          setError("无法确认服务器会话撤销，且本机令牌删除失败；请保持应用关闭并重试退出");
        } else if (!localDeleted) {
          setError("安全会话清理失败；本次服务器会话已退出，请重启应用后重新登录");
        } else if (!remoteRevoked) {
          setError("已退出本机，但服务器会话撤销失败；下次登录会轮换本设备会话");
        }
      }
      return remoteRevoked || localDeleted;
    });
  }, [csrfToken, enqueueAuthOperation]);

  const beginTrustedDeviceRebind = useCallback((): Promise<boolean> => {
    operationGenerationRef.current += 1;
    operationAbortRef.current?.abort();
    operationAbortRef.current = null;
    return enqueueAuthOperation(async () => {
      if (!user || !csrfToken || !secureStore) {
        if (mountedRef.current) setError("登录已过期，无法安全地重新绑定设备");
        return false;
      }
      setIsLoading(true);
      setError(null);
      const client = getClient();
      try {
        await client.logout(csrfToken);
      } catch (caught: unknown) {
        if (invalidatesStoredSession(caught)) {
          client.setSessionToken(null);
        } else {
          if (mountedRef.current) {
            setIsLoading(false);
            setError("无法撤销当前服务器会话，未清除本机设备身份");
          }
          return false;
        }
      }
      try {
        await secureStore.deleteItem(SESSION_BUNDLE_KEY);
        await secureStore.deleteItem(LEGACY_SESSION_TOKEN_KEY);
      } catch {
        client.setSessionToken(null);
        recoveryEmailRef.current = null;
        if (mountedRef.current) {
          setUser(null);
          setCsrfToken(null);
          setDevice(null);
          setRegistrationRecoveryCode(null);
          setIsLoading(false);
          setError("服务器会话已撤销，但本机令牌删除失败；请清除应用数据后重新登录");
        }
        return false;
      }

      try {
        await resetNativeDeviceLogin(user.email);
      } catch {
        client.setSessionToken(null);
        recoveryEmailRef.current = null;
        if (mountedRef.current) {
          setUser(null);
          setCsrfToken(null);
          setDevice(null);
          setRegistrationRecoveryCode(null);
          setIsLoading(false);
          setError("会话已撤销，但本机设备身份清理失败；请清除应用数据后重新绑定");
        }
        return false;
      }

      client.setSessionToken(null);
      recoveryEmailRef.current = null;
      if (mountedRef.current) {
        setUser(null);
        setCsrfToken(null);
        setDevice(null);
        setRegistrationRecoveryCode(null);
        setIsLoading(false);
      }
      return true;
    });
  }, [csrfToken, enqueueAuthOperation, user]);

  const deleteAccount = useCallback((): Promise<boolean> => {
    operationGenerationRef.current += 1;
    operationAbortRef.current?.abort();
    operationAbortRef.current = null;
    return enqueueAuthOperation(async () => {
      if (!user || !csrfToken) {
        if (mountedRef.current) setError("登录已过期，请重新登录后再删除账户");
        return false;
      }

      const client = getClient();
      try {
        await client.deleteAccount(csrfToken);
      } catch (caught: unknown) {
        const code = caught instanceof Error ? caught.message : "unknown";
        if (mountedRef.current) setError(
          code === "recent_authentication_required"
            ? "为防止长期会话误删账户，请退出并重新登录后在 5 分钟内重试"
            : getErrorMessage(caught),
        );
        return false;
      }

      let localCleanupFailed = false;
      try {
        const { clearCiphertexts } = await import("@zero-vault/zero-vault-native");
        await clearCiphertexts(user.id);
      } catch {
        localCleanupFailed = true;
      }
      try {
        if (!secureStore) throw new Error("native_auth_unavailable");
        await secureStore.deleteItem(SESSION_BUNDLE_KEY);
        await secureStore.deleteItem(LEGACY_SESSION_TOKEN_KEY);
      } catch {
        localCleanupFailed = true;
      }

      client.setSessionToken(null);
      recoveryEmailRef.current = null;
      if (mountedRef.current) {
        setUser(null);
        setCsrfToken(null);
        setDevice(null);
        setRegistrationRecoveryCode(null);
        setIsLoading(false);
        setError(localCleanupFailed
          ? "账户已从服务器删除，但本机安全数据清理失败；请清除应用数据后再使用本设备"
          : null);
      }
      return true;
    });
  }, [csrfToken, enqueueAuthOperation, user]);

  const restoreSession = useCallback((): Promise<boolean> => {
    const generation = operationGenerationRef.current;
    setIsRestoring(true);
    return enqueueAuthOperation(async () => {
      let rawBundle: string | null = null;
      let cachedSession: MobileSessionResponse | null = null;
      let token: string | null = null;
      try {
        if (!secureStore || !opaqueAuth) return false;
        const adapter = opaqueAuth;
        const client = getClient();
        rawBundle = await secureStore.getItem(SESSION_BUNDLE_KEY);
        cachedSession = decodeStoredSession(rawBundle);
        if (rawBundle && !cachedSession) {
          await secureStore.deleteItem(SESSION_BUNDLE_KEY);
          rawBundle = null;
        }
        token = cachedSession?.sessionToken ??
          await secureStore.getItem(LEGACY_SESSION_TOKEN_KEY);
        if (!token || generation !== operationGenerationRef.current) return false;
        const restored = await client.withSessionToken(token, async (scopedClient) => {
          const session = await scopedClient.fetchCurrentUser();
          const restoredDevice = await scopedClient.fetchCurrentDevice();
          if (restoredDevice.status === "approved") {
            await adapter.ensureApprovedDeviceKey(session.user.id, restoredDevice.id, scopedClient);
          }
          return { session, restoredDevice };
        });
        const onlineSession = mobileSessionResponseSchema.parse({
          ...restored.session,
          sessionToken: token,
          device: {
            id: restored.restoredDevice.id,
            status: restored.restoredDevice.status,
          },
        });
        await secureStore.setItem(SESSION_BUNDLE_KEY, encodeStoredSession(onlineSession));
        await secureStore.deleteItem(LEGACY_SESSION_TOKEN_KEY);
        if (
          !mountedRef.current ||
          generation !== operationGenerationRef.current ||
          AppState.currentState !== "active"
        ) {
          return false;
        }
        const pendingRecovery = await adapter.getPendingRecovery(restored.session.user.email);
        if (
          !mountedRef.current ||
          generation !== operationGenerationRef.current ||
          AppState.currentState !== "active"
        ) {
          return false;
        }
        client.setSessionToken(token);
        recoveryEmailRef.current = pendingRecovery ? onlineSession.user.email : null;
        setUser(onlineSession.user);
        setCsrfToken(onlineSession.csrfToken);
        setDevice(onlineSession.device);
        setRegistrationRecoveryCode(pendingRecovery);
        return true;
      } catch (restoreError) {
        getClient().setSessionToken(null);
        recoveryEmailRef.current = null;
        if (
          cachedSession &&
          token &&
          allowsOfflineSessionFallback(restoreError) &&
          secureStore &&
          opaqueAuth
        ) {
          try {
            const adapter = opaqueAuth;
            const offlineSession = cachedSession;
            const offlineToken = token;
            if (offlineSession.device.status === "approved") {
              await getClient().withSessionToken(offlineToken, (scopedClient) =>
                adapter.ensureApprovedDeviceKey(
                  offlineSession.user.id,
                  offlineSession.device.id,
                  scopedClient,
                ));
            }
            const pendingRecovery = await adapter.getPendingRecovery(offlineSession.user.email);
            if (
              mountedRef.current &&
              generation === operationGenerationRef.current &&
              AppState.currentState === "active"
            ) {
              getClient().setSessionToken(offlineToken);
              recoveryEmailRef.current = pendingRecovery ? offlineSession.user.email : null;
              setUser(offlineSession.user);
              setCsrfToken(offlineSession.csrfToken);
              setDevice(offlineSession.device);
              setRegistrationRecoveryCode(pendingRecovery);
              return true;
            }
          } catch {
            // Keep the protected bundle for a later online retry. Offline
            // unlock is allowed only when the approved device key is present.
          }
        }
        if (mountedRef.current && generation === operationGenerationRef.current) {
          setUser(null);
          setCsrfToken(null);
          setDevice(null);
          setRegistrationRecoveryCode(null);
        }
        if (invalidatesStoredSession(restoreError) && secureStore) {
          const storedBundle = await secureStore.getItem(SESSION_BUNDLE_KEY).catch(() => null);
          if (rawBundle && storedBundle === rawBundle) {
            await secureStore.deleteItem(SESSION_BUNDLE_KEY).catch(() => undefined);
          }
          const legacyToken = await secureStore.getItem(LEGACY_SESSION_TOKEN_KEY).catch(() => null);
          if (token && legacyToken === token) {
            await secureStore.deleteItem(LEGACY_SESSION_TOKEN_KEY).catch(() => undefined);
          }
        }
        return false;
      } finally {
        if (mountedRef.current) setIsRestoring(false);
      }
    });
  }, [enqueueAuthOperation]);

  const refreshDevice = useCallback(async (): Promise<TrustedDevice | null> => {
    try {
      if (!user || !opaqueAuth) throw new Error("native_auth_unavailable");
      const current = await getClient().fetchCurrentDevice();
      if (current.status === "approved") {
        await opaqueAuth.ensureApprovedDeviceKey(user.id, current.id, getClient());
      }
      if (mountedRef.current) setDevice({ id: current.id, status: current.status });
      return current;
    } catch (caught: unknown) {
      if (mountedRef.current) setError(getErrorMessage(caught));
      return null;
    }
  }, [user]);

  const clearRegistrationRecoveryCode = useCallback(async (): Promise<boolean> => {
    const email = recoveryEmailRef.current;
    if (!email || !registrationRecoveryCode || !opaqueAuth) return false;
    try {
      await opaqueAuth.acknowledgePendingRecovery(email);
      recoveryEmailRef.current = null;
      if (mountedRef.current) setRegistrationRecoveryCode(null);
      return true;
    } catch (caught: unknown) {
      if (mountedRef.current) setError(getErrorMessage(caught));
      return false;
    }
  }, [registrationRecoveryCode]);

  return {
    user,
    csrfToken,
    device,
    registrationRecoveryCode,
    isLoading,
    isRestoring,
    error,
    login,
    register,
    recoverAccount,
    authorizeVaultUnlock,
    logout,
    beginTrustedDeviceRebind,
    deleteAccount,
    clearError,
    restoreSession,
    refreshDevice,
    clearRegistrationRecoveryCode,
  };
}
