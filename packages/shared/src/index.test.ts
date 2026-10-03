import { describe, expect, it } from "vitest";
import {
  buildRecoveryFinishTranscript,
  cloudExportListResponseSchema,
  ciphertextEnvelopeSchema,
  decodeCanonicalBase64Url,
  deviceListResponseSchema,
  encodeCanonicalBase64Url,
  itemLevelSyncConflictSchema,
  itemLevelSyncPlanSchema,
  itemLevelSyncResponseSchema,
  recoveryPacketRequestSchema,
  recoveryPacketResponseSchema,
  recoveryFinishRequestSchema,
  recoveryPacketV2Schema,
  registerDeviceRequestSchema,
  syncConflictResponseSchema,
  syncPushRequestSchema,
  trustedDeviceSchema,
  vaultItemCiphertextSchema,
  vaultLoginSchema,
  mobileDeviceLoginSchema,
  mobileRegisterFinishRequestSchema,
  mobileSessionResponseSchema,
  MAX_AAD_BASE64URL_CHARS,
  MAX_CIPHERTEXT_BASE64URL_CHARS,
  MAX_ENCRYPTED_SEARCH_TOKENS,
  MAX_SYNC_MUTATIONS
} from "./index";

const fixedBase64Url = (length: number, start = 0): string =>
  Buffer.from(Uint8Array.from({ length }, (_, index) => (start + index) & 0xff))
    .toString("base64url");

const recoveryPacketV2 = {
  version: 2 as const,
  alg: "XCHACHA20_POLY1305" as const,
  kdf: {
    alg: "ARGON2ID_V13" as const,
    salt: fixedBase64Url(16, 16),
    memoryKib: 65_536 as const,
    iterations: 3 as const,
    parallelism: 4 as const
  },
  nonce: fixedBase64Url(24, 32),
  ciphertext: fixedBase64Url(81)
};

const envelope = (value = "ciphertext") => ({
  alg: "AES_256_GCM" as const,
  nonce: "AAAAAAAAAAAAAAAA",
  ciphertext: Buffer.from(value.padEnd(16, "_")).toString("base64url")
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
  it("accepts only known encrypted cloud backup metadata", () => {
    const metadata = {
      id: "11111111-1111-4111-8111-111111111111",
      size: 1024,
      algorithm: "ZERO_VAULT_ITEM_ENVELOPES_V1",
      createdAt: "2026-07-16T00:00:00.000Z",
    };
    expect(cloudExportListResponseSchema.parse({ exports: [metadata] })).toEqual({ exports: [metadata] });
    expect(cloudExportListResponseSchema.parse({
      exports: [{ ...metadata, algorithm: "ZERO_VAULT_MOBILE_BACKUP_V2" }],
    }).exports[0]?.algorithm).toBe("ZERO_VAULT_MOBILE_BACKUP_V2");
    expect(() => cloudExportListResponseSchema.parse({
      exports: [{ ...metadata, algorithm: "PLAINTEXT" }],
    })).toThrow();
  });

  it("accepts encrypted login metadata for Android app matching", () => {
    expect(vaultLoginSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      type: "login",
      title: "Example",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      androidAssociations: [{
        packageName: "com.example.app",
        signingCertificateSha256: "a".repeat(64)
      }]
    })).toMatchObject({
      androidAssociations: [{ packageName: "com.example.app", signingCertificateSha256: "A".repeat(64) }]
    });

    expect(() => vaultLoginSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      type: "login",
      title: "Bad",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      androidAssociations: [{ packageName: "not-a-package", signingCertificateSha256: "00" }]
    })).toThrow();

    expect(() => vaultLoginSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      type: "login",
      title: "Duplicate",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      androidAssociations: [
        { packageName: "com.example.app", signingCertificateSha256: "A".repeat(64) },
        { packageName: "com.example.app", signingCertificateSha256: "a".repeat(64) }
      ]
    })).toThrow();
  });

  it("requires a bearer token in a mobile session response", () => {
    expect(mobileSessionResponseSchema.parse({
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "android@example.com",
        serverRevision: 0
      },
      csrfToken: "csrf-token",
      sessionToken: "A".repeat(43),
      device: { id: "77777777-7777-4777-8777-777777777777", status: "pending" }
    })).toMatchObject({ sessionToken: "A".repeat(43) });
    expect(() => mobileSessionResponseSchema.parse({
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "android@example.com",
        serverRevision: 0
      },
      csrfToken: "csrf-token",
      sessionToken: "too-short",
      device: { id: "77777777-7777-4777-8777-777777777777", status: "pending" }
    })).toThrow();
    expect(() => mobileSessionResponseSchema.parse({
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "android@example.com",
        serverRevision: 0
      },
      csrfToken: "csrf-token",
      sessionToken: "A".repeat(43),
      device: { id: "77777777-7777-4777-8777-777777777777", status: "pending" },
      deviceCredential: "B".repeat(43)
    })).toThrow();
  });

  it("requires native-persisted device ids and credentials before mobile finish", () => {
    const device = {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Android",
      fingerprint: "android-install-test",
      publicKey: "D".repeat(43),
      credential: "C".repeat(43)
    };
    expect(mobileDeviceLoginSchema.parse(device)).toEqual(device);
    expect(() => mobileDeviceLoginSchema.parse({ ...device, credential: undefined })).toThrow();
    expect(() => mobileDeviceLoginSchema.parse({ ...device, id: undefined })).toThrow();

    const encryptedVaultKeyPacket = {
      version: 1 as const,
      recipientDeviceId: device.id,
      recipientPublicKey: device.publicKey,
      ephemeralPublicKey: "E".repeat(43),
      encryptedVaultKey: {
        alg: "XCHACHA20_POLY1305" as const,
        nonce: "N".repeat(32),
        ciphertext: "V".repeat(64)
      }
    };
    expect(mobileRegisterFinishRequestSchema.parse({
      registrationSessionId: "88888888-8888-4888-8888-888888888888",
      email: "android@example.com",
      registrationRecord: "cmVjb3Jk",
      publicKeyBundle: "cHVibGlj",
      encryptedRecoveryPacket: recoveryPacketV2,
      recoverySigningPublicKey: fixedBase64Url(32, 160),
      device: { ...device, encryptedVaultKeyPacket }
    }).device.credential).toBe(device.credential);

    expect(() => mobileRegisterFinishRequestSchema.parse({
      registrationSessionId: "88888888-8888-4888-8888-888888888888",
      email: "android@example.com",
      registrationRecord: "cmVjb3Jk",
      publicKeyBundle: "cHVibGlj",
      encryptedRecoveryPacket: recoveryPacketV2,
      recoverySigningPublicKey: fixedBase64Url(32, 160),
      device: {
        ...device,
        encryptedVaultKeyPacket: {
          ...encryptedVaultKeyPacket,
          encryptedVaultKey: envelope("vault-key")
        }
      }
    })).toThrow();
  });

  it("accepts item-level ciphertext envelopes", () => {
    expect(
      vaultItemCiphertextSchema.parse(encryptedItem)
    ).toMatchObject({ encryptedPayload: envelope("payload") });
  });

  it("enforces ciphertext, AAD, and encrypted-search resource limits", () => {
    expect(ciphertextEnvelopeSchema.parse({
      alg: "XCHACHA20_POLY1305",
      nonce: "A".repeat(32),
      ciphertext: "A".repeat(MAX_CIPHERTEXT_BASE64URL_CHARS),
      aad: "A".repeat(MAX_AAD_BASE64URL_CHARS)
    })).toBeTruthy();
    expect(() => ciphertextEnvelopeSchema.parse({
      alg: "XCHACHA20_POLY1305",
      nonce: "A".repeat(32),
      ciphertext: "A".repeat(MAX_CIPHERTEXT_BASE64URL_CHARS + 1)
    })).toThrow();
    expect(() => ciphertextEnvelopeSchema.parse({
      alg: "XCHACHA20_POLY1305",
      nonce: "A".repeat(32),
      ciphertext: "AA",
      aad: "A".repeat(MAX_AAD_BASE64URL_CHARS + 1)
    })).toThrow();
    expect(() => vaultItemCiphertextSchema.parse({
      ...encryptedItem,
      encryptedSearchTokens: Array.from(
        { length: MAX_ENCRYPTED_SEARCH_TOKENS + 1 },
        () => envelope("token")
      )
    })).toThrow();
  });

  it("enforces algorithm-specific nonce, tag, and HMAC shapes", () => {
    expect(() => ciphertextEnvelopeSchema.parse({
      alg: "XCHACHA20_POLY1305",
      nonce: "A".repeat(31),
      ciphertext: "A".repeat(22)
    })).toThrow();
    expect(() => ciphertextEnvelopeSchema.parse({
      alg: "AES_256_GCM",
      nonce: "A".repeat(16),
      ciphertext: "A".repeat(21)
    })).toThrow();
    expect(ciphertextEnvelopeSchema.parse({
      alg: "HMAC_SHA256",
      nonce: "AA",
      ciphertext: "a".repeat(64)
    })).toBeTruthy();
    expect(() => ciphertextEnvelopeSchema.parse({
      alg: "HMAC_SHA256",
      nonce: "AAAAAAAAAAAAAAAA",
      ciphertext: "A".repeat(64)
    })).toThrow();
    expect(() => vaultItemCiphertextSchema.parse({
      ...encryptedItem,
      encryptedPayload: {
        alg: "HMAC_SHA256",
        nonce: "AA",
        ciphertext: "a".repeat(64)
      }
    })).toThrow();
    expect(() => vaultItemCiphertextSchema.parse({
      ...encryptedItem,
      encryptedSearchTokens: [envelope("not-an-hmac")]
    })).toThrow();
  });

  it("caps legacy and item-level mutation batches", () => {
    const deletes = Array.from({ length: MAX_SYNC_MUTATIONS + 1 }, () => crypto.randomUUID());
    expect(() => syncPushRequestSchema.parse({
      baseRevision: 0,
      upserts: [],
      deletes
    })).toThrow();
    expect(() => itemLevelSyncPlanSchema.parse({
      protocol: "item_level_v1",
      baseRevision: 0,
      upserts: [],
      deletes: deletes.map((id) => ({
        id,
        ownerUserId: encryptedItem.ownerUserId,
        baseItemRevision: 0,
        deletedAt: "2026-06-04T00:01:00.000Z",
        clientMutationId: crypto.randomUUID()
      }))
    })).toThrow();
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
            deletedAt: "2026-06-04T00:01:00.000Z",
            clientMutationId: "44444444-4444-4444-8444-444444444445"
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

  it("requires partial acknowledgements on item-level conflict responses", () => {
    const emptyApplied = {
      upsertedItemIds: [],
      deletedItemIds: [],
      mutationReceipts: []
    };
    expect(syncConflictResponseSchema.parse({
      error: "sync_conflict",
      serverRevision: 7,
      applied: emptyApplied
    })).toMatchObject({
      error: "sync_conflict",
      serverRevision: 7,
      conflicts: []
    });

    expect(
      syncConflictResponseSchema.parse({
        error: "sync_conflict",
        serverRevision: 7,
        applied: emptyApplied,
        conflicts: [
          {
            itemId: encryptedItem.id,
            operation: "upsert",
            reason: "invalid_server_revision",
            clientBaseRevision: 6,
            serverRevision: 7,
            serverState: { kind: "missing" }
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
          deletedAt: "2026-06-04T00:02:00.000Z",
          clientMutationId: "66666666-6666-4666-8666-666666666667"
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
        deletedItemIds: [],
        mutationReceipts: [{
          clientMutationId: "55555555-5555-4555-8555-555555555555",
          itemId: encryptedItem.id,
          operation: "upsert",
          appliedItemRevision: 1
        }]
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
      serverItemRevision: 1,
      serverState: { kind: "item" as const, item: { ...encryptedItem, revision: 1 } }
    };
    expect(itemLevelSyncConflictSchema.parse(conflict)).toMatchObject({ reason: "item_revision_advanced" });
  });

  it("rejects an item-level sync conflict with invalid operation", () => {
    expect(() =>
      itemLevelSyncConflictSchema.parse({
        itemId: encryptedItem.id,
        operation: "invalid_op",
        reason: "invalid_server_revision",
        clientBaseRevision: 0,
        serverRevision: 1,
        serverState: { kind: "missing" }
      })
    ).toThrow();
  });

  // ── Trusted Device Schemas ──────────────────────────────────────────────────

  it("accepts a valid trusted device", () => {
    const device = {
      id: "77777777-7777-4777-8777-777777777777",
      name: "MacBook Pro",
      fingerprint: "browser-install-1",
      publicKey: "A".repeat(43),
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
        publicKey: "A".repeat(43),
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
        publicKey: "A".repeat(43),
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
        publicKey: "A".repeat(43)
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
          publicKey: "A".repeat(43),
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

  it("round-trips canonical unpadded base64url without Buffer-dependent production code", () => {
    for (const length of [1, 2, 3, 16, 24, 32, 48, 64, 81, 104]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 17 + length) & 0xff);
      const encoded = encodeCanonicalBase64Url(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString("base64url"));
      expect(decodeCanonicalBase64Url(encoded)).toEqual(bytes);
    }
    expect(() => decodeCanonicalBase64Url("AB")).toThrow("invalid_canonical_base64url");
    expect(() => decodeCanonicalBase64Url("AA==")).toThrow("invalid_canonical_base64url");
  });

  it("accepts only the fixed recovery-v2 Argon2id and ciphertext shape", () => {
    expect(recoveryPacketV2Schema.parse(recoveryPacketV2)).toEqual(recoveryPacketV2);
    expect(() => recoveryPacketV2Schema.parse({
      ...recoveryPacketV2,
      kdf: { ...recoveryPacketV2.kdf, memoryKib: 32_768 }
    })).toThrow();
    expect(() => recoveryPacketV2Schema.parse({
      ...recoveryPacketV2,
      ciphertext: fixedBase64Url(80)
    })).toThrow();
  });

  it("builds the cross-language recovery-v2 transcript fixture exactly", () => {
    const input = {
      recoveryAttemptId: "11111111-1111-4111-8111-111111111111",
      challenge: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
      email: "alice@example.com",
      registrationSessionId: "22222222-2222-4222-8222-222222222222",
      registrationRecord: "3q2-7w",
      newEncryptedRecoveryPacket: {
        ...recoveryPacketV2,
        ciphertext: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0BBQkNERUZHSElKS0xNTk9Q"
      },
      newRecoverySigningPublicKey: "oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8",
      device: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Pixel 9",
        fingerprint: "AB".repeat(32),
        publicKey: "wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t8",
        credential: "4OHi4-Tl5ufo6err7O3u7_Dx8vP09fb3-Pn6-_z9_v8",
        encryptedVaultKeyPacket: {
          version: 1 as const,
          recipientDeviceId: "33333333-3333-4333-8333-333333333333",
          recipientPublicKey: "wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t8",
          ephemeralPublicKey: "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8",
          encryptedVaultKey: {
            alg: "XCHACHA20_POLY1305" as const,
            nonce: "YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3",
            ciphertext: "gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp-goaKjpKWmp6ipqqusra6v"
          }
        }
      }
    };
    const { challenge, ...request } = input;
    expect(recoveryFinishRequestSchema.parse({
      ...request,
      signature: fixedBase64Url(64)
    })).toBeTruthy();
    const transcript = buildRecoveryFinishTranscript({
      ...request,
      challenge
    });
    expect(transcript).toHaveLength(821);
    expect(Buffer.from(transcript).toString("base64url")).toBe(
      "emVyby12YXVsdC9yZWNvdmVyeS1maW5pc2gvdjIAAAAAJDExMTExMTExLTExMTEtNDExMS04MTExLTExMTExMTExMTExMQAAACAAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHwAAABFhbGljZUBleGFtcGxlLmNvbQAAACQyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIAAAAE3q2-7wAAAAECAAAAElhDSEFDSEEyMF9QT0xZMTMwNQAAAAxBUkdPTjJJRF9WMTMAAAAQEBESExQVFhcYGRobHB0eHwAAAAQAAQAAAAAABAAAAAMAAAAEAAAABAAAABggISIjJCUmJygpKissLS4vMDEyMzQ1NjcAAABRAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0BBQkNERUZHSElKS0xNTk9QAAAAIKChoqOkpaanqKmqq6ytrq-wsbKztLW2t7i5uru8vb6_AAAAJDMzMzMzMzMzLTMzMzMtNDMzMy04MzMzLTMzMzMzMzMzMzMzMwAAAAdQaXhlbCA5AAAAQEFCQUJBQkFCQUJBQkFCQUJBQkFCQUJBQkFCQUJBQkFCQUJBQkFCQUJBQkFCQUJBQkFCQUJBQkFCQUJBQkFCQUIAAAAgwMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t8AAAAg4OHi4-Tl5ufo6err7O3u7_Dx8vP09fb3-Pn6-_z9_v8AAAABAQAAACQzMzMzMzMzMy0zMzMzLTQzMzMtODMzMy0zMzMzMzMzMzMzMzMAAAAgwMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t8AAAAgQEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8AAAASWENIQUNIQTIwX1BPTFkxMzA1AAAAGGBhYmNkZWZnaGlqa2xtbm9wcXJzdHV2dwAAADCAgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq8"
    );
  });

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
