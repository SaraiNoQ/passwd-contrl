/**
 * DesktopCryptoAdapter — bridge between React frontend and Rust crypto-core via Tauri commands.
 *
 * Production implementation (`TauriCryptoAdapter`) calls native Rust crypto-core
 * through Tauri IPC. Test double (`TestDoubleCryptoAdapter`) uses simple encoding
 * for development and unit testing without a running Tauri app.
 *
 * Security rules:
 * - Master password is never logged, persisted, or sent to server.
 * - Derived keys and vault keys are never logged or persisted in plaintext.
 * - Plaintext items exist only in JS memory while vault is unlocked.
 * - Locking clears all sensitive state from memory.
 */

import { invoke } from "@tauri-apps/api/core";
import type { VaultItem, CiphertextEnvelope } from "@zero-vault/shared";

// ── Interface ───────────────────────────────────────────────────────────────

export interface DesktopCryptoAdapter {
  /**
   * Derive vault key from master password and salt via Argon2id.
   * Returns the raw vault key bytes (32 bytes).
   */
  deriveVaultKey(
    masterPassword: string,
    salt: Uint8Array,
    params: { memoryKib: number; iterations: number; parallelism: number }
  ): Promise<Uint8Array>;

  /**
   * Decrypt a single vault item from its ciphertext envelopes.
   * The item key is unwrapped from the vault key, then used to decrypt the payload.
   */
  decryptItem(
    vaultKey: Uint8Array,
    encryptedItemKey: CiphertextEnvelope,
    encryptedPayload: CiphertextEnvelope,
    itemId: string
  ): Promise<VaultItem>;

  /**
   * Encrypt a single vault item.
   * Generates a random item key, wraps it with the vault key, encrypts the payload.
   */
  encryptItem(
    vaultKey: Uint8Array,
    item: VaultItem,
    itemId: string
  ): Promise<{
    encryptedItemKey: CiphertextEnvelope;
    encryptedPayload: CiphertextEnvelope;
  }>;

  /**
   * Generate a recovery code from 256 bits of cryptographic randomness.
   * Returns a base64url-encoded string for the user to store offline.
   */
  generateRecoveryCode(): Promise<string>;

  /**
   * Derive a recovery key from a human-readable recovery code.
   * Returns 32 raw key bytes.
   */
  deriveRecoveryKey(recoveryCode: string): Promise<Uint8Array>;

  /**
   * Generate an X25519 keypair for device trust.
   * The private key must never leave the device.
   */
  generateDeviceKeypair(): Promise<{
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  }>;

  /**
   * Encrypt a vault key for a specific device using X25519 ECDH.
   */
  encryptVaultKeyForDevice(
    vaultKey: Uint8Array,
    devicePublicKey: Uint8Array
  ): Promise<Uint8Array>;

  /**
   * Decrypt a vault key on a device using its private key.
   */
  decryptVaultKeyOnDevice(
    encryptedVaultKey: Uint8Array,
    devicePrivateKey: Uint8Array
  ): Promise<Uint8Array>;

  /**
   * Lock the adapter — clear any cached keys or sensitive state.
   */
  lock(): void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Convert base64url string to Uint8Array. */
function base64urlToBytes(b64: string): Uint8Array {
  const standard = b64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Convert Uint8Array to base64url string (no padding). */
function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Production implementation ───────────────────────────────────────────────

/**
 * Production adapter that delegates all crypto to native Rust via Tauri IPC.
 *
 * Tauri serializes Vec<u8> as JSON arrays of numbers. This adapter converts
 * between Uint8Array and the JSON wire format, and between CiphertextEnvelope
 * (base64url strings) and the raw byte arrays expected by the Rust commands.
 */
export class TauriCryptoAdapter implements DesktopCryptoAdapter {
  async deriveVaultKey(
    masterPassword: string,
    salt: Uint8Array,
    params: { memoryKib: number; iterations: number; parallelism: number }
  ): Promise<Uint8Array> {
    const result = await invoke<number[]>("derive_vault_key", {
      masterPassword,
      salt: Array.from(salt),
      memoryKib: params.memoryKib,
      iterations: params.iterations,
      parallelism: params.parallelism,
    });
    return new Uint8Array(result);
  }

  async decryptItem(
    vaultKey: Uint8Array,
    encryptedItemKey: CiphertextEnvelope,
    encryptedPayload: CiphertextEnvelope,
    itemId: string
  ): Promise<VaultItem> {
    const json = await invoke<string>("decrypt_item", {
      vaultKey: Array.from(vaultKey),
      encryptedItemKeyNonce: Array.from(base64urlToBytes(encryptedItemKey.nonce)),
      encryptedItemKeyCiphertext: Array.from(
        base64urlToBytes(encryptedItemKey.ciphertext)
      ),
      encryptedPayloadNonce: Array.from(base64urlToBytes(encryptedPayload.nonce)),
      encryptedPayloadCiphertext: Array.from(
        base64urlToBytes(encryptedPayload.ciphertext)
      ),
      itemId,
    });
    return JSON.parse(json) as VaultItem;
  }

  async encryptItem(
    vaultKey: Uint8Array,
    item: VaultItem,
    itemId: string
  ): Promise<{
    encryptedItemKey: CiphertextEnvelope;
    encryptedPayload: CiphertextEnvelope;
  }> {
    const result = await invoke<{
      encrypted_item_key_nonce: number[];
      encrypted_item_key_ciphertext: number[];
      encrypted_payload_nonce: number[];
      encrypted_payload_ciphertext: number[];
    }>("encrypt_item", {
      vaultKey: Array.from(vaultKey),
      itemJson: JSON.stringify(item),
      itemId,
    });

    return {
      encryptedItemKey: {
        alg: "XCHACHA20_POLY1305",
        nonce: bytesToBase64url(new Uint8Array(result.encrypted_item_key_nonce)),
        ciphertext: bytesToBase64url(
          new Uint8Array(result.encrypted_item_key_ciphertext)
        ),
      },
      encryptedPayload: {
        alg: "XCHACHA20_POLY1305",
        nonce: bytesToBase64url(new Uint8Array(result.encrypted_payload_nonce)),
        ciphertext: bytesToBase64url(
          new Uint8Array(result.encrypted_payload_ciphertext)
        ),
      },
    };
  }

  async generateRecoveryCode(): Promise<string> {
    return invoke<string>("generate_recovery_code");
  }

  async deriveRecoveryKey(recoveryCode: string): Promise<Uint8Array> {
    const result = await invoke<number[]>("derive_recovery_key", {
      recoveryCode,
    });
    return new Uint8Array(result);
  }

  async generateDeviceKeypair(): Promise<{
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  }> {
    const result = await invoke<{ public_key: number[]; private_key: number[] }>(
      "generate_device_keypair"
    );
    return {
      publicKey: new Uint8Array(result.public_key),
      privateKey: new Uint8Array(result.private_key),
    };
  }

  async encryptVaultKeyForDevice(
    vaultKey: Uint8Array,
    devicePublicKey: Uint8Array
  ): Promise<Uint8Array> {
    const result = await invoke<number[]>("encrypt_vault_key_for_device", {
      vaultKey: Array.from(vaultKey),
      devicePublicKey: Array.from(devicePublicKey),
    });
    return new Uint8Array(result);
  }

  async decryptVaultKeyOnDevice(
    encryptedVaultKey: Uint8Array,
    devicePrivateKey: Uint8Array
  ): Promise<Uint8Array> {
    const result = await invoke<number[]>("decrypt_vault_key_on_device", {
      encryptedVaultKey: Array.from(encryptedVaultKey),
      devicePrivateKey: Array.from(devicePrivateKey),
    });
    return new Uint8Array(result);
  }

  lock(): void {
    // No cached state in the Tauri adapter — keys live only in the Rust side.
  }
}

// ── Test double ─────────────────────────────────────────────────────────────

/**
 * Test double for development and testing.
 * NOT FOR PRODUCTION — uses simple encoding, not real crypto.
 * Marked with explicit "TEST_DOUBLE" to prevent accidental production use.
 */
export class TestDoubleCryptoAdapter implements DesktopCryptoAdapter {
  private static readonly TAG = "[TEST_DOUBLE_NOT_FOR_PRODUCTION]";
  private vaultKey: Uint8Array | null = null;
  private itemStore = new Map<string, string>();

  async deriveVaultKey(
    masterPassword: string,
    salt: Uint8Array,
    _params: { memoryKib: number; iterations: number; parallelism: number }
  ): Promise<Uint8Array> {
    // Deterministic test key derivation — NOT cryptographically secure
    const encoder = new TextEncoder();
    const input = encoder.encode(
      `${masterPassword}:${Array.from(salt).join(",")}`
    );
    const hash = new Uint8Array(32);
    for (let i = 0; i < input.length && i < 32; i++) {
      const inputByte = input[i] ?? 0;
      const saltByte = salt[i % salt.length] ?? 0;
      hash[i] = inputByte ^ saltByte;
    }
    this.vaultKey = hash;
    return hash;
  }

  async decryptItem(
    _vaultKey: Uint8Array,
    _encryptedItemKey: CiphertextEnvelope,
    encryptedPayload: CiphertextEnvelope,
    _itemId: string
  ): Promise<VaultItem> {
    // Test double: ciphertext is base64-encoded JSON
    const decoded = atob(
      encryptedPayload.ciphertext.replace(/-/g, "+").replace(/_/g, "/")
    );
    return JSON.parse(decoded) as VaultItem;
  }

  async encryptItem(
    _vaultKey: Uint8Array,
    item: VaultItem,
    itemId: string
  ): Promise<{
    encryptedItemKey: CiphertextEnvelope;
    encryptedPayload: CiphertextEnvelope;
  }> {
    // Test double: store plaintext JSON as base64url "ciphertext"
    const json = JSON.stringify(item);
    const b64 = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    this.itemStore.set(itemId, json);

    const dummyNonce = bytesToBase64url(new Uint8Array(24));
    return {
      encryptedItemKey: {
        alg: "XCHACHA20_POLY1305",
        nonce: dummyNonce,
        ciphertext: b64,
      },
      encryptedPayload: {
        alg: "XCHACHA20_POLY1305",
        nonce: dummyNonce,
        ciphertext: b64,
      },
    };
  }

  async generateRecoveryCode(): Promise<string> {
    // Generate a deterministic test code
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = i;
    }
    return bytesToBase64url(bytes);
  }

  async deriveRecoveryKey(recoveryCode: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const input = encoder.encode(`recovery:${recoveryCode}`);
    const hash = new Uint8Array(32);
    for (let i = 0; i < input.length && i < 32; i++) {
      hash[i] = input[i] ?? 0;
    }
    return hash;
  }

  async generateDeviceKeypair(): Promise<{
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  }> {
    // Deterministic test keypair
    const publicKey = new Uint8Array(32);
    const privateKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      publicKey[i] = i + 1;
      privateKey[i] = i + 128;
    }
    return { publicKey, privateKey };
  }

  async encryptVaultKeyForDevice(
    vaultKey: Uint8Array,
    _devicePublicKey: Uint8Array
  ): Promise<Uint8Array> {
    // Test double: just return the vault key bytes (NOT encrypted)
    return new Uint8Array(vaultKey);
  }

  async decryptVaultKeyOnDevice(
    encryptedVaultKey: Uint8Array,
    _devicePrivateKey: Uint8Array
  ): Promise<Uint8Array> {
    // Test double: "encrypted" is just the raw bytes
    return new Uint8Array(encryptedVaultKey);
  }

  lock(): void {
    this.vaultKey = null;
    this.itemStore.clear();
  }
}
