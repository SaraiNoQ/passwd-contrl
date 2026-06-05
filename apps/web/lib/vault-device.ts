/**
 * Pure device-trust vault operations.
 * Each function accepts dependencies as parameters and returns a result object.
 * No React hooks or state management — that stays in vault-provider.tsx.
 */
import {
  approveDevice,
  rejectDevice,
  revokeDevice,
  listDevices,
  getDeviceId,
  encryptVaultKeyForDevice,
  shareVaultKeyWithDevice,
  type DeviceInfo
} from "./device-trust";
import type { UnlockedVault } from "./local-vault";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RefreshDevicesResult =
  | {
      status: "ok";
      devices: DeviceInfo[];
      currentDeviceId: string;
    }
  | { status: "not-logged-in" }
  | { status: "error"; message: string };

export type DeviceActionResult =
  | { status: "ok" }
  | { status: "not-logged-in" }
  | { status: "error"; message: string };

export type ApproveDeviceResult =
  | { status: "ok" }
  | { status: "not-logged-in" }
  | { status: "key-share-failed"; message: string }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Refresh the device list from the server.
 */
export async function handleRefreshDevices(deps: {
  csrfToken: string;
}): Promise<RefreshDevicesResult> {
  const { csrfToken } = deps;

  if (!csrfToken) {
    return { status: "not-logged-in" };
  }

  try {
    const deviceList = await listDevices(csrfToken);
    const currentDeviceId = getDeviceId() ?? "";
    return { status: "ok", devices: deviceList, currentDeviceId };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "设备列表刷新失败。"
    };
  }
}

/**
 * Approve a pending device and share the vault key with it.
 */
export async function handleApproveDevice(deps: {
  csrfToken: string;
  deviceId: string;
  unlockedVault: UnlockedVault | null;
  devices: DeviceInfo[];
}): Promise<ApproveDeviceResult> {
  const { csrfToken, deviceId, unlockedVault, devices } = deps;

  if (!csrfToken) {
    return { status: "not-logged-in" };
  }

  try {
    const result = await approveDevice(csrfToken, deviceId);
    if (!result.ok) throw new Error("approve_failed");

    if (unlockedVault) {
      try {
        const approvedDevice = devices.find((d) => d.id === deviceId);
        if (approvedDevice) {
          const vaultKeyBytes =
            unlockedVault.runtime === "webcrypto-mvp"
              ? new Uint8Array(
                  await crypto.subtle.exportKey("raw", unlockedVault.key)
                )
              : unlockedVault.key;
          const encryptedBlob = await encryptVaultKeyForDevice(
            approvedDevice.publicKey,
            vaultKeyBytes
          );
          await shareVaultKeyWithDevice(csrfToken, deviceId, encryptedBlob);
        }
      } catch {
        return {
          status: "key-share-failed",
          message: "设备已批准，但密钥共享失败。请稍后重试设备同步。"
        };
      }
    }

    return { status: "ok" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "approve_failed"
    };
  }
}

/**
 * Reject a pending device.
 */
export async function handleRejectDevice(deps: {
  csrfToken: string;
  deviceId: string;
}): Promise<DeviceActionResult> {
  const { csrfToken, deviceId } = deps;

  if (!csrfToken) {
    return { status: "not-logged-in" };
  }

  try {
    const result = await rejectDevice(csrfToken, deviceId);
    if (!result.ok) throw new Error("reject_failed");
    return { status: "ok" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "reject_failed"
    };
  }
}

/**
 * Revoke an approved device.
 */
export async function handleRevokeDevice(deps: {
  csrfToken: string;
  deviceId: string;
}): Promise<DeviceActionResult> {
  const { csrfToken, deviceId } = deps;

  if (!csrfToken) {
    return { status: "not-logged-in" };
  }

  try {
    const result = await revokeDevice(csrfToken, deviceId);
    if (!result.ok) throw new Error("revoke_failed");
    return { status: "ok" };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "revoke_failed"
    };
  }
}
