import { deviceVaultKeyPacketSchema, type DeviceVaultKeyPacket } from "@zero-vault/shared";
import { fromBase64Url, toBase64Url } from "./crypto-utils";
const XCHACHA_NONCE_BYTES = 24;
const X25519_PUBLIC_KEY_BYTES = 32;
const POLY1305_TAG_BYTES = 16;
/** Convert the Rust/WASM nonce||ephemeral-key||ciphertext blob to the API packet. */
export const createDeviceVaultKeyPacket = (
  deviceId: string,
  devicePublicKey: string,
  encryptedBlob: string
): DeviceVaultKeyPacket => {
  const bytes = fromBase64Url(encryptedBlob);
  const ciphertextOffset = XCHACHA_NONCE_BYTES + X25519_PUBLIC_KEY_BYTES;
  if (bytes.length < ciphertextOffset + POLY1305_TAG_BYTES) {
    throw new Error("invalid_device_vault_key_blob");
  }
  return deviceVaultKeyPacketSchema.parse({
    version: 1,
    recipientDeviceId: deviceId,
    recipientPublicKey: devicePublicKey,
    ephemeralPublicKey: toBase64Url(bytes.slice(XCHACHA_NONCE_BYTES, ciphertextOffset)),
    encryptedVaultKey: {
      alg: "XCHACHA20_POLY1305",
      nonce: toBase64Url(bytes.slice(0, XCHACHA_NONCE_BYTES)),
      ciphertext: toBase64Url(bytes.slice(ciphertextOffset))
    }
  });
};

/** Rebuild the Rust/WASM blob consumed by decryptOnDevice. */
export const deviceVaultKeyPacketToBlob = (packet: DeviceVaultKeyPacket): string => {
  const parsed = deviceVaultKeyPacketSchema.parse(packet);
  const nonce = fromBase64Url(parsed.encryptedVaultKey.nonce);
  const ephemeralPublicKey = fromBase64Url(parsed.ephemeralPublicKey);
  const ciphertext = fromBase64Url(parsed.encryptedVaultKey.ciphertext);
  if (
    parsed.encryptedVaultKey.alg !== "XCHACHA20_POLY1305" ||
    nonce.length !== XCHACHA_NONCE_BYTES ||
    ephemeralPublicKey.length !== X25519_PUBLIC_KEY_BYTES ||
    ciphertext.length < POLY1305_TAG_BYTES
  ) {
    throw new Error("invalid_device_vault_key_packet");
  }
  const blob = new Uint8Array(nonce.length + ephemeralPublicKey.length + ciphertext.length);
  blob.set(nonce, 0);
  blob.set(ephemeralPublicKey, nonce.length);
  blob.set(ciphertext, nonce.length + ephemeralPublicKey.length);
  return toBase64Url(blob);
};


