import {
  ciphertextEnvelopeSchema,
  deviceVaultKeyPacketSchema,
  vaultItemSchema,
  vaultItemCiphertextSchema,
  type CiphertextEnvelope,
  type DeviceVaultKeyPacket,
  type TrustedDevice,
  type VaultItem,
  type VaultItemCiphertext,
} from "@zero-vault/shared";
import {
  decryptNativeItem,
  enableNativeBiometric,
  encryptNativeItem,
  generateNativePassword,
  generateNativeTotp,
  generateNativeUuid,
  getLocalDeviceSecurityState as getNativeLocalDeviceSecurityState,
  getNativeStatus,
  hasInstalledVaultKey,
  installEncryptedVaultKey,
  lockAllVaultSessions,
  openVaultSession,
  shareNativeVaultKey,
  unlockVaultWithBiometric,
  unlockVaultWithDevice,
  type LocalDeviceSecurityState,
} from "@zero-vault/zero-vault-native";

export type PasswordGeneratorOptions = {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
};

export type TotpCode = { code: string; validForSeconds: number };

/** JS receives only an opaque native session handle, never vault-key bytes. */
export interface MobileCryptoAdapter {
  unlock(accountId: string): Promise<string>;
  unlockWithBiometric(accountId: string): Promise<string>;
  enableBiometric(accountId: string): Promise<void>;
  getLocalDeviceSecurityState(accountId: string): Promise<LocalDeviceSecurityState>;
  hasVaultKey(accountId: string): Promise<boolean>;
  encryptItem(
    vaultSessionHandle: string,
    item: VaultItem,
    ownerUserId: string,
    revision: number,
  ): Promise<VaultItemCiphertext>;
  decryptItem(
    vaultSessionHandle: string,
    encryptedItemKey: CiphertextEnvelope,
    encryptedPayload: CiphertextEnvelope,
    itemId: string,
  ): Promise<VaultItem>;
  createItemId(): Promise<string>;
  generatePassword(options: PasswordGeneratorOptions): Promise<string>;
  generateTotp(secretOrUri: string): Promise<TotpCode>;
  createDeviceVaultKeyPacket(
    vaultSessionHandle: string,
    device: Pick<TrustedDevice, "id" | "publicKey">,
  ): Promise<DeviceVaultKeyPacket>;
  installDeviceVaultKey(accountId: string, packet: DeviceVaultKeyPacket): Promise<void>;
  lock(): void;
}

export class NativeMobileCryptoAdapter implements MobileCryptoAdapter {
  constructor() {
    const status = getNativeStatus();
    if (!status.available || !status.opaqueInteropVerified || !status.keystore || !status.room || !status.rustCrypto) {
      throw new Error([
        status.code.toLowerCase(),
        `protocol=${status.protocolVersion}`,
        `room=${status.room}`,
        `keystore=${status.keystore}`,
        `rust=${status.rustCrypto}`,
        `opaque=${status.opaqueInteropVerified}`,
      ].join(";"));
    }
  }

  unlock(accountId: string): Promise<string> {
    return this.openAuthorizedSession(accountId);
  }

  private async openAuthorizedSession(accountId: string): Promise<string> {
    // Registration keeps its freshly created Rust session alive through bind;
    // a normal login instead supplies a one-time device-unlock grant.
    try {
      return await openVaultSession(accountId);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
      if (code !== "VAULT_LOCKED") throw error;
      return unlockVaultWithDevice(accountId);
    }
  }

  unlockWithBiometric(accountId: string): Promise<string> {
    return unlockVaultWithBiometric(accountId);
  }

  enableBiometric(accountId: string): Promise<void> {
    return enableNativeBiometric(accountId);
  }

  getLocalDeviceSecurityState(accountId: string): Promise<LocalDeviceSecurityState> {
    return getNativeLocalDeviceSecurityState(accountId);
  }

  hasVaultKey(accountId: string): Promise<boolean> {
    return hasInstalledVaultKey(accountId);
  }

  async encryptItem(
    vaultSessionHandle: string,
    item: VaultItem,
    ownerUserId: string,
    revision: number,
  ): Promise<VaultItemCiphertext> {
    const parsedItem = vaultItemSchema.parse(item);
    const encrypted = await encryptNativeItem(vaultSessionHandle, parsedItem, parsedItem.id);
    return vaultItemCiphertextSchema.parse({
      id: parsedItem.id,
      ownerUserId,
      revision,
      createdAt: parsedItem.createdAt,
      updatedAt: parsedItem.updatedAt,
      encryptedItemKey: ciphertextEnvelopeSchema.parse(JSON.parse(encrypted.encryptedItemKeyJson)),
      encryptedPayload: ciphertextEnvelopeSchema.parse(JSON.parse(encrypted.encryptedPayloadJson)),
      encryptedSearchTokens: [],
    });
  }

  async decryptItem(
    vaultSessionHandle: string,
    encryptedItemKey: CiphertextEnvelope,
    encryptedPayload: CiphertextEnvelope,
    itemId: string,
  ): Promise<VaultItem> {
    const plaintext = await decryptNativeItem(
      vaultSessionHandle,
      ciphertextEnvelopeSchema.parse(encryptedItemKey),
      ciphertextEnvelopeSchema.parse(encryptedPayload),
      itemId,
    );
    const item = vaultItemSchema.parse(plaintext);
    if (item.id !== itemId) throw new Error("decrypted_item_id_mismatch");
    return item;
  }

  async createItemId(): Promise<string> {
    return generateNativeUuid();
  }

  async generatePassword(options: PasswordGeneratorOptions): Promise<string> {
    return generateNativePassword(options.length, options);
  }

  async generateTotp(secretOrUri: string): Promise<TotpCode> {
    return generateNativeTotp(secretOrUri, Math.floor(Date.now() / 1_000));
  }

  async createDeviceVaultKeyPacket(
    vaultSessionHandle: string,
    device: Pick<TrustedDevice, "id" | "publicKey">,
  ): Promise<DeviceVaultKeyPacket> {
    return deviceVaultKeyPacketSchema.parse(
      await shareNativeVaultKey(vaultSessionHandle, device.id, device.publicKey),
    );
  }

  async installDeviceVaultKey(accountId: string, packet: DeviceVaultKeyPacket): Promise<void> {
    await installEncryptedVaultKey(accountId, deviceVaultKeyPacketSchema.parse(packet));
  }

  lock(): void {
    lockAllVaultSessions();
  }
}

/** Fail closed when the Expo Module or verified OPAQUE path is unavailable. */
export class NativeCryptoUnavailableAdapter implements MobileCryptoAdapter {
  async unlock(): Promise<string> { throw new Error("native_crypto_unavailable"); }
  async unlockWithBiometric(): Promise<string> { throw new Error("native_crypto_unavailable"); }
  async enableBiometric(): Promise<void> { throw new Error("native_crypto_unavailable"); }
  async getLocalDeviceSecurityState(): Promise<LocalDeviceSecurityState> {
    throw new Error("native_crypto_unavailable");
  }
  async hasVaultKey(): Promise<boolean> { return false; }
  async encryptItem(): Promise<VaultItemCiphertext> { throw new Error("native_crypto_unavailable"); }
  async decryptItem(): Promise<VaultItem> { throw new Error("native_crypto_unavailable"); }
  async createItemId(): Promise<string> { throw new Error("native_crypto_unavailable"); }
  async generatePassword(): Promise<string> { throw new Error("native_crypto_unavailable"); }
  async generateTotp(): Promise<TotpCode> { throw new Error("native_crypto_unavailable"); }
  async createDeviceVaultKeyPacket(): Promise<DeviceVaultKeyPacket> { throw new Error("native_crypto_unavailable"); }
  async installDeviceVaultKey(): Promise<void> { throw new Error("native_crypto_unavailable"); }
  lock(): void { /* no native session exists */ }
}
