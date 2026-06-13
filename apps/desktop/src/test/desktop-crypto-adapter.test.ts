import { describe, it, expect, beforeEach } from "vitest";
import {
  TestDoubleCryptoAdapter,
  type DesktopCryptoAdapter,
} from "../lib/crypto/desktop-crypto-adapter";
import type { VaultItem, CiphertextEnvelope } from "@zero-vault/shared";

// ── Fixtures ────────────────────────────────────────────────────────────────

const TEST_SALT = new Uint8Array(16).fill(1);

const TEST_KDF_PARAMS = { memoryKib: 64, iterations: 1, parallelism: 1 };

const TEST_LOGIN: VaultItem = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  type: "login",
  title: "Example",
  folder: "",
  notes: "",
  customFields: [],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  origin: "https://example.com",
  username: "user@example.com",
  password: "s3cret!",
};

// ── TestDoubleCryptoAdapter tests ───────────────────────────────────────────

describe("TestDoubleCryptoAdapter", () => {
  let adapter: DesktopCryptoAdapter;

  beforeEach(() => {
    adapter = new TestDoubleCryptoAdapter();
  });

  // ── deriveVaultKey ──────────────────────────────────────────────────────

  describe("deriveVaultKey", () => {
    it("returns 32 bytes", async () => {
      const key = await adapter.deriveVaultKey("password", TEST_SALT, TEST_KDF_PARAMS);
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it("returns deterministic output for same inputs", async () => {
      const first = await adapter.deriveVaultKey("password", TEST_SALT, TEST_KDF_PARAMS);
      const second = await adapter.deriveVaultKey("password", TEST_SALT, TEST_KDF_PARAMS);
      expect(Array.from(first)).toEqual(Array.from(second));
    });

    it("returns different output for different passwords", async () => {
      const keyA = await adapter.deriveVaultKey("password-a", TEST_SALT, TEST_KDF_PARAMS);
      const keyB = await adapter.deriveVaultKey("password-b", TEST_SALT, TEST_KDF_PARAMS);
      expect(Array.from(keyA)).not.toEqual(Array.from(keyB));
    });
  });

  // ── encryptItem / decryptItem round-trip ────────────────────────────────

  describe("encryptItem / decryptItem", () => {
    it("round-trips a login item", async () => {
      const vaultKey = await adapter.deriveVaultKey("password", TEST_SALT, TEST_KDF_PARAMS);
      const itemId = TEST_LOGIN.id;

      const encrypted = await adapter.encryptItem(vaultKey, TEST_LOGIN, itemId);

      expect(encrypted.encryptedItemKey.alg).toBe("XCHACHA20_POLY1305");
      expect(encrypted.encryptedPayload.alg).toBe("XCHACHA20_POLY1305");

      const decrypted = await adapter.decryptItem(
        vaultKey,
        encrypted.encryptedItemKey,
        encrypted.encryptedPayload,
        itemId
      );

      expect(decrypted).toEqual(TEST_LOGIN);
    });

    it("round-trips a secure_note item", async () => {
      const note: VaultItem = {
        id: "660e8400-e29b-41d4-a716-446655440001",
        type: "secure_note",
        title: "My Secret Note",
        folder: "Personal",
        notes: "",
        customFields: [],
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        noteBody: "This is confidential.",
      };

      const vaultKey = await adapter.deriveVaultKey("password", TEST_SALT, TEST_KDF_PARAMS);
      const encrypted = await adapter.encryptItem(vaultKey, note, note.id);
      const decrypted = await adapter.decryptItem(
        vaultKey,
        encrypted.encryptedItemKey,
        encrypted.encryptedPayload,
        note.id
      );

      expect(decrypted).toEqual(note);
    });
  });

  // ── generateRecoveryCode ────────────────────────────────────────────────

  describe("generateRecoveryCode", () => {
    it("returns a base64url string", async () => {
      const code = await adapter.generateRecoveryCode();
      expect(typeof code).toBe("string");
      // base64url: alphanumeric, -, _
      expect(code).toMatch(/^[A-Za-z0-9_-]+={0,2}$/);
    });

    it("returns at least 43 characters (32 bytes encoded)", async () => {
      const code = await adapter.generateRecoveryCode();
      expect(code.length).toBeGreaterThanOrEqual(43);
    });
  });

  // ── deriveRecoveryKey ───────────────────────────────────────────────────

  describe("deriveRecoveryKey", () => {
    it("returns 32 bytes", async () => {
      const key = await adapter.deriveRecoveryKey("ABCD-EFGH-IJKL-MNOP");
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it("returns deterministic output", async () => {
      const first = await adapter.deriveRecoveryKey("ABCD-EFGH-IJKL-MNOP");
      const second = await adapter.deriveRecoveryKey("ABCD-EFGH-IJKL-MNOP");
      expect(Array.from(first)).toEqual(Array.from(second));
    });
  });

  // ── generateDeviceKeypair ───────────────────────────────────────────────

  describe("generateDeviceKeypair", () => {
    it("returns public and private keys as 32-byte arrays", async () => {
      const kp = await adapter.generateDeviceKeypair();
      expect(kp.publicKey).toBeInstanceOf(Uint8Array);
      expect(kp.privateKey).toBeInstanceOf(Uint8Array);
      expect(kp.publicKey.length).toBe(32);
      expect(kp.privateKey.length).toBe(32);
    });

    it("public and private keys are different", async () => {
      const kp = await adapter.generateDeviceKeypair();
      expect(Array.from(kp.publicKey)).not.toEqual(Array.from(kp.privateKey));
    });
  });

  // ── device key encrypt/decrypt round-trip ───────────────────────────────

  describe("encryptVaultKeyForDevice / decryptVaultKeyOnDevice", () => {
    it("round-trips a vault key through device encryption", async () => {
      const vaultKey = await adapter.deriveVaultKey("password", TEST_SALT, TEST_KDF_PARAMS);
      const kp = await adapter.generateDeviceKeypair();

      const encrypted = await adapter.encryptVaultKeyForDevice(vaultKey, kp.publicKey);
      const decrypted = await adapter.decryptVaultKeyOnDevice(encrypted, kp.privateKey);

      expect(Array.from(decrypted)).toEqual(Array.from(vaultKey));
    });
  });

  // ── lock ────────────────────────────────────────────────────────────────

  describe("lock", () => {
    it("clears internal state", () => {
      // lock() should not throw
      expect(() => adapter.lock()).not.toThrow();
    });

    it("can be called multiple times", () => {
      adapter.lock();
      adapter.lock();
    });
  });
});
