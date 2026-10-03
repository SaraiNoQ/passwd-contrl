import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileApiClient } from "../lib/api/mobile-api-client";
import {
  ACCOUNT_ID,
  DEVICE_CREDENTIAL,
  DEVICE_ID,
  DEVICE_PUBLIC_KEY,
  makeDeviceVaultKeyPacket,
  XCHACHA_NONCE_24_BYTES,
} from "./fixtures";

const native = vi.hoisted(() => ({
  bindNativeDevice: vi.fn(),
  bootstrapInitialVault: vi.fn(),
  getPendingNativeRecovery: vi.fn(),
  installEncryptedVaultKey: vi.fn(),
  prepareNativeDevice: vi.fn(),
  nativeOpaque: {
    startRegistration: vi.fn(),
    finishRegistration: vi.fn(),
    cancelRegistration: vi.fn(),
  },
}));

vi.mock("@zero-vault/zero-vault-native", () => ({
  abandonNativeRecoveryContinuation: vi.fn(),
  acknowledgePendingNativeRecovery: vi.fn(),
  bindNativeDevice: native.bindNativeDevice,
  bootstrapInitialVault: native.bootstrapInitialVault,
  cancelNativeRecovery: vi.fn(),
  completeNativeDeviceLogin: vi.fn(),
  getBoundPendingNativeRecovery: vi.fn(),
  getNativeRecoveryContinuationDevice: vi.fn(),
  getPendingNativeRecovery: native.getPendingNativeRecovery,
  hasInstalledVaultKey: vi.fn(),
  installEncryptedVaultKey: native.installEncryptedVaultKey,
  lockAllVaultSessions: vi.fn(),
  nativeOpaque: native.nativeOpaque,
  openNativeRecoveryV2: vi.fn(),
  prepareNativeDevice: native.prepareNativeDevice,
  prepareNativeDeviceLogin: vi.fn(),
  prepareNativeRecoveryRotation: vi.fn(),
  shareNativeVaultKey: vi.fn(),
  signNativeRecoveryFinish: vi.fn(),
}));

import { NativeMobileOpaqueAuthAdapter } from "../lib/auth/native-mobile-auth-adapter";

const EMAIL = "new@example.com";
const RECOVERY_CODE = "recovery-code";
const RECOVERY_SIGNING_PUBLIC_KEY = `${"BAQE".repeat(10)}BAQ`;
const SESSION = {
  user: { id: ACCOUNT_ID, email: EMAIL, serverRevision: 0 },
  csrfToken: "csrf-token",
  sessionToken: "S".repeat(43),
  device: { id: DEVICE_ID, status: "approved" as const },
};

function createClient() {
  const client = {} as {
    withoutSessionToken: ReturnType<typeof vi.fn>;
    registerStart: ReturnType<typeof vi.fn>;
    mobileRegisterFinish: ReturnType<typeof vi.fn>;
    withSessionToken: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };
  client.withoutSessionToken = vi.fn(
    async (operation: (scoped: MobileApiClient) => Promise<unknown>) =>
      operation(client as unknown as MobileApiClient),
  );
  client.registerStart = vi.fn().mockResolvedValue({
    registrationSessionId: "77777777-7777-4777-8777-777777777777",
    registrationResponse: "registration-response",
  });
  client.mobileRegisterFinish = vi.fn().mockResolvedValue(SESSION);
  client.withSessionToken = vi.fn(
    async (
      _token: string,
      operation: (scoped: MobileApiClient) => Promise<unknown>,
    ) => operation(client as unknown as MobileApiClient),
  );
  client.logout = vi.fn().mockResolvedValue({ ok: true });
  return client;
}

describe("NativeMobileOpaqueAuthAdapter registration reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.prepareNativeDevice.mockResolvedValue({
      deviceId: DEVICE_ID,
      credential: DEVICE_CREDENTIAL,
      publicKey: DEVICE_PUBLIC_KEY,
      fingerprint: "android-device-fingerprint",
    });
    native.nativeOpaque.startRegistration.mockResolvedValue({
      registrationRequest: "registration-request",
    });
    native.nativeOpaque.finishRegistration.mockResolvedValue({
      registrationRecord: "registration-record",
      serverStaticPublicKey: "server-public-key",
    });
    const encryptedVaultKeyPacket = makeDeviceVaultKeyPacket();
    native.bootstrapInitialVault.mockResolvedValue({
      sessionHandle: "vault-session",
      encryptedVaultKeyPacket,
      recoveryCode: RECOVERY_CODE,
      recoveryPacketJson: JSON.stringify({
        version: 2,
        alg: "XCHACHA20_POLY1305",
        kdf: {
          alg: "ARGON2ID_V13",
          salt: "AQEBAQEBAQEBAQEBAQEBAQ",
          memoryKib: 65_536,
          iterations: 3,
          parallelism: 4,
        },
        nonce: XCHACHA_NONCE_24_BYTES,
        ciphertext: "AwMD".repeat(27),
      }),
      recoverySigningPublicKey: RECOVERY_SIGNING_PUBLIC_KEY,
    });
    native.bindNativeDevice.mockResolvedValue(undefined);
    native.installEncryptedVaultKey.mockResolvedValue(undefined);
    native.getPendingNativeRecovery.mockResolvedValue({
      recoveryCode: RECOVERY_CODE,
      recoveryPacketJson: "{}",
      recoverySigningPublicKey: RECOVERY_SIGNING_PUBLIC_KEY,
    });
  });

  it.each([
    ["binding", native.bindNativeDevice],
    ["vault-key installation", native.installEncryptedVaultKey],
  ])("reports committed registration when local %s fails and preserves the native cause", async (
    _stage,
    failingOperation,
  ) => {
    const localFailure = new Error("keystore_write_failed");
    failingOperation.mockRejectedValueOnce(localFailure);
    const client = createClient();

    await expect(
      new NativeMobileOpaqueAuthAdapter().register(
        EMAIL,
        "correct horse battery staple",
        client as unknown as MobileApiClient,
      ),
    ).rejects.toMatchObject({
      message: "registration_local_setup_failed",
      cause: localFailure,
    });

    expect(client.mobileRegisterFinish).toHaveBeenCalledOnce();
    expect(client.logout).toHaveBeenCalledWith(SESSION.csrfToken);
    expect(native.nativeOpaque.cancelRegistration).toHaveBeenCalledOnce();
  });

  it("reports an unconfirmed commit when the finish response is lost", async () => {
    const transportFailure = new Error("request_timeout");
    const client = createClient();
    client.mobileRegisterFinish.mockRejectedValueOnce(transportFailure);

    await expect(
      new NativeMobileOpaqueAuthAdapter().register(
        EMAIL,
        "correct horse battery staple",
        client as unknown as MobileApiClient,
      ),
    ).rejects.toMatchObject({
      message: "registration_commit_unconfirmed",
      cause: transportFailure,
    });

    expect(client.logout).not.toHaveBeenCalled();
    expect(native.nativeOpaque.cancelRegistration).toHaveBeenCalledOnce();
  });
});
