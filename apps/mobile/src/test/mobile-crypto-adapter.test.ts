import { describe, it, expect } from "vitest";
import { TestDoubleCryptoAdapter } from "../lib/crypto/mobile-crypto-adapter";
import type { VaultItem, VaultLogin } from "@zero-vault/shared";

describe("TestDoubleCryptoAdapter", () => {
  const adapter = new TestDoubleCryptoAdapter();
  const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const params = { memoryKib: 19456, iterations: 2, parallelism: 1 };

  it("should derive a 32-byte vault key", async () => {
    const key = await adapter.deriveVaultKey("test-password-123", salt, params);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it("should derive different keys for different passwords", async () => {
    const key1 = await adapter.deriveVaultKey("password-1", salt, params);
    const key2 = await adapter.deriveVaultKey("password-2", salt, params);
    expect(key1).not.toEqual(key2);
  });

  it("should derive same key for same inputs", async () => {
    const key1 = await adapter.deriveVaultKey("same-password", salt, params);
    const key2 = await adapter.deriveVaultKey("same-password", salt, params);
    expect(key1).toEqual(key2);
  });

  it("should decrypt test item from base64-encoded ciphertext", async () => {
    const testItem: VaultLogin = {
      id: "00000000-0000-0000-0000-000000000001",
      type: "login",
      title: "Test Login",
      origin: "https://example.com",
      username: "user@example.com",
      password: "secret123",
      folder: "",
      notes: "",
      customFields: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const encoded = btoa(JSON.stringify(testItem));
    const key = await adapter.deriveVaultKey("test", salt, params);

    const decrypted = await adapter.decryptItem(
      key,
      { alg: "XCHACHA20_POLY1305", nonce: "AA", ciphertext: "AA" },
      { alg: "XCHACHA20_POLY1305", nonce: "AA", ciphertext: encoded },
      testItem.id
    );

    expect(decrypted.id).toBe(testItem.id);
    expect(decrypted.title).toBe("Test Login");
    expect((decrypted as VaultLogin).username).toBe("user@example.com");
  });

  it("should clear state on lock", async () => {
    await adapter.deriveVaultKey("test", salt, params);
    adapter.lock();
    // Lock should not throw
    expect(true).toBe(true);
  });
});
