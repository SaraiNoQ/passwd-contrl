import {
  aeadCiphertextEnvelopeSchema,
  deviceVaultKeyPacketSchema,
  vaultItemSchema,
  vaultItemCiphertextSchema,
  type CiphertextEnvelope,
  type DeviceVaultKeyPacket,
  type TrustedDevice,
  type VaultItem,
  type VaultItemCiphertext,
} from "@zero-vault/shared";
import type {
  MobileCryptoAdapter,
  PasswordGeneratorOptions,
  TotpCode,
} from "../lib/crypto/mobile-crypto-adapter";
import type {
  LocalDeviceSecurityState,
  LocalDeviceUnlockState,
} from "@zero-vault/zero-vault-native";
import {
  AEAD_TAG_16_BYTES,
  ENCRYPTED_VAULT_KEY_48_BYTES,
  XCHACHA_NONCE_24_BYTES,
} from "./fixtures";

const SESSION_PREFIX = "test-vault-session:";

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function decodeBase64Url(value: string): string {
  const standard = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
}

/** Test-only native boundary model. Production code must never import it. */
export class TestDoubleCryptoAdapter implements MobileCryptoAdapter {
  private readonly installedAccounts = new Set<string>();
  private readonly biometricAccounts = new Set<string>();
  private readonly activeHandles = new Set<string>();
  private readonly unlockStates = new Map<string, LocalDeviceUnlockState>();

  async unlock(accountId: string): Promise<string> {
    if (!this.installedAccounts.has(accountId)) throw new Error("device_vault_key_missing");
    const handle = `${SESSION_PREFIX}${accountId}`;
    this.activeHandles.add(handle);
    return handle;
  }

  async unlockWithBiometric(accountId: string): Promise<string> {
    if (!this.installedAccounts.has(accountId) || !this.biometricAccounts.has(accountId)) {
      throw new Error("biometric_key_unavailable");
    }
    const handle = `${SESSION_PREFIX}${accountId}`;
    this.activeHandles.add(handle);
    return handle;
  }

  async enableBiometric(accountId: string): Promise<void> {
    this.requireHandle(`${SESSION_PREFIX}${accountId}`);
    this.biometricAccounts.add(accountId);
    this.unlockStates.set(accountId, "BIOMETRIC_READY");
  }

  async getLocalDeviceSecurityState(accountId: string): Promise<LocalDeviceSecurityState> {
    return {
      fingerprint: "11".repeat(32),
      unlockState: this.unlockStates.get(accountId) ?? "PASSWORD_ALLOWED",
    };
  }

  setLocalDeviceUnlockState(accountId: string, state: LocalDeviceUnlockState): void {
    this.unlockStates.set(accountId, state);
  }

  async hasVaultKey(accountId: string): Promise<boolean> {
    return this.installedAccounts.has(accountId);
  }

  async encryptItem(
    vaultSessionHandle: string,
    item: VaultItem,
    ownerUserId: string,
    revision: number,
  ): Promise<VaultItemCiphertext> {
    this.requireHandle(vaultSessionHandle);
    const parsedItem = vaultItemSchema.parse(item);
    return vaultItemCiphertextSchema.parse({
      id: parsedItem.id,
      ownerUserId,
      revision,
      createdAt: parsedItem.createdAt,
      updatedAt: parsedItem.updatedAt,
      encryptedItemKey: {
        alg: "XCHACHA20_POLY1305",
        nonce: XCHACHA_NONCE_24_BYTES,
        ciphertext: AEAD_TAG_16_BYTES,
      },
      encryptedPayload: {
        alg: "XCHACHA20_POLY1305",
        nonce: XCHACHA_NONCE_24_BYTES,
        ciphertext: encodeBase64Url(JSON.stringify(parsedItem)),
      },
      encryptedSearchTokens: [],
    });
  }

  async decryptItem(
    vaultSessionHandle: string,
    encryptedItemKey: CiphertextEnvelope,
    encryptedPayload: CiphertextEnvelope,
    itemId: string,
  ): Promise<VaultItem> {
    this.requireHandle(vaultSessionHandle);
    aeadCiphertextEnvelopeSchema.parse(encryptedItemKey);
    const payload = aeadCiphertextEnvelopeSchema.parse(encryptedPayload);
    const item = vaultItemSchema.parse(JSON.parse(decodeBase64Url(payload.ciphertext)) as unknown);
    if (item.id !== itemId) throw new Error("decrypted_item_id_mismatch");
    return item;
  }

  async createItemId(): Promise<string> {
    return "00000000-0000-4000-8000-000000000099";
  }

  async generatePassword(options: PasswordGeneratorOptions): Promise<string> {
    if (!Number.isInteger(options.length) || options.length < 1) throw new Error("invalid_password_length");
    return "Aa1!".repeat(Math.ceil(options.length / 4)).slice(0, options.length);
  }

  async generateTotp(): Promise<TotpCode> {
    return { code: "123456", validForSeconds: 30 };
  }

  async createDeviceVaultKeyPacket(
    vaultSessionHandle: string,
    device: Pick<TrustedDevice, "id" | "publicKey">,
  ): Promise<DeviceVaultKeyPacket> {
    this.requireHandle(vaultSessionHandle);
    return deviceVaultKeyPacketSchema.parse({
      version: 1,
      recipientDeviceId: device.id,
      recipientPublicKey: device.publicKey,
      ephemeralPublicKey: "E".repeat(43),
      encryptedVaultKey: {
        alg: "XCHACHA20_POLY1305",
        nonce: XCHACHA_NONCE_24_BYTES,
        ciphertext: ENCRYPTED_VAULT_KEY_48_BYTES,
      },
    });
  }

  async installDeviceVaultKey(accountId: string, packet: DeviceVaultKeyPacket): Promise<void> {
    deviceVaultKeyPacketSchema.parse(packet);
    this.installedAccounts.add(accountId);
  }

  lock(): void {
    this.activeHandles.clear();
  }

  private requireHandle(handle: string): void {
    if (!this.activeHandles.has(handle)) throw new Error("vault_locked");
  }
}
