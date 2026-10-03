import { beforeEach, describe, expect, it } from "vitest";
import {
  deviceVaultKeyPacketSchema,
  vaultItemCiphertextSchema,
  type CiphertextEnvelope,
  type DeviceVaultKeyPacket,
  type VaultLogin,
} from "@zero-vault/shared";
import { TestDoubleCryptoAdapter } from "./test-double-crypto-adapter";
import {
  ACCOUNT_ID,
  DEVICE_ID,
  DEVICE_PUBLIC_KEY,
  ITEM_ID_A,
  XCHACHA_NONCE_24_BYTES,
  makeDeviceVaultKeyPacket,
} from "./fixtures";

const TEST_ITEM: VaultLogin = {
  id: ITEM_ID_A,
  type: "login",
  title: "Test Login",
  origin: "https://example.com",
  username: "user@example.com",
  password: "secret123",
  folder: "",
  notes: "",
  customFields: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("TestDoubleCryptoAdapter", () => {
  let adapter: TestDoubleCryptoAdapter;

  beforeEach(() => {
    adapter = new TestDoubleCryptoAdapter();
  });

  it("installs only a strict device packet and tracks the vault key by account", async () => {
    expect(await adapter.hasVaultKey(ACCOUNT_ID)).toBe(false);

    const invalidPacket = {
      ...makeDeviceVaultKeyPacket(),
      encryptedVaultKey: {
        alg: "XCHACHA20_POLY1305",
        nonce: "AA",
        ciphertext: "AA",
      },
    } as unknown as DeviceVaultKeyPacket;
    await expect(adapter.installDeviceVaultKey(ACCOUNT_ID, invalidPacket)).rejects.toThrow();
    expect(await adapter.hasVaultKey(ACCOUNT_ID)).toBe(false);

    await adapter.installDeviceVaultKey(ACCOUNT_ID, makeDeviceVaultKeyPacket());
    expect(await adapter.hasVaultKey(ACCOUNT_ID)).toBe(true);
  });

  it("returns an opaque account-scoped handle only after a vault key is installed", async () => {
    await expect(adapter.unlock(ACCOUNT_ID)).rejects.toThrow("device_vault_key_missing");
    await adapter.installDeviceVaultKey(ACCOUNT_ID, makeDeviceVaultKeyPacket());

    const handle = await adapter.unlock(ACCOUNT_ID);
    expect(handle).toBe(`test-vault-session:${ACCOUNT_ID}`);
    expect(handle).not.toContain("secret123");
  });

  it("enables biometric unlock without keeping an active JS session", async () => {
    await adapter.installDeviceVaultKey(ACCOUNT_ID, makeDeviceVaultKeyPacket());
    await expect(adapter.unlockWithBiometric(ACCOUNT_ID)).rejects.toThrow("biometric_key_unavailable");

    await adapter.unlock(ACCOUNT_ID);
    await adapter.enableBiometric(ACCOUNT_ID);
    adapter.lock();

    expect(await adapter.unlockWithBiometric(ACCOUNT_ID)).toBe(`test-vault-session:${ACCOUNT_ID}`);
  });

  it("reports every fail-closed local unlock state with the full device fingerprint", async () => {
    for (const unlockState of [
      "PASSWORD_ALLOWED",
      "DEVICE_KEY_INVALIDATED",
      "BIOMETRIC_READY",
      "BIOMETRIC_UNAVAILABLE",
      "BIOMETRIC_INVALIDATED",
    ] as const) {
      adapter.setLocalDeviceUnlockState(ACCOUNT_ID, unlockState);
      expect(await adapter.getLocalDeviceSecurityState(ACCOUNT_ID)).toEqual({
        fingerprint: "11".repeat(32),
        unlockState,
      });
    }
  });

  it("round-trips an item through envelopes accepted by the production schema", async () => {
    await adapter.installDeviceVaultKey(ACCOUNT_ID, makeDeviceVaultKeyPacket());
    const handle = await adapter.unlock(ACCOUNT_ID);
    const encrypted = await adapter.encryptItem(handle, TEST_ITEM, ACCOUNT_ID, 7);

    expect(vaultItemCiphertextSchema.parse(encrypted)).toEqual(encrypted);
    expect(encrypted.encryptedItemKey.nonce).toBe(XCHACHA_NONCE_24_BYTES);
    expect(encrypted.encryptedPayload.ciphertext).not.toBe("AA");

    const decrypted = await adapter.decryptItem(
      handle,
      encrypted.encryptedItemKey,
      encrypted.encryptedPayload,
      TEST_ITEM.id,
    );
    expect(decrypted).toEqual(TEST_ITEM);
  });

  it("rejects legacy AA fake envelopes and mismatched plaintext item IDs", async () => {
    await adapter.installDeviceVaultKey(ACCOUNT_ID, makeDeviceVaultKeyPacket());
    const handle = await adapter.unlock(ACCOUNT_ID);
    const encrypted = await adapter.encryptItem(handle, TEST_ITEM, ACCOUNT_ID, 1);
    const invalidEnvelope = {
      alg: "XCHACHA20_POLY1305",
      nonce: "AA",
      ciphertext: "AA",
    } as unknown as CiphertextEnvelope;

    await expect(
      adapter.decryptItem(handle, invalidEnvelope, encrypted.encryptedPayload, TEST_ITEM.id),
    ).rejects.toThrow();
    await expect(
      adapter.decryptItem(
        handle,
        encrypted.encryptedItemKey,
        encrypted.encryptedPayload,
        "77777777-7777-4777-8777-777777777777",
      ),
    ).rejects.toThrow("decrypted_item_id_mismatch");
  });

  it("creates a schema-valid 24-byte nonce and 48-byte device ciphertext", async () => {
    await adapter.installDeviceVaultKey(ACCOUNT_ID, makeDeviceVaultKeyPacket());
    const handle = await adapter.unlock(ACCOUNT_ID);
    const packet = await adapter.createDeviceVaultKeyPacket(handle, {
      id: DEVICE_ID,
      publicKey: DEVICE_PUBLIC_KEY,
    });

    expect(deviceVaultKeyPacketSchema.parse(packet)).toEqual(packet);
    expect(decodedLength(packet.encryptedVaultKey.nonce)).toBe(24);
    expect(decodedLength(packet.encryptedVaultKey.ciphertext)).toBe(48);
  });

  it("clears active session handles on lock", async () => {
    await adapter.installDeviceVaultKey(ACCOUNT_ID, makeDeviceVaultKeyPacket());
    const handle = await adapter.unlock(ACCOUNT_ID);
    const encrypted = await adapter.encryptItem(handle, TEST_ITEM, ACCOUNT_ID, 1);
    adapter.lock();

    await expect(
      adapter.decryptItem(handle, encrypted.encryptedItemKey, encrypted.encryptedPayload, ITEM_ID_A),
    ).rejects.toThrow("vault_locked");
  });
});

function decodedLength(value: string): number {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded.replace(/-/gu, "+").replace(/_/gu, "/")).length;
}
