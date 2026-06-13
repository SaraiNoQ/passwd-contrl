/**
 * MobileCryptoAdapter — interface for mobile cryptographic operations.
 *
 * MVP uses a test double (TestDoubleCryptoAdapter) for development.
 * Production MUST use crypto-core via UniFFI/Expo native module.
 *
 * Security rules:
 * - Master password is never logged, persisted, or sent to server.
 * - Derived keys and vault keys are never logged or persisted in plaintext.
 * - Plaintext items exist only in JS memory while vault is unlocked.
 * - Locking clears all sensitive state from memory.
 */

import type { VaultItem } from "@zero-vault/shared";
import type { CiphertextEnvelope } from "@zero-vault/shared";

export interface MobileCryptoAdapter {
  /**
   * Derive vault key from master password and salt.
   * Returns the raw vault key bytes (32 bytes).
   */
  deriveVaultKey(
    masterPassword: string,
    salt: Uint8Array,
    params: { memoryKib: number; iterations: number; parallelism: number }
  ): Promise<Uint8Array>;

  /**
   * Decrypt a single item from its ciphertext envelope.
   * The item key is derived from the vault key and item ID.
   */
  decryptItem(
    vaultKey: Uint8Array,
    encryptedItemKey: CiphertextEnvelope,
    encryptedPayload: CiphertextEnvelope,
    itemId: string
  ): Promise<VaultItem>;

  /**
   * Lock the adapter — clear any cached keys or sensitive state.
   */
  lock(): void;
}

/**
 * Test double for development and testing.
 * NOT FOR PRODUCTION — uses simple base64 encoding, not real crypto.
 * Marked with explicit "TEST_DOUBLE" to prevent accidental production use.
 */
export class TestDoubleCryptoAdapter implements MobileCryptoAdapter {
  private static readonly TAG = "[TEST_DOUBLE_NOT_FOR_PRODUCTION]";
  private derivedKeys = new Map<string, Uint8Array>();

  async deriveVaultKey(
    masterPassword: string,
    salt: Uint8Array,
    _params: { memoryKib: number; iterations: number; parallelism: number }
  ): Promise<Uint8Array> {
    // Deterministic test key derivation — NOT cryptographically secure
    const encoder = new TextEncoder();
    const input = encoder.encode(`${masterPassword}:${Array.from(salt).join(",")}`);
    const hash = new Uint8Array(32);
    for (let i = 0; i < input.length && i < 32; i++) {
      const inputByte = input[i] ?? 0;
      const saltByte = salt[i % salt.length] ?? 0;
      hash[i] = inputByte ^ saltByte;
    }
    this.derivedKeys.set("vault", hash);
    return hash;
  }

  async decryptItem(
    vaultKey: Uint8Array,
    _encryptedItemKey: CiphertextEnvelope,
    encryptedPayload: CiphertextEnvelope,
    _itemId: string
  ): Promise<VaultItem> {
    // Test double: ciphertext is base64-encoded JSON
    const decoded = atob(encryptedPayload.ciphertext.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded) as VaultItem;
  }

  lock(): void {
    this.derivedKeys.clear();
  }
}
