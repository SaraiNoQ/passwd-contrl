import { describe, expect, it } from "vitest";
import {
  ciphertextEnvelopeSchema,
  itemLevelSyncPlanSchema,
  recoveryPacketRequestSchema,
  recoveryPacketResponseSchema,
  syncPushRequestSchema,
  vaultItemCiphertextSchema,
} from "./index";

/**
 * Security regression: verify that shared Zod schemas enforce strict boundaries
 * and reject any plaintext secret fields on encrypted item types.
 */

const envelope = (value = "ciphertext") => ({
  alg: "AES_256_GCM" as const,
  nonce: "AAAAAAAAAAAAAAAA",
  ciphertext: Buffer.from(value).toString("base64url"),
});

const encryptedItem = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "22222222-2222-4222-8222-222222222222",
  revision: 0,
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:00:00.000Z",
  encryptedItemKey: envelope("item-key"),
  encryptedPayload: envelope("payload"),
  encryptedSearchTokens: [],
};

describe("security: shared schemas reject plaintext fields on encrypted types", () => {
  it("vaultItemCiphertextSchema rejects password field", () => {
    expect(() =>
      vaultItemCiphertextSchema.parse({ ...encryptedItem, password: "secret" }),
    ).toThrow();
  });

  it("vaultItemCiphertextSchema rejects origin field", () => {
    expect(() =>
      vaultItemCiphertextSchema.parse({ ...encryptedItem, origin: "https://example.com" }),
    ).toThrow();
  });

  it("vaultItemCiphertextSchema rejects username field", () => {
    expect(() =>
      vaultItemCiphertextSchema.parse({ ...encryptedItem, username: "alice" }),
    ).toThrow();
  });

  it("vaultItemCiphertextSchema rejects notes field", () => {
    expect(() =>
      vaultItemCiphertextSchema.parse({ ...encryptedItem, notes: "plaintext notes" }),
    ).toThrow();
  });

  it("vaultItemCiphertextSchema rejects title field", () => {
    expect(() =>
      vaultItemCiphertextSchema.parse({ ...encryptedItem, title: "My Bank" }),
    ).toThrow();
  });

  it("vaultItemCiphertextSchema rejects all plaintext fields at once", () => {
    expect(() =>
      vaultItemCiphertextSchema.parse({
        ...encryptedItem,
        title: "Bank",
        origin: "https://bank.com",
        username: "user",
        password: "pass",
        notes: "notes",
      }),
    ).toThrow();
  });

  it("syncPushRequestSchema rejects plaintext fields in upserts", () => {
    expect(() =>
      syncPushRequestSchema.parse({
        baseRevision: 0,
        upserts: [{ ...encryptedItem, password: "secret" }],
        deletes: [],
      }),
    ).toThrow();
  });

  it("itemLevelSyncPlanSchema rejects plaintext fields in upserts", () => {
    expect(() =>
      itemLevelSyncPlanSchema.parse({
        protocol: "item_level_v1",
        baseRevision: 0,
        upserts: [{ ...encryptedItem, password: "secret" }],
        deletes: [],
      }),
    ).toThrow();
  });

  it("recoveryPacketRequestSchema rejects extra fields (strict mode)", () => {
    expect(() =>
      recoveryPacketRequestSchema.parse({
        encryptedRecoveryPacket: envelope("recovery"),
        recoveryCode: "ABCD-EFGH-IJKL-MNOP",
      }),
    ).toThrow();
  });

  it("recoveryPacketResponseSchema rejects extra fields (strict mode)", () => {
    expect(() =>
      recoveryPacketResponseSchema.parse({
        encryptedRecoveryPacket: envelope("recovery"),
        vaultKey: "should-not-be-here",
      }),
    ).toThrow();
  });
});

describe("security: ciphertextEnvelopeSchema strict validation", () => {
  it("rejects envelope with extra fields", () => {
    expect(() =>
      ciphertextEnvelopeSchema.parse({
        alg: "AES_256_GCM",
        nonce: "AAAAAAAAAAAAAAAA",
        ciphertext: "AAAA",
        plaintext: "should-not-be-here",
      }),
    ).toThrow();
  });

  it("rejects envelope with invalid algorithm", () => {
    expect(() =>
      ciphertextEnvelopeSchema.parse({
        alg: "INSECURE_CIPHER",
        nonce: "AAAAAAAAAAAAAAAA",
        ciphertext: "AAAA",
      }),
    ).toThrow();
  });

  it("accepts valid AES_256_GCM envelope", () => {
    expect(() =>
      ciphertextEnvelopeSchema.parse({
        alg: "AES_256_GCM",
        nonce: "AAAAAAAAAAAAAAAA",
        ciphertext: "AAAA",
      }),
    ).not.toThrow();
  });

  it("accepts valid XCHACHA20_POLY1305 envelope", () => {
    expect(() =>
      ciphertextEnvelopeSchema.parse({
        alg: "XCHACHA20_POLY1305",
        nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ciphertext: "AAAA",
      }),
    ).not.toThrow();
  });
});

describe("security: test fixtures do not contain real-looking secrets", () => {
  it("all fixture UUIDs follow test pattern (not real UUIDs)", () => {
    // Test fixture UUIDs use patterns like 11111111-... to make them
    // clearly identifiable as test data
    expect(encryptedItem.id).toMatch(/^11111111/);
    expect(encryptedItem.ownerUserId).toMatch(/^22222222/);
  });

  it("fixture envelope values are clearly fake (base64 of short strings)", () => {
    const decoded = Buffer.from(encryptedItem.encryptedPayload.ciphertext, "base64url").toString();
    expect(decoded).toBe("payload"); // clearly fake
  });
});
