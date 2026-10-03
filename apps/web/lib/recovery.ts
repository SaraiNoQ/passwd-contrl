import { toBase64Url, fromBase64Url, toArrayBuffer, encodeText } from "./crypto-utils";

/**
 * Legacy Web recovery packet.
 *
 * This AES/PBKDF2 envelope is intentionally local-only. The Worker's
 * authenticated migration endpoint accepts Recovery v2 material
 * (XChaCha20/Argon2 plus a signing public key), which this Web runtime cannot
 * produce yet.
 */
export type RecoveryPacket = {
  alg: "AES_256_GCM";
  nonce: string;
  ciphertext: string;
  kdfIterations: number;
};

export const LEGACY_RECOVERY_PROTOCOL = "web-local-v1" as const;
export const LEGACY_RECOVERY_MIGRATION_MESSAGE =
  "旧版 Web 恢复包仅保存在当前浏览器。请保留此浏览器数据，并在支持 Recovery v2 的客户端完成迁移后再依赖跨设备恢复。";

const RECOVERY_KDF_ITERATIONS = 600_000;
const RECOVERY_NONCE_BYTES = 12;
const RECOVERY_AAD = "zero-vault.recovery.v1";

const isRecoveryPacket = (value: unknown): value is RecoveryPacket => {
  if (!value || typeof value !== "object") return false;
  const packet = value as Record<string, unknown>;
  return (
    packet.alg === "AES_256_GCM" &&
    typeof packet.nonce === "string" &&
    typeof packet.ciphertext === "string" &&
    typeof packet.kdfIterations === "number" &&
    Number.isSafeInteger(packet.kdfIterations) &&
    packet.kdfIterations > 0
  );
};

export const generateRecoveryCode = (): string => {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
};

export const createRecoveryPacket = async (
  code: string,
  vaultKey: Uint8Array
): Promise<RecoveryPacket> => {
  const salt = encodeText("zero-vault-recovery-salt");
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encodeText(code)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const derivedKey = await globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations: RECOVERY_KDF_ITERATIONS },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const nonce = new Uint8Array(RECOVERY_NONCE_BYTES);
  globalThis.crypto.getRandomValues(nonce);
  const plaintext = toArrayBuffer(vaultKey);
  const aad = encodeText(RECOVERY_AAD);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(aad) },
    derivedKey,
    plaintext
  );
  return {
    alg: "AES_256_GCM",
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    kdfIterations: RECOVERY_KDF_ITERATIONS
  };
};

export const recoverVaultKey = async (
  code: string,
  packet: RecoveryPacket
): Promise<Uint8Array> => {
  if (!isRecoveryPacket(packet)) {
    throw new Error("旧版恢复包格式无效，请保留原始备份并在支持 Recovery v2 的客户端中迁移。");
  }
  const salt = encodeText("zero-vault-recovery-salt");
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encodeText(code)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const derivedKey = await globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations: packet.kdfIterations },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const nonce = fromBase64Url(packet.nonce);
  const ciphertext = fromBase64Url(packet.ciphertext);
  const aad = encodeText(RECOVERY_AAD);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce), additionalData: toArrayBuffer(aad) },
    derivedKey,
    toArrayBuffer(ciphertext)
  );
  const keyBytes = new Uint8Array(plaintext);
  if (keyBytes.length !== 32) {
    throw new Error("Invalid recovered key length.");
  }
  return keyBytes;
};

export const RECOVERY_PACKET_STORAGE_KEY = "zero-vault.local.recovery-packet.v1";

export const saveRecoveryPacket = (packet: RecoveryPacket) => {
  window.localStorage.setItem(RECOVERY_PACKET_STORAGE_KEY, JSON.stringify(packet));
};

export const loadRecoveryPacket = (): RecoveryPacket | null => {
  const raw = window.localStorage.getItem(RECOVERY_PACKET_STORAGE_KEY);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!isRecoveryPacket(parsed)) {
    throw new Error("旧版恢复包格式无效，请保留原始备份并在支持 Recovery v2 的客户端中迁移。");
  }
  return parsed;
};
