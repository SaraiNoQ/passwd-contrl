import { describe, expect, it } from "vitest";
import {
  deviceListResponseSchema,
  itemLevelSyncConflictSchema,
  itemLevelSyncPlanSchema,
  itemLevelSyncResponseSchema,
  recoveryPacketRequestSchema,
  recoveryPacketResponseSchema,
  registerDeviceRequestSchema,
  syncConflictResponseSchema,
  syncPushRequestSchema,
  trustedDeviceSchema,
  vaultItemCiphertextSchema
} from "./index";

const envelope = (value = "ciphertext") => ({
  alg: "AES_256_GCM" as const,
  nonce: "AAAAAAAAAAAAAAAA",
  ciphertext: Buffer.from(value).toString("base64url")
});

const encryptedItem = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerUserId: "22222222-2222-4222-8222-222222222222",
  revision: 0,
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:00:00.000Z",
  encryptedItemKey: envelope("item-key"),
  encryptedPayload: envelope("payload"),
  encryptedSearchTokens: []
};

describe("shared schemas", () => {
  it("accepts item-level ciphertext envelopes", () => {
    expect(
      vaultItemCiphertextSchema.parse(encryptedItem)
    ).toMatchObject({ encryptedPayload: envelope("payload") });
  });

  it("rejects plaintext-looking sync payloads without encryption envelopes", () => {
    expect(() =>
      syncPushRequestSchema.parse({
        baseRevision: 0,
        upserts: [{ password: "secret" }],
        deletes: []
      })
    ).toThrow();
  });

  it("rejects plaintext fields attached to encrypted sync items", () => {
    expect(() =>
      syncPushRequestSchema.parse({
        baseRevision: 0,
        upserts: [
          {
            ...encryptedItem,
            title: "Email",
            origin: "https://example.com",
            username: "alice",
            password: "secret",
            notes: "plaintext"
          }
        ],
        deletes: []
      })
    ).toThrow();
  });

  it("defines a Phase 4 item-level sync plan without plaintext fields", () => {
    expect(
      itemLevelSyncPlanSchema.parse({
        protocol: "item_level_v1",
        baseRevision: 1,
        upserts: [
          {
            ...encryptedItem,
            baseItemRevision: 0,
            clientMutationId: "33333333-3333-4333-8333-333333333333",
            ciphertextHash: "payloadHash"
          }
        ],
        deletes: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            ownerUserId: encryptedItem.ownerUserId,
            baseItemRevision: 1,
            deletedAt: "2026-06-04T00:01:00.000Z"
          }
        ]
      })
    ).toMatchObject({ protocol: "item_level_v1", upserts: [{ baseItemRevision: 0 }] });

    expect(() =>
      itemLevelSyncPlanSchema.parse({
        protocol: "item_level_v1",
        baseRevision: 1,
        upserts: [{ ...encryptedItem, password: "secret" }],
        deletes: []
      })
    ).toThrow();
  });

  it("keeps legacy conflict responses compatible while allowing item conflicts", () => {
    expect(syncConflictResponseSchema.parse({ error: "sync_conflict", serverRevision: 7 })).toMatchObject({
      error: "sync_conflict",
      serverRevision: 7,
      conflicts: []
    });

    expect(
      syncConflictResponseSchema.parse({
        error: "sync_conflict",
        serverRevision: 7,
        conflicts: [
          {
            itemId: encryptedItem.id,
            operation: "upsert",
            reason: "server_revision_advanced",
            clientBaseRevision: 6,
            serverRevision: 7
          }
        ]
      })
    ).toMatchObject({ conflicts: [{ itemId: encryptedItem.id }] });
  });

  // ── Item-Level Sync Schemas ─────────────────────────────────────────────────

  it("accepts a valid item-level sync plan", () => {
    const plan = {
      protocol: "item_level_v1" as const,
      baseRevision: 0,
      upserts: [
        {
          ...encryptedItem,
          baseItemRevision: 0,
          clientMutationId: "55555555-5555-4555-8555-555555555555"
        }
      ],
      deletes: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          ownerUserId: encryptedItem.ownerUserId,
          baseItemRevision: 1,
          deletedAt: "2026-06-04T00:02:00.000Z"
        }
      ]
    };
    expect(itemLevelSyncPlanSchema.parse(plan)).toMatchObject({ protocol: "item_level_v1" });
  });

  it("rejects an item-level sync plan with a missing protocol field", () => {
    expect(() =>
      itemLevelSyncPlanSchema.parse({
        baseRevision: 0,
        upserts: [],
        deletes: []
      })
    ).toThrow();
  });

  it("rejects an item-level sync plan with wrong protocol literal", () => {
    expect(() =>
      itemLevelSyncPlanSchema.parse({
        protocol: "wrong_protocol",
        baseRevision: 0,
        upserts: [],
        deletes: []
      })
    ).toThrow();
  });

  it("rejects an item-level sync plan with negative baseRevision", () => {
    expect(() =>
      itemLevelSyncPlanSchema.parse({
        protocol: "item_level_v1",
        baseRevision: -1,
        upserts: [],
        deletes: []
      })
    ).toThrow();
  });

  it("accepts a valid item-level sync response", () => {
    const response = {
      protocol: "item_level_v1" as const,
      serverRevision: 1,
      applied: {
        upsertedItemIds: [encryptedItem.id],
        deletedItemIds: []
      },
      conflicts: []
    };
    expect(itemLevelSyncResponseSchema.parse(response)).toMatchObject({ serverRevision: 1 });
  });

  it("rejects an item-level sync response with missing applied field", () => {
    expect(() =>
      itemLevelSyncResponseSchema.parse({
        protocol: "item_level_v1",
        serverRevision: 1,
        conflicts: []
      })
    ).toThrow();
  });

  it("accepts a valid item-level sync conflict", () => {
    const conflict = {
      itemId: encryptedItem.id,
      operation: "upsert" as const,
      reason: "item_revision_advanced" as const,
      clientBaseRevision: 0,
      serverRevision: 2,
      serverItemRevision: 1
    };
    expect(itemLevelSyncConflictSchema.parse(conflict)).toMatchObject({ reason: "item_revision_advanced" });
  });

  it("rejects an item-level sync conflict with invalid operation", () => {
    expect(() =>
      itemLevelSyncConflictSchema.parse({
        itemId: encryptedItem.id,
        operation: "invalid_op",
        reason: "server_revision_advanced",
        clientBaseRevision: 0,
        serverRevision: 1
      })
    ).toThrow();
  });

  // ── Trusted Device Schemas ──────────────────────────────────────────────────

  it("accepts a valid trusted device", () => {
    const device = {
      id: "77777777-7777-4777-8777-777777777777",
      name: "MacBook Pro",
      fingerprint: "browser-install-1",
      publicKey: "cHVibGljS2V5",
      status: "pending" as const,
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
      lastSeenIp: "203.0.113.1",
      lastSeenLocation: "Shanghai · CN"
    };
    expect(trustedDeviceSchema.parse(device)).toMatchObject({ name: "MacBook Pro", status: "pending" });
  });

  it("rejects a trusted device with invalid status", () => {
    expect(() =>
      trustedDeviceSchema.parse({
        id: "77777777-7777-4777-8777-777777777777",
        name: "MacBook Pro",
        publicKey: "cHVibGljS2V5",
        status: "unknown",
        createdAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z"
      })
    ).toThrow();
  });

  it("rejects a trusted device with an empty name", () => {
    expect(() =>
      trustedDeviceSchema.parse({
        id: "77777777-7777-4777-8777-777777777777",
        name: "",
        publicKey: "cHVibGljS2V5",
        status: "pending",
        createdAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z"
      })
    ).toThrow();
  });

  it("accepts a valid register device request", () => {
    expect(
      registerDeviceRequestSchema.parse({
        name: "iPhone",
        fingerprint: "ios-install-1",
        publicKey: "cHVibGljS2V5"
      })
    ).toMatchObject({ name: "iPhone" });
  });

  it("accepts a valid device list response", () => {
    const response = {
      devices: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          name: "MacBook",
          fingerprint: "browser-install-1",
          publicKey: "cHVibGljS2V5",
          status: "approved" as const,
          createdAt: "2026-06-04T00:00:00.000Z",
          updatedAt: "2026-06-04T00:00:00.000Z",
          lastSeenIp: "203.0.113.1",
          lastSeenLocation: "Shanghai · CN"
        }
      ]
    };
    expect(deviceListResponseSchema.parse(response)).toMatchObject({ devices: [{ name: "MacBook" }] });
  });

  // ── Recovery Packet Schemas ─────────────────────────────────────────────────

  it("accepts a valid recovery packet request", () => {
    expect(
      recoveryPacketRequestSchema.parse({
        encryptedRecoveryPacket: envelope("recovery-data")
      })
    ).toMatchObject({ encryptedRecoveryPacket: envelope("recovery-data") });
  });

  it("accepts recovery packet KDF parameters without allowing plaintext", () => {
    expect(
      recoveryPacketRequestSchema.parse({
        encryptedRecoveryPacket: {
          ...envelope("recovery-data"),
          kdfIterations: 600000
        }
      })
    ).toMatchObject({ encryptedRecoveryPacket: { kdfIterations: 600000 } });
  });

  it("rejects a recovery packet request with plaintext fields", () => {
    expect(() =>
      recoveryPacketRequestSchema.parse({
        encryptedRecoveryPacket: envelope("recovery-data"),
        password: "plaintext"
      })
    ).toThrow();
  });

  it("accepts a valid recovery packet response", () => {
    expect(
      recoveryPacketResponseSchema.parse({
        encryptedRecoveryPacket: envelope("recovery-data")
      })
    ).toMatchObject({ encryptedRecoveryPacket: envelope("recovery-data") });
  });
});
