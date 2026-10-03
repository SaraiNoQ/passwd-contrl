import {
  buildRecoveryFinishTranscript,
  decodeCanonicalBase64Url,
  deviceVaultKeyPacketSchema,
  encodeCanonicalBase64Url,
  recoveryFinishRequestSchema,
  recoveryFinishSignatureSchema,
  recoveryFinishUnsignedRequestSchema,
  recoveryPacketV2Schema,
  recoverySigningPublicKeySchema,
  type MobileRegisterFinishRequest,
  type MobileSessionResponse,
  type RecoveryFinishUnsignedRequest,
} from "@zero-vault/shared";
import {
  abandonNativeRecoveryContinuation,
  acknowledgePendingNativeRecovery,
  bindNativeDevice,
  bootstrapInitialVault,
  cancelNativeRecovery,
  completeNativeDeviceLogin,
  getBoundPendingNativeRecovery,
  getNativeRecoveryContinuationDevice,
  getPendingNativeRecovery,
  hasInstalledVaultKey,
  installEncryptedVaultKey,
  lockAllVaultSessions,
  nativeOpaque,
  openNativeRecoveryV2,
  prepareNativeDevice,
  prepareNativeDeviceLogin,
  prepareNativeRecoveryRotation,
  shareNativeVaultKey,
  signNativeRecoveryFinish,
  type PreparedDevice,
} from "@zero-vault/zero-vault-native";
import type { MobileApiClient } from "../api/mobile-api-client";

export type MobileAuthResult = {
  session: MobileSessionResponse;
  recoveryCode: string | null;
};

export interface MobileOpaqueAuthAdapter {
  login(
    email: string,
    password: string,
    client: MobileApiClient,
    signal?: AbortSignal,
  ): Promise<MobileAuthResult>;
  register(
    email: string,
    password: string,
    client: MobileApiClient,
    signal?: AbortSignal,
  ): Promise<MobileAuthResult & { recoveryCode: string }>;
  recover(
    email: string,
    recoveryCode: string,
    newPassword: string,
    client: MobileApiClient,
    signal?: AbortSignal,
  ): Promise<MobileAuthResult & { recoveryCode: string }>;
  ensureApprovedDeviceKey(
    accountId: string,
    deviceId: string,
    client: MobileApiClient,
  ): Promise<void>;
  getPendingRecovery(email: string): Promise<string | null>;
  acknowledgePendingRecovery(email: string): Promise<void>;
}

const DEVICE_NAME = "Zero Vault Android";
let nativeAuthOperationTail: Promise<void> = Promise.resolve();

function serializeNativeAuthOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = nativeAuthOperationTail.then(operation, operation);
  nativeAuthOperationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("operation_cancelled");
}

function equalCanonicalBytes(left: string, right: string): boolean {
  const leftBytes = decodeCanonicalBase64Url(left);
  const rightBytes = decodeCanonicalBase64Url(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function recoveryFinishMayHaveCommitted(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const message = error.message.toLowerCase();
  return !(
    /^(request_failed_4\d\d|invalid_recovery_|device_id_conflict|rate_limit)/u.test(message) ||
    message === "unauthorized" ||
    message === "forbidden"
  );
}

function registrationLocalSetupError(cause: unknown): Error {
  return new Error("registration_local_setup_failed", { cause });
}

function registrationFinishMayHaveCommitted(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const message = error.message.toLowerCase();
  return !(
    /^(request_failed_4\d\d|invalid_register_|invalid_registration_session|user_exists|device_id_conflict|rate_limit)/u
      .test(message) ||
    message === "mobile_registration_unavailable"
  );
}

async function revokeIssuedSession(
  client: MobileApiClient,
  session: MobileSessionResponse,
): Promise<void> {
  try {
    await client.withSessionToken(
      session.sessionToken,
      (scopedClient) => scopedClient.logout(session.csrfToken),
    );
  } catch {
    // The token was never persisted. A later device login atomically rotates it.
  }
}

async function revokeIssuedSessionOrThrow(
  client: MobileApiClient,
  session: MobileSessionResponse,
): Promise<void> {
  await client.withSessionToken(
    session.sessionToken,
    (scopedClient) => scopedClient.logout(session.csrfToken),
  );
}

export class NativeMobileOpaqueAuthAdapter implements MobileOpaqueAuthAdapter {
  private async tryRecoveryContinuation(
    email: string,
    password: string,
    device: PreparedDevice,
    hasExistingIdentity: boolean,
    client: MobileApiClient,
    signal?: AbortSignal,
  ): Promise<MobileAuthResult | null> {
    let issuedSession: MobileSessionResponse | null = null;
    let committed = false;
    let fallbackAllowed = true;
    try {
      throwIfAborted(signal);
      const started = await nativeOpaque.startLogin(email, password);
      throwIfAborted(signal);
      const challenge = await client.loginStart(email, started.startLoginRequest, signal);
      throwIfAborted(signal);
      const finished = await nativeOpaque.finishLogin(email, challenge.loginResponse);
      throwIfAborted(signal);
      issuedSession = await client.loginFinish(
        challenge.loginSessionId,
        finished.finishLoginRequest,
        {
          id: device.deviceId,
          name: DEVICE_NAME,
          fingerprint: device.fingerprint,
          publicKey: device.publicKey,
          credential: device.credential,
        },
        signal,
      );

      if (issuedSession.user.email !== email || issuedSession.device.id !== device.deviceId) {
        fallbackAllowed = false;
        throw new Error("device_identity_mismatch");
      }
      if (issuedSession.device.status !== "approved") {
        if (!hasExistingIdentity) {
          // A pending response proves the recovery finish did not install this
          // device as the sole approved replacement. Convert it to an ordinary
          // pending enrollment: discard only the unbound recovery rotation,
          // bind the authenticated device identity, and leave its vault key empty.
          fallbackAllowed = false;
          await abandonNativeRecoveryContinuation(email, device.deviceId);
          await bindNativeDevice(email, issuedSession.user.id, device.deviceId);
          committed = true;
          return { session: issuedSession, recoveryCode: null };
        }
        // A recovery finish did not commit. The trial login must not replace the
        // existing local identity or leave a usable pending-device session.
        fallbackAllowed = false;
        await revokeIssuedSessionOrThrow(client, issuedSession);
        issuedSession = null;
        throwIfAborted(signal);
        return null;
      }

      fallbackAllowed = false;
      await bindNativeDevice(email, issuedSession.user.id, device.deviceId);
      const authenticatedSession = issuedSession;
      await client.withSessionToken(authenticatedSession.sessionToken, (scopedClient) =>
        this.ensureApprovedDeviceKey(authenticatedSession.user.id, device.deviceId, scopedClient));
      const recoveryCode = await this.getPendingRecovery(email);
      if (!recoveryCode) throw new Error("recovery_material_missing");
      committed = true;
      return { session: issuedSession, recoveryCode };
    } catch (error) {
      if (issuedSession && !committed) await revokeIssuedSession(client, issuedSession);
      if (!fallbackAllowed || signal?.aborted) throw error;
      return null;
    } finally {
      device.credential = "";
      nativeOpaque.cancelLogin();
    }
  }

  private async loginPreparedDevice(
    email: string,
    password: string,
    device: PreparedDevice,
    client: MobileApiClient,
    signal?: AbortSignal,
  ): Promise<MobileAuthResult & { recoveryCode: string }> {
    let issuedSession: MobileSessionResponse | null = null;
    let committed = false;
    try {
      throwIfAborted(signal);
      const started = await nativeOpaque.startLogin(email, password);
      const challenge = await client.loginStart(email, started.startLoginRequest, signal);
      const finished = await nativeOpaque.finishLogin(email, challenge.loginResponse);
      issuedSession = await client.loginFinish(
        challenge.loginSessionId,
        finished.finishLoginRequest,
        {
          id: device.deviceId,
          name: DEVICE_NAME,
          fingerprint: device.fingerprint,
          publicKey: device.publicKey,
          credential: device.credential,
        },
        signal,
      );
      throwIfAborted(signal);
      if (
        issuedSession.user.email !== email ||
        issuedSession.device.id !== device.deviceId
      ) {
        throw new Error("device_identity_mismatch");
      }
      if (issuedSession.device.status !== "approved") {
        await revokeIssuedSessionOrThrow(client, issuedSession);
        issuedSession = null;
        throw new Error("device_approval_required");
      }

      await bindNativeDevice(email, issuedSession.user.id, device.deviceId);
      const authenticatedSession = issuedSession;
      await client.withSessionToken(authenticatedSession.sessionToken, (scopedClient) =>
        this.ensureApprovedDeviceKey(authenticatedSession.user.id, device.deviceId, scopedClient));
      const recoveryCode = await this.getPendingRecovery(email);
      if (!recoveryCode) throw new Error("recovery_material_missing");
      committed = true;
      return { session: issuedSession, recoveryCode };
    } catch (error) {
      if (issuedSession && !committed) await revokeIssuedSession(client, issuedSession);
      throw error;
    } finally {
      nativeOpaque.cancelLogin();
    }
  }

  login(
    email: string,
    password: string,
    client: MobileApiClient,
    signal?: AbortSignal,
  ): Promise<MobileAuthResult> {
    // OPAQUE start/finish are anonymous protocol messages. Re-authentication
    // can happen while an older bearer is still installed on the API client;
    // never attach it or the Worker's CSRF gate will reject the exchange.
    return serializeNativeAuthOperation(() =>
      client.withoutSessionToken((anonymousClient) =>
        this.loginInternal(email, password, anonymousClient, signal)));
  }

  private async loginInternal(
    email: string,
    password: string,
    client: MobileApiClient,
    signal?: AbortSignal,
  ): Promise<MobileAuthResult> {
    throwIfAborted(signal);
    let issuedSession: MobileSessionResponse | null = null;
    let committed = false;
    const device = await prepareNativeDeviceLogin(email);

    try {
      const continuation = await getNativeRecoveryContinuationDevice(email);
      if (continuation) {
        const recovered = await this.tryRecoveryContinuation(
          email,
          password,
          continuation,
          device.accountId !== null,
          client,
          signal,
        );
        if (recovered) return recovered;
        if (device.accountId === null) throw new Error("recovery_reconcile_required");
      }

      throwIfAborted(signal);
      const started = await nativeOpaque.startLogin(email, password);
      throwIfAborted(signal);
      const challenge = await client.loginStart(email, started.startLoginRequest, signal);
      throwIfAborted(signal);
      const finished = await nativeOpaque.finishLogin(email, challenge.loginResponse);
      throwIfAborted(signal);

      issuedSession = await client.loginFinish(
        challenge.loginSessionId,
        finished.finishLoginRequest,
        {
          id: device.deviceId,
          name: DEVICE_NAME,
          fingerprint: device.fingerprint,
          publicKey: device.publicKey,
          credential: device.credential,
        },
        signal,
      );
      throwIfAborted(signal);

      if (issuedSession.device.id !== device.deviceId) {
        throw new Error("device_identity_mismatch");
      }
      if (device.accountId && device.accountId !== issuedSession.user.id) {
        throw new Error("device_identity_mismatch");
      }

      if (device.accountId) {
        await completeNativeDeviceLogin(email, issuedSession.user.id);
      } else {
        await bindNativeDevice(email, issuedSession.user.id, device.deviceId);
      }

      if (issuedSession.device.status === "approved") {
        const authenticatedSession = issuedSession;
        await client.withSessionToken(authenticatedSession.sessionToken, (scopedClient) =>
          this.ensureApprovedDeviceKey(authenticatedSession.user.id, device.deviceId, scopedClient));
      }

      const recoveryCode = await this.getPendingRecovery(email);
      committed = true;
      return { session: issuedSession, recoveryCode };
    } catch (error) {
      if (issuedSession && !committed) await revokeIssuedSession(client, issuedSession);
      throw error;
    } finally {
      device.credential = "";
      nativeOpaque.cancelLogin();
    }
  }

  register(
    email: string,
    password: string,
    client: MobileApiClient,
    signal?: AbortSignal,
  ): Promise<MobileAuthResult & { recoveryCode: string }> {
    return serializeNativeAuthOperation(() =>
      client.withoutSessionToken((anonymousClient) =>
        this.registerInternal(email, password, anonymousClient, signal)));
  }

  private async registerInternal(
    email: string,
    password: string,
    client: MobileApiClient,
    signal?: AbortSignal,
  ): Promise<MobileAuthResult & { recoveryCode: string }> {
    throwIfAborted(signal);
    let issuedSession: MobileSessionResponse | null = null;
    let finishRequest: MobileRegisterFinishRequest | null = null;
    let finishSent = false;
    let committed = false;
    const device = await prepareNativeDevice(email);

    try {
      throwIfAborted(signal);
      const started = await nativeOpaque.startRegistration(email, password);
      throwIfAborted(signal);
      const challenge = await client.registerStart(email, started.registrationRequest, signal);
      throwIfAborted(signal);
      const finished = await nativeOpaque.finishRegistration(email, challenge.registrationResponse);
      throwIfAborted(signal);
      const bootstrap = await bootstrapInitialVault(email);
      throwIfAborted(signal);

      finishRequest = {
        registrationSessionId: challenge.registrationSessionId,
        email,
        registrationRecord: finished.registrationRecord,
        publicKeyBundle: finished.serverStaticPublicKey,
        encryptedRecoveryPacket: recoveryPacketV2Schema.parse(
          JSON.parse(bootstrap.recoveryPacketJson) as unknown,
        ),
        recoverySigningPublicKey: recoverySigningPublicKeySchema.parse(
          bootstrap.recoverySigningPublicKey,
        ),
        device: {
          id: device.deviceId,
          name: DEVICE_NAME,
          fingerprint: device.fingerprint,
          publicKey: device.publicKey,
          credential: device.credential,
          encryptedVaultKeyPacket: deviceVaultKeyPacketSchema.parse(bootstrap.encryptedVaultKeyPacket),
        },
      } satisfies MobileRegisterFinishRequest;

      finishSent = true;
      issuedSession = await client.mobileRegisterFinish(finishRequest, signal);
      try {
        throwIfAborted(signal);
        if (issuedSession.user.email !== email || issuedSession.device.id !== device.deviceId) {
          throw new Error("device_identity_mismatch");
        }
        await bindNativeDevice(email, issuedSession.user.id, device.deviceId);
        await installEncryptedVaultKey(
          issuedSession.user.id,
          deviceVaultKeyPacketSchema.parse(bootstrap.encryptedVaultKeyPacket),
        );

        const pendingRecovery = await getPendingNativeRecovery(email);
        if (!pendingRecovery || pendingRecovery.recoveryCode !== bootstrap.recoveryCode) {
          throw new Error("recovery_material_missing");
        }
      } catch (localSetupFailure) {
        // Receiving a valid session proves the atomic server transaction committed.
        // Preserve the native failure as `cause`, but expose a stable recovery code:
        // a normal login reuses the prepared device and resumes bind/key installation.
        throw registrationLocalSetupError(localSetupFailure);
      }

      committed = true;
      return { session: issuedSession, recoveryCode: bootstrap.recoveryCode };
    } catch (error) {
      if (issuedSession && !committed) await revokeIssuedSession(client, issuedSession);
      if (!issuedSession && finishSent && registrationFinishMayHaveCommitted(error)) {
        throw new Error("registration_commit_unconfirmed", { cause: error });
      }
      throw error;
    } finally {
      if (finishRequest) finishRequest.device.credential = "";
      device.credential = "";
      nativeOpaque.cancelRegistration();
    }
  }

  recover(
    email: string,
    recoveryCode: string,
    newPassword: string,
    client: MobileApiClient,
    signal?: AbortSignal,
  ): Promise<MobileAuthResult & { recoveryCode: string }> {
    return serializeNativeAuthOperation(() =>
      this.recoverInternal(email, recoveryCode, newPassword, client, signal));
  }

  private async recoverInternal(
    email: string,
    recoveryCode: string,
    newPassword: string,
    client: MobileApiClient,
    signal?: AbortSignal,
  ): Promise<MobileAuthResult & { recoveryCode: string }> {
    return client.withoutSessionToken(async (anonymousClient) => {
      throwIfAborted(signal);
      const device = await prepareNativeDevice(email);
      let opened: Awaited<ReturnType<typeof openNativeRecoveryV2>> | null = null;
      let unsignedRequest: RecoveryFinishUnsignedRequest | null = null;
      let finishMayHaveCommitted = false;
      let finishSent = false;
      let recoveryStage = "opaque_registration_start";

      const closeRecoveredSession = async (): Promise<void> => {
        if (!opened) return;
        const current = opened;
        try {
          await cancelNativeRecovery(current.recoveryProofHandle, current.sessionHandle);
        } catch (error) {
          lockAllVaultSessions();
          throw error;
        } finally {
          opened = null;
        }
      };

      const loginAfterRecovery = (): Promise<MobileAuthResult & { recoveryCode: string }> =>
        this.loginPreparedDevice(email, newPassword, device, anonymousClient);

      try {
        throwIfAborted(signal);
        const opaqueStart = await nativeOpaque.startRegistration(email, newPassword);
        recoveryStage = "recovery_start";
        throwIfAborted(signal);
        const start = await anonymousClient.startRecoveryV2({
          email,
          registrationRequest: opaqueStart.registrationRequest,
        }, signal);
        recoveryStage = "opaque_registration_finish";
        throwIfAborted(signal);
        const opaqueFinish = await nativeOpaque.finishRegistration(email, start.registrationResponse);
        throwIfAborted(signal);

        recoveryStage = "recovery_packet_open";
        const encryptedRecoveryPacket = recoveryPacketV2Schema.parse(start.encryptedRecoveryPacket);
        const expectedSigningKey = recoverySigningPublicKeySchema.parse(start.recoverySigningPublicKey);
        opened = await openNativeRecoveryV2(recoveryCode, encryptedRecoveryPacket);
        const actualSigningKey = recoverySigningPublicKeySchema.parse(opened.signingPublicKey);
        if (!equalCanonicalBytes(expectedSigningKey, actualSigningKey)) {
          throw new Error("recovery_proof_mismatch");
        }
        throwIfAborted(signal);

        recoveryStage = "recovery_rotation";
        const nextRecovery = await prepareNativeRecoveryRotation(email, opened.sessionHandle);
        const newEncryptedRecoveryPacket = recoveryPacketV2Schema.parse(nextRecovery.recoveryPacket);
        const newRecoverySigningPublicKey = recoverySigningPublicKeySchema.parse(
          nextRecovery.signingPublicKey,
        );
        const encryptedVaultKeyPacket = deviceVaultKeyPacketSchema.parse(
          await shareNativeVaultKey(opened.sessionHandle, device.deviceId, device.publicKey),
        );

        recoveryStage = "recovery_request_signing";
        unsignedRequest = recoveryFinishUnsignedRequestSchema.parse({
          recoveryAttemptId: start.recoveryAttemptId,
          email,
          registrationSessionId: start.registrationSessionId,
          registrationRecord: opaqueFinish.registrationRecord,
          newEncryptedRecoveryPacket,
          newRecoverySigningPublicKey,
          device: {
            id: device.deviceId,
            name: DEVICE_NAME,
            fingerprint: device.fingerprint,
            publicKey: device.publicKey,
            credential: device.credential,
            encryptedVaultKeyPacket,
          },
        });
        const transcript = buildRecoveryFinishTranscript({
          ...unsignedRequest,
          challenge: start.challenge,
        });
        const signature = recoveryFinishSignatureSchema.parse(
          await signNativeRecoveryFinish(
            opened.recoveryProofHandle,
            encodeCanonicalBase64Url(transcript),
          ),
        );
        const finishRequest = recoveryFinishRequestSchema.parse({ ...unsignedRequest, signature });
        throwIfAborted(signal);
        finishSent = true;
        recoveryStage = "recovery_finish";

        try {
          // Once the signed finish leaves the client, cancellation is ambiguous:
          // the server may have committed even if the app moves to background.
          await anonymousClient.finishRecoveryV2(finishRequest);
          finishMayHaveCommitted = true;
        } catch (finishError) {
          finishMayHaveCommitted = recoveryFinishMayHaveCommitted(finishError);
          await closeRecoveredSession().catch(() => undefined);
          if (finishMayHaveCommitted) {
            try {
              return await loginAfterRecovery();
            } catch {
              // A timeout may have committed or rolled back. A later normal login
              // is the only safe discriminator; no recovery material is deleted.
            }
          }
          throw finishError;
        }

        await closeRecoveredSession().catch(() => undefined);
        recoveryStage = "recovery_login";
        return await loginAfterRecovery();
      } catch (error) {
        if (__DEV__) {
          const code = typeof error === "object" && error !== null && "code" in error
            ? String((error as { code: unknown }).code)
            : error instanceof Error ? error.message : "UNKNOWN";
          console.warn("[zero-vault] recovery stage failed", { stage: recoveryStage, code });
        }
        if (!finishSent && signal?.aborted) throw new Error("operation_cancelled");
        throw new Error(
          finishMayHaveCommitted ? "recovery_commit_unconfirmed" : "recovery_failed",
          { cause: error },
        );
      } finally {
        await closeRecoveredSession().catch(() => undefined);
        if (unsignedRequest) unsignedRequest.device.credential = "";
        device.credential = "";
        nativeOpaque.cancelRegistration();
      }
    });
  }

  async ensureApprovedDeviceKey(
    accountId: string,
    deviceId: string,
    client: MobileApiClient,
  ): Promise<void> {
    if (await hasInstalledVaultKey(accountId)) return;
    const response = await client.getDeviceVaultKey(deviceId);
    const packet = deviceVaultKeyPacketSchema.parse(response.encryptedVaultKeyPacket);
    if (packet.recipientDeviceId !== deviceId) throw new Error("device_key_recipient_mismatch");
    await installEncryptedVaultKey(accountId, packet);
  }

  async getPendingRecovery(email: string): Promise<string | null> {
    return (await getBoundPendingNativeRecovery(email))?.recoveryCode ?? null;
  }

  acknowledgePendingRecovery(email: string): Promise<void> {
    return acknowledgePendingNativeRecovery(email);
  }
}
