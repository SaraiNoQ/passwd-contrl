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
  createDeviceVaultKeyPacket,
  fetchDeviceVaultKey,
  decryptVaultKeyOnDevice,
  type DeviceInfo
} from "./device-trust";
import { createLocalVaultWithSharedKey, saveEncryptedLocalVault, type EncryptedLocalVault, type UnlockedVault } from "./local-vault";
import { saveSyncCursor, saveLocalServerRevision, saveItemRevisionMap, savePendingItemMutations, saveSyncedTimestamps, saveConflictIds } from "./sync-vault";

export async function connectApprovedVault(csrfToken: string, password: string, existing: EncryptedLocalVault | null) {
  if (existing && existing.itemCount > 0) throw new Error("此浏览器已有密码数据，请先导出加密备份，使用另一个浏览器接入云端密码库。");
  const deviceId = getDeviceId();
  if (!deviceId) throw new Error("请先登录已有账户。");
  const blob = await fetchDeviceVaultKey(csrfToken, deviceId);
  if (!blob) throw new Error("请在手机的设备管理中批准此浏览器，然后再次点击连接。");
  const key = await decryptVaultKeyOnDevice(blob);
  try {
    const connected = await createLocalVaultWithSharedKey(password, key);
    saveEncryptedLocalVault(connected.encrypted);
    saveSyncCursor(0);
    saveLocalServerRevision(0);
    saveItemRevisionMap({});
    savePendingItemMutations({});
    saveSyncedTimestamps({});
    saveConflictIds(new Set());
    return connected;
  } finally {
    key.fill(0);
  }
}

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
    const targetDevice = devices.find((device) => device.id === deviceId);
    if (!unlockedVault || !targetDevice) {
      return {
        status: "key-share-failed",
        message: "请先解锁密码库，再批准并共享设备密钥。"
      };
    }

    const vaultKeyBytes =
      unlockedVault.runtime === "webcrypto-mvp"
        ? new Uint8Array(await crypto.subtle.exportKey("raw", unlockedVault.key))
        : unlockedVault.key;
    const encryptedBlob = await encryptVaultKeyForDevice(targetDevice.publicKey, vaultKeyBytes);
    const encryptedVaultKeyPacket = createDeviceVaultKeyPacket(
      targetDevice.id,
      targetDevice.publicKey,
      encryptedBlob
    );
    const result = await approveDevice(csrfToken, deviceId, encryptedVaultKeyPacket);
    if (!result.ok) throw new Error("approve_failed");

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
