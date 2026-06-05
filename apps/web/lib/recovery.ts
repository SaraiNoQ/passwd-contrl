import { toBase64Url, fromBase64Url, toArrayBuffer, encodeText } from "./crypto-utils";

export type RecoveryPacket = {
  alg: "AES_256_GCM";
  nonce: string;
  ciphertext: string;
  kdfIterations: number;
};

const RECOVERY_KDF_ITERATIONS = 600_000;
const RECOVERY_NONCE_BYTES = 12;
const RECOVERY_AAD = "zero-vault.recovery.v1";

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
  return JSON.parse(raw) as RecoveryPacket;
};
