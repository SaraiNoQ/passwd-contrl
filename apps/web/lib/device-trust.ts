import { loadCryptoCore } from "./local-vault";
import { requestJson, toBase64Url, fromBase64Url } from "./crypto-utils";
import {
  saveDevicePrivateKey,
  loadDevicePrivateKey,
  hasDevicePrivateKey as idbHasDevicePrivateKey
} from "./device-key-store";

const DEVICE_ID_KEY = "zero-vault.local.device-id.v1";

const getDevicePublicKeyHex = (publicKeyBytes: Uint8Array): string =>
  Array.from(publicKeyBytes.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Generate an X25519 keypair for device trust.
 *
 * Calls the WASM `generateDeviceKeypair()` which returns 64 bytes
 * (private_key[32] || public_key[32]).
 *
 * - Private key is stored in IndexedDB (never in localStorage).
 * - A device ID derived from the first 16 bytes of the public key (hex)
 *   is stored in localStorage for quick lookup.
 * - Returns the public key as a base64url string.
 */
export const generateDeviceKeypair = async (): Promise<string> => {
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) {
    // Keypair already generated; return the stored public key.
    // Re-derive from IndexedDB isn't practical, so we rely on the
    // fact that registerDevice already sent the public key to the server.
    // Callers that need the raw public key should use getDevicePublicKey().
    const existingPk = window.localStorage.getItem(`${DEVICE_ID_KEY}.public-key`);
    if (existingPk) return existingPk;
  }

  const cryptoCore = await loadCryptoCore();
  const combined = cryptoCore.generateDeviceKeypair();
  const privateKey = combined.slice(0, 32);
  const publicKey = combined.slice(32, 64);

  const deviceId = getDevicePublicKeyHex(publicKey);
  const publicKeyB64 = toBase64Url(publicKey);

  await saveDevicePrivateKey(privateKey);
  window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
  window.localStorage.setItem(`${DEVICE_ID_KEY}.public-key`, publicKeyB64);

  return publicKeyB64;
};

/**
 * Get the device ID from localStorage (derived from public key hex prefix).
 */
export const getDeviceId = (): string | null =>
  window.localStorage.getItem(DEVICE_ID_KEY);

/**
 * Get the stored public key as base64url, if available.
 */
export const getDevicePublicKey = (): string | null =>
  window.localStorage.getItem(`${DEVICE_ID_KEY}.public-key`);

export type DeviceInfo = {
  id: string;
  name: string;
  publicKey: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  createdAt?: string;
  updatedAt?: string;
};

export const getDeviceName = (): string => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad| iPod/u.test(ua)) return "iOS Device";
  if (/Android/u.test(ua)) return "Android Device";
  if (/Mac/u.test(ua)) return "Mac";
  if (/Windows/u.test(ua)) return "Windows PC";
  if (/Linux/u.test(ua)) return "Linux";
  return "Unknown Device";
};

/**


 * Register this device with the server.
 * Sends `{ name, publicKey }` matching the shared schema.
 */
export const registerDevice = async (csrfToken: string): Promise<DeviceInfo | null> => {
  try {
    const publicKey = await generateDeviceKeypair();
    const device = await requestJson<DeviceInfo>("/devices", {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken },
      body: JSON.stringify({ name: getDeviceName(), publicKey })
    });
    window.localStorage.setItem(DEVICE_ID_KEY, device.id);
    window.localStorage.setItem(`${DEVICE_ID_KEY}.public-key`, device.publicKey);
    return device;
  } catch {
    return null;
  }
};

export const listDevices = async (csrfToken: string): Promise<DeviceInfo[]> => {
  try {
    const response = await requestJson<{ devices: DeviceInfo[] }>("/devices", {
      headers: { "x-zero-vault-csrf": csrfToken }
    });
    return response.devices;
  } catch {
    return [];
  }
};

export const approveDevice = async (
  csrfToken: string,
  targetDeviceId: string
): Promise<{ ok: boolean }> => {
  try {
    return await requestJson<{ ok: boolean }>(`/devices/${targetDeviceId}/approve`, {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken }
    });
  } catch {
    return { ok: false };
  }
};

export const rejectDevice = async (
  csrfToken: string,
  targetDeviceId: string
): Promise<{ ok: boolean }> => {
  try {
    return await requestJson<{ ok: boolean }>(`/devices/${targetDeviceId}/reject`, {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken }
    });
  } catch {
    return { ok: false };
  }
};

export const revokeDevice = async (
  csrfToken: string,
  targetDeviceId: string
): Promise<{ ok: boolean }> => {
  try {
    return await requestJson<{ ok: boolean }>(`/devices/${targetDeviceId}/revoke`, {
      method: "POST",
      headers: { "x-zero-vault-csrf": csrfToken }
    });
  } catch {
    return { ok: false };
  }
};

// ---------------------------------------------------------------------------
// Device vault key encryption / decryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a vault key for a specific device using X25519 ECDH.
 *
 * Calls WASM `encryptForDevice(device_public_key, vault_key)` and returns
 * the result as a base64url-encoded string.
 */
export const encryptVaultKeyForDevice = async (
  devicePublicKey: string,
  vaultKey: Uint8Array
): Promise<string> => {
  const cryptoCore = await loadCryptoCore();
  const devicePkBytes = fromBase64Url(devicePublicKey);
  const encrypted = cryptoCore.encryptForDevice(devicePkBytes, vaultKey);
  return toBase64Url(encrypted);
};

/**
 * Decrypt a vault key that was encrypted for this device.
 *
 * Reads the private key from IndexedDB, then calls WASM
 * `decryptOnDevice(device_private_key, nonce_and_ciphertext)`.
 */
export const decryptVaultKeyOnDevice = async (
  encryptedBlob: string
): Promise<Uint8Array> => {
  const privateKey = await loadDevicePrivateKey();
  if (!privateKey) {
    throw new Error("device_private_key_not_found");
  }
  const cryptoCore = await loadCryptoCore();
  const blobBytes = fromBase64Url(encryptedBlob);
  return cryptoCore.decryptOnDevice(privateKey, blobBytes);
};

/**
 * Read the device private key from IndexedDB.
 */
export const getDevicePrivateKey = loadDevicePrivateKey;

/**
 * Check whether a device private key exists in IndexedDB.
 */
export const hasDevicePrivateKey = idbHasDevicePrivateKey;

/**
 * Fetch the encrypted vault key for a device.
 *
 * A new device calls this endpoint after being approved to retrieve
 * the vault key that was shared by an existing trusted device.
 */
export const fetchDeviceVaultKey = async (
  csrfToken: string,
  deviceId: string
): Promise<string | null> => {
  try {
    const response = await requestJson<{ encryptedVaultKey: string }>(
      `/devices/${deviceId}/key`,
      {
        headers: { "x-zero-vault-csrf": csrfToken }
      }
    );
    return response.encryptedVaultKey;
  } catch {
    return null;
  }
};

/**
 * Share an encrypted vault key blob with a device via the API.
 */
export const shareVaultKeyWithDevice = async (
  csrfToken: string,
  deviceId: string,
  encryptedBlob: string
): Promise<void> => {
  await requestJson<{ ok: boolean }>(`/devices/${deviceId}/share-key`, {
    method: "POST",
    headers: { "x-zero-vault-csrf": csrfToken },
    body: JSON.stringify({ encryptedVaultKey: encryptedBlob })
  });
};
