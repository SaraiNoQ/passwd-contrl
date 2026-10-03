import {
  aeadCiphertextEnvelopeSchema,
  deviceVaultKeyPacketSchema,
  itemLevelSyncPullResponseSchema,
  vaultItemCiphertextSchema,
  type CiphertextEnvelope,
  type DeviceVaultKeyPacket,
  type ItemLevelSyncPullResponse,
  type MobileDeviceLogin,
  type VaultItemCiphertext,
} from "@zero-vault/shared";
import type { StoredItem } from "../lib/storage/mobile-ciphertext-store";

export const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
export const ITEM_ID_A = "22222222-2222-4222-8222-222222222222";
export const ITEM_ID_B = "33333333-3333-4333-8333-333333333333";
export const MUTATION_ID_A = "44444444-4444-4444-8444-444444444444";
export const MUTATION_ID_B = "55555555-5555-4555-8555-555555555555";
export const DEVICE_ID = "66666666-6666-4666-8666-666666666666";
export const DEVICE_PUBLIC_KEY = "R".repeat(43);
export const DEVICE_CREDENTIAL = "C".repeat(43);
export const CREATED_AT = "2026-01-01T00:00:00.000Z";
export const UPDATED_AT = "2026-01-02T00:00:00.000Z";

// Encoded fixed-size byte arrays. Unlike the old "AA" placeholders, these
// satisfy the production nonce/tag/packet lengths enforced by shared schemas.
export const XCHACHA_NONCE_24_BYTES = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB";
export const AEAD_TAG_16_BYTES = "AgICAgICAgICAgICAgICAg";
export const ENCRYPTED_VAULT_KEY_48_BYTES = "AwMD".repeat(16);

type AeadEnvelope = Extract<
  CiphertextEnvelope,
  { alg: "XCHACHA20_POLY1305" | "AES_256_GCM" }
>;

export function makeEnvelope(ciphertext = AEAD_TAG_16_BYTES): AeadEnvelope {
  return aeadCiphertextEnvelopeSchema.parse({
    alg: "XCHACHA20_POLY1305",
    nonce: XCHACHA_NONCE_24_BYTES,
    ciphertext,
  });
}

export function makeCiphertext(
  id = ITEM_ID_A,
  revision = 0,
  ownerUserId = ACCOUNT_ID,
): VaultItemCiphertext {
  return vaultItemCiphertextSchema.parse({
    id,
    ownerUserId,
    revision,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    encryptedItemKey: makeEnvelope(),
    encryptedPayload: makeEnvelope(),
    encryptedSearchTokens: [],
  });
}

export function makeStoredItem(
  id = ITEM_ID_A,
  revision = 0,
  lastSyncedAt = CREATED_AT,
): StoredItem {
  return {
    itemId: id,
    ciphertext: makeCiphertext(id, revision),
    itemRevision: revision,
    lastSyncedAt,
    hasConflict: false,
  };
}

export function makePullResponse(
  overrides: Partial<ItemLevelSyncPullResponse> = {},
): ItemLevelSyncPullResponse {
  return itemLevelSyncPullResponseSchema.parse({
    protocol: "item_level_v1",
    serverRevision: 0,
    cursor: 0,
    hasMore: false,
    changes: [],
    items: [],
    deletedItemIds: [],
    deletedItems: [],
    ...overrides,
  });
}

export const DEVICE_LOGIN: MobileDeviceLogin = {
  id: DEVICE_ID,
  name: "Zero Vault Android",
  fingerprint: "android-fingerprint-001",
  publicKey: DEVICE_PUBLIC_KEY,
  credential: DEVICE_CREDENTIAL,
};

export function makeDeviceVaultKeyPacket(): DeviceVaultKeyPacket {
  return deviceVaultKeyPacketSchema.parse({
    version: 1,
    recipientDeviceId: DEVICE_ID,
    recipientPublicKey: DEVICE_PUBLIC_KEY,
    ephemeralPublicKey: "E".repeat(43),
    encryptedVaultKey: {
      alg: "XCHACHA20_POLY1305",
      nonce: XCHACHA_NONCE_24_BYTES,
      ciphertext: ENCRYPTED_VAULT_KEY_48_BYTES,
    },
  });
}
