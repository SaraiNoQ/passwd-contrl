import { z } from "zod";

export const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/u);

export const ciphertextEnvelopeSchema = z.object({
  alg: z.enum(["XCHACHA20_POLY1305", "AES_256_GCM", "HMAC_SHA256"]),
  nonce: base64UrlSchema,
  ciphertext: base64UrlSchema,
  aad: base64UrlSchema.optional()
}).strict();

export type CiphertextEnvelope = z.infer<typeof ciphertextEnvelopeSchema>;

export const recoveryPacketEnvelopeSchema = ciphertextEnvelopeSchema.extend({
  kdfIterations: z.number().int().positive().max(10_000_000).optional()
}).strict();

export type RecoveryPacketEnvelope = z.infer<typeof recoveryPacketEnvelopeSchema>;

export const vaultItemCiphertextSchema = z.object({
  id: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  encryptedItemKey: ciphertextEnvelopeSchema,
  encryptedPayload: ciphertextEnvelopeSchema,
  encryptedSearchTokens: z.array(ciphertextEnvelopeSchema).default([])
}).strict();

export type VaultItemCiphertext = z.infer<typeof vaultItemCiphertextSchema>;

export const itemLevelEncryptedUpsertSchema = vaultItemCiphertextSchema.extend({
  baseItemRevision: z.number().int().nonnegative().optional(),
  clientMutationId: z.string().uuid().optional(),
  ciphertextHash: base64UrlSchema.optional()
}).strict();

export type ItemLevelEncryptedUpsert = z.infer<typeof itemLevelEncryptedUpsertSchema>;

export const itemLevelEncryptedDeleteSchema = z.object({
  id: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  baseItemRevision: z.number().int().nonnegative().optional(),
  deletedAt: z.string().datetime(),
  clientMutationId: z.string().uuid().optional()
}).strict();

export type ItemLevelEncryptedDelete = z.infer<typeof itemLevelEncryptedDeleteSchema>;

export const itemLevelSyncConflictSchema = z.object({
  itemId: z.string().uuid(),
  operation: z.enum(["upsert", "delete"]),
  reason: z.enum(["server_revision_advanced", "item_revision_advanced", "item_owner_mismatch"]),
  clientBaseRevision: z.number().int().nonnegative(),
  serverRevision: z.number().int().nonnegative(),
  serverItemRevision: z.number().int().nonnegative().optional()
}).strict();

export type ItemLevelSyncConflict = z.infer<typeof itemLevelSyncConflictSchema>;

export const itemLevelSyncPlanSchema = z.object({
  protocol: z.literal("item_level_v1"),
  baseRevision: z.number().int().nonnegative(),
  upserts: z.array(itemLevelEncryptedUpsertSchema),
  deletes: z.array(itemLevelEncryptedDeleteSchema)
}).strict();

export type ItemLevelSyncPlan = z.infer<typeof itemLevelSyncPlanSchema>;

export const itemLevelSyncResponseSchema = z.object({
  protocol: z.literal("item_level_v1"),
  serverRevision: z.number().int().nonnegative(),
  applied: z.object({
    upsertedItemIds: z.array(z.string().uuid()),
    deletedItemIds: z.array(z.string().uuid())
  }).strict(),
  conflicts: z.array(itemLevelSyncConflictSchema).default([])
}).strict();

export type ItemLevelSyncResponse = z.infer<typeof itemLevelSyncResponseSchema>;

export const syncPullResponseSchema = z.object({
  serverRevision: z.number().int().nonnegative(),
  items: z.array(vaultItemCiphertextSchema),
  deletedItemIds: z.array(z.string().uuid())
}).strict();

export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;

export const syncPushRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  upserts: z.array(vaultItemCiphertextSchema),
  deletes: z.array(z.string().uuid())
}).strict();

export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

export const importLoginRowSchema = z.object({
  origin: z.string().url(),
  username: z.string().max(1024),
  password: z.string().min(1),
  title: z.string().max(2048).optional(),
  notes: z.string().max(8192).optional()
});

export type ImportLoginRow = z.infer<typeof importLoginRowSchema>;

export const registerRequestSchema = z.object({
  email: z.string().email(),
  opaqueRegistrationRecord: base64UrlSchema,
  publicKeyBundle: base64UrlSchema,
  encryptedRecoveryPacket: recoveryPacketEnvelopeSchema
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const registerStartRequestSchema = z.object({
  email: z.string().email(),
  registrationRequest: base64UrlSchema
});

export type RegisterStartRequest = z.infer<typeof registerStartRequestSchema>;

export const registerStartResponseSchema = z.object({
  registrationSessionId: z.string().uuid(),
  registrationResponse: base64UrlSchema
});

export type RegisterStartResponse = z.infer<typeof registerStartResponseSchema>;

export const registerFinishRequestSchema = z.object({
  registrationSessionId: z.string().uuid(),
  email: z.string().email(),
  registrationRecord: base64UrlSchema,
  publicKeyBundle: base64UrlSchema,
  encryptedRecoveryPacket: recoveryPacketEnvelopeSchema
});

export type RegisterFinishRequest = z.infer<typeof registerFinishRequestSchema>;

export const loginStartRequestSchema = z.object({
  email: z.string().email(),
  startLoginRequest: base64UrlSchema
});

export type LoginStartRequest = z.infer<typeof loginStartRequestSchema>;

export const loginStartResponseSchema = z.object({
  loginSessionId: z.string().uuid(),
  loginResponse: base64UrlSchema
});

export type LoginStartResponse = z.infer<typeof loginStartResponseSchema>;

export const loginFinishRequestSchema = z.object({
  loginSessionId: z.string().uuid(),
  finishLoginRequest: base64UrlSchema
});

export type LoginFinishRequest = z.infer<typeof loginFinishRequestSchema>;

export const sessionUserResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    serverRevision: z.number().int().nonnegative()
  }),
  csrfToken: base64UrlSchema
});

export type SessionUserResponse = z.infer<typeof sessionUserResponseSchema>;

export const syncConflictResponseSchema = z.object({
  error: z.literal("sync_conflict"),
  serverRevision: z.number().int().nonnegative(),
  conflicts: z.array(itemLevelSyncConflictSchema).default([])
}).strict();

export type SyncConflictResponse = z.infer<typeof syncConflictResponseSchema>;

export const vaultItemHistoryResponseSchema = z.object({
  itemId: z.string().uuid(),
  versions: z.array(vaultItemCiphertextSchema)
}).strict();

export type VaultItemHistoryResponse = z.infer<typeof vaultItemHistoryResponseSchema>;

// ── Trusted Device ──────────────────────────────────────────────────────────

export const trustedDeviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(256),
  publicKey: base64UrlSchema,
  status: z.enum(["pending", "approved", "rejected", "revoked"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

export type TrustedDevice = z.infer<typeof trustedDeviceSchema>;

export const registerDeviceRequestSchema = z.object({
  name: z.string().min(1).max(256),
  publicKey: base64UrlSchema
}).strict();

export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;

export const deviceListResponseSchema = z.object({
  devices: z.array(trustedDeviceSchema)
}).strict();

export type DeviceListResponse = z.infer<typeof deviceListResponseSchema>;

// ── Device Vault Key ─────────────────────────────────────────────────────────

export const deviceVaultKeyResponseSchema = z.object({
  encryptedVaultKey: base64UrlSchema
}).strict();

export type DeviceVaultKeyResponse = z.infer<typeof deviceVaultKeyResponseSchema>;

// ── Vault Item Types ──────────────────────────────────────────────────────

export const vaultItemTypeSchema = z.enum(["login", "secure_note", "credit_card"]);
export type VaultItemType = z.infer<typeof vaultItemTypeSchema>;

export const customFieldSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().max(4096),
  fieldType: z.enum(["text", "hidden", "boolean"])
}).strict();
export type CustomField = z.infer<typeof customFieldSchema>;

export const vaultItemBaseSchema = z.object({
  id: z.string().uuid(),
  type: vaultItemTypeSchema,
  title: z.string().max(2048),
  folder: z.string().max(256).default(""),
  notes: z.string().max(16384).default(""),
  customFields: z.array(customFieldSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

export const vaultLoginSchema = vaultItemBaseSchema.extend({
  type: z.literal("login"),
  origin: z.string().max(4096).default(""),
  username: z.string().max(1024).default(""),
  password: z.string().max(4096).default(""),
  totp: z.string().max(1024).optional()
}).strict();
export type VaultLogin = z.infer<typeof vaultLoginSchema>;

export const vaultSecureNoteSchema = vaultItemBaseSchema.extend({
  type: z.literal("secure_note"),
  noteBody: z.string().max(65536).default("")
}).strict();
export type VaultSecureNote = z.infer<typeof vaultSecureNoteSchema>;

export const vaultCreditCardSchema = vaultItemBaseSchema.extend({
  type: z.literal("credit_card"),
  cardholderName: z.string().max(256).default(""),
  cardNumber: z.string().max(32).default(""),
  expirationMonth: z.string().max(2).default(""),
  expirationYear: z.string().max(4).default(""),
  cvv: z.string().max(8).default(""),
  brand: z.string().max(32).default("")
}).strict();
export type VaultCreditCard = z.infer<typeof vaultCreditCardSchema>;

export const totpUriSchema = z.string().refine(
  (val) => {
    if (val.startsWith("otpauth://")) {
      try { new URL(val); return val.includes("secret="); } catch { return false; }
    }
    // Raw base32 secret — minimum 16 chars (80 bits)
    return /^[A-Za-z2-7]{16,}$/u.test(val.replace(/[\s=-]/g, ""));
  },
  { message: "无效的 TOTP 密钥（需要 otpauth:// URI 或 base32 编码密钥）" }
);

export const vaultItemSchema = z.discriminatedUnion("type", [
  vaultLoginSchema,
  vaultSecureNoteSchema,
  vaultCreditCardSchema
]);
export type VaultItem = z.infer<typeof vaultItemSchema>;

// ── Recovery Packet ─────────────────────────────────────────────────────────

export const recoveryPacketRequestSchema = z.object({
  encryptedRecoveryPacket: recoveryPacketEnvelopeSchema
}).strict();

export type RecoveryPacketRequest = z.infer<typeof recoveryPacketRequestSchema>;

export const recoveryPacketResponseSchema = z.object({
  encryptedRecoveryPacket: recoveryPacketEnvelopeSchema
}).strict();

export type RecoveryPacketResponse = z.infer<typeof recoveryPacketResponseSchema>;

// ── Item-Level Sync Pull ────────────────────────────────────────────────────

export const itemLevelSyncPullResponseSchema = z.object({
  serverRevision: z.number().int().nonnegative(),
  items: z.array(vaultItemCiphertextSchema),
  deletedItemIds: z.array(z.string().uuid())
}).strict();

export type ItemLevelSyncPullResponse = z.infer<typeof itemLevelSyncPullResponseSchema>;

// ── Encrypted Search ─────────────────────────────────────────────────────────

export const vaultSearchRequestSchema = z.object({
  tokens: z.array(z.string().min(1).max(256))
}).strict();

export type VaultSearchRequest = z.infer<typeof vaultSearchRequestSchema>;

export const vaultSearchResponseSchema = z.object({
  itemIds: z.array(z.string().uuid())
}).strict();

export type VaultSearchResponse = z.infer<typeof vaultSearchResponseSchema>;
