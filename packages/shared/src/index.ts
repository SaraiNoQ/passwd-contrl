import { z } from "zod";

export const MAX_BASE64URL_CHARS = 699_052; // 512 KiB of decoded bytes.
export const MAX_CIPHERTEXT_BASE64URL_CHARS = 349_528; // 256 KiB decoded.
export const MAX_AAD_BASE64URL_CHARS = 10_924; // 8 KiB decoded.
export const MAX_ENCRYPTED_SEARCH_TOKENS = 128;
export const MAX_SYNC_MUTATIONS = 100;

export const base64UrlSchema = z.string()
  .max(MAX_BASE64URL_CHARS)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/u);

const decodedBase64UrlLength = (value: string): number => {
  const unpadded = value.replace(/=+$/u, "");
  const remainder = unpadded.length % 4;
  const padding = value.length - unpadded.length;
  if (
    remainder === 1 ||
    (padding > 0 && !(
      (remainder === 2 && padding === 2) ||
      (remainder === 3 && padding === 1)
    ))
  ) return -1;
  return Math.floor(unpadded.length * 6 / 8);
};
const decodedBytes = (bytes: number) => (value: string) => decodedBase64UrlLength(value) === bytes;
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const isCanonicalUnpaddedBase64Url = (value: string): boolean => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) return false;
  const last = BASE64URL_ALPHABET.indexOf(value.at(-1) ?? "");
  if (last < 0) return false;
  if (value.length % 4 === 2) return last % 16 === 0;
  if (value.length % 4 === 3) return last % 4 === 0;
  return true;
};

const canonicalBase64UrlBytesSchema = (bytes: number) => z.string()
  .length(Math.ceil(bytes * 8 / 6))
  .refine(isCanonicalUnpaddedBase64Url, "Must be canonical unpadded base64url")
  .refine(decodedBytes(bytes), `Must decode to exactly ${bytes} bytes`);

const canonicalOpaqueMessageSchema = z.string()
  .min(1)
  .max(Math.ceil(16_384 * 8 / 6))
  .refine(isCanonicalUnpaddedBase64Url, "Must be canonical unpadded base64url")
  .refine((value) => decodedBase64UrlLength(value) <= 16_384, "OPAQUE message is too large");

export const decodeCanonicalBase64Url = (value: string): Uint8Array => {
  if (!isCanonicalUnpaddedBase64Url(value)) throw new Error("invalid_canonical_base64url");
  const output = new Uint8Array(decodedBase64UrlLength(value));
  let accumulator = 0;
  let bits = 0;
  let offset = 0;
  for (const character of value) {
    accumulator = (accumulator << 6) | BASE64URL_ALPHABET.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[offset] = (accumulator >> bits) & 0xff;
      offset += 1;
      accumulator &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  return output;
};

export const encodeCanonicalBase64Url = (value: Uint8Array): string => {
  let output = "";
  for (let offset = 0; offset < value.length; offset += 3) {
    const first = value[offset] ?? 0;
    const second = value[offset + 1];
    const third = value[offset + 2];
    output += BASE64URL_ALPHABET.charAt(first >> 2);
    output += BASE64URL_ALPHABET.charAt(((first & 0x03) << 4) | ((second ?? 0) >> 4));
    if (second !== undefined) {
      output += BASE64URL_ALPHABET.charAt(((second & 0x0f) << 2) | ((third ?? 0) >> 6));
    }
    if (third !== undefined) output += BASE64URL_ALPHABET.charAt(third & 0x3f);
  }
  return output;
};
const aeadCiphertextSchema = base64UrlSchema
  .max(MAX_CIPHERTEXT_BASE64URL_CHARS)
  .refine((value) => decodedBase64UrlLength(value) >= 16, "AEAD ciphertext must include a 16-byte tag");
const aadSchema = base64UrlSchema.max(MAX_AAD_BASE64URL_CHARS).optional();

const xchacha20EnvelopeSchema = z.object({
  alg: z.literal("XCHACHA20_POLY1305"),
  nonce: base64UrlSchema.max(128).refine(decodedBytes(24), "XChaCha20 nonce must be 24 bytes"),
  ciphertext: aeadCiphertextSchema,
  aad: aadSchema
}).strict();
const aesGcmEnvelopeSchema = z.object({
  alg: z.literal("AES_256_GCM"),
  nonce: base64UrlSchema.max(128).refine(decodedBytes(12), "AES-GCM nonce must be 12 bytes"),
  ciphertext: aeadCiphertextSchema,
  aad: aadSchema
}).strict();
const hmacEnvelopeSchema = z.object({
  alg: z.literal("HMAC_SHA256"),
  // HMAC has no nonce. V1 uses the canonical one-byte zero placeholder so the
  // common envelope remains serializable across existing clients.
  nonce: z.literal("AA"),
  ciphertext: z.string().regex(/^[a-f0-9]{64}$/u),
  aad: z.never().optional()
}).strict();

// Device sharing is a fixed X25519 + XChaCha20-Poly1305 protocol. The
// plaintext vault key is exactly 32 bytes, therefore the encrypted payload is
// exactly 48 bytes including the Poly1305 tag. Keep this narrower than the
// general AEAD envelope so an accepted packet is always consumable by the
// Rust/Kotlin bridge (which intentionally supports no algorithm negotiation).
const deviceVaultKeyEnvelopeSchema = z.object({
  alg: z.literal("XCHACHA20_POLY1305"),
  nonce: base64UrlSchema.max(128).refine(decodedBytes(24), "XChaCha20 nonce must be 24 bytes"),
  ciphertext: base64UrlSchema
    .max(64)
    .refine(decodedBytes(48), "Encrypted vault key must be 48 bytes")
}).strict();

export const aeadCiphertextEnvelopeSchema = z.discriminatedUnion("alg", [
  xchacha20EnvelopeSchema,
  aesGcmEnvelopeSchema
]);
export const hmacSha256EnvelopeSchema = hmacEnvelopeSchema;

export const ciphertextEnvelopeSchema = z.discriminatedUnion("alg", [
  xchacha20EnvelopeSchema,
  aesGcmEnvelopeSchema,
  hmacEnvelopeSchema
]);

export type CiphertextEnvelope = z.infer<typeof ciphertextEnvelopeSchema>;

const kdfIterations = z.number().int().positive().max(10_000_000).optional();
export const recoveryPacketEnvelopeSchema = z.discriminatedUnion("alg", [
  xchacha20EnvelopeSchema.extend({ kdfIterations }),
  aesGcmEnvelopeSchema.extend({ kdfIterations })
]);

export type RecoveryPacketEnvelope = z.infer<typeof recoveryPacketEnvelopeSchema>;

export const recoveryPacketV2Schema = z.object({
  version: z.literal(2),
  alg: z.literal("XCHACHA20_POLY1305"),
  kdf: z.object({
    alg: z.literal("ARGON2ID_V13"),
    salt: canonicalBase64UrlBytesSchema(16),
    memoryKib: z.literal(65_536),
    iterations: z.literal(3),
    parallelism: z.literal(4)
  }).strict(),
  nonce: canonicalBase64UrlBytesSchema(24),
  ciphertext: canonicalBase64UrlBytesSchema(81)
}).strict();

export type RecoveryPacketV2 = z.infer<typeof recoveryPacketV2Schema>;
export const recoverySigningPublicKeySchema = canonicalBase64UrlBytesSchema(32);
export const recoveryChallengeSchema = canonicalBase64UrlBytesSchema(32);
export const recoveryFinishSignatureSchema = canonicalBase64UrlBytesSchema(64);

// Whole-vault sync predates the native item protocol and used envelope-shaped
// metadata in a few fields. Keep that compatibility boundary explicit; new
// item-sync, device packets and recovery packets use the strict schema above.
export const legacyCiphertextEnvelopeSchema = z.discriminatedUnion("alg", [
  z.object({
    alg: z.literal("XCHACHA20_POLY1305"),
    nonce: base64UrlSchema.max(128),
    ciphertext: base64UrlSchema.max(MAX_CIPHERTEXT_BASE64URL_CHARS),
    aad: aadSchema
  }).strict(),
  z.object({
    alg: z.literal("AES_256_GCM"),
    nonce: base64UrlSchema.max(128),
    ciphertext: base64UrlSchema.max(MAX_CIPHERTEXT_BASE64URL_CHARS),
    aad: aadSchema
  }).strict(),
  z.object({
    alg: z.literal("HMAC_SHA256"),
    nonce: base64UrlSchema.max(128),
    ciphertext: base64UrlSchema.max(MAX_CIPHERTEXT_BASE64URL_CHARS),
    aad: aadSchema
  }).strict()
]);

export const vaultItemCiphertextSchema = z.object({
  id: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  encryptedItemKey: aeadCiphertextEnvelopeSchema,
  encryptedPayload: aeadCiphertextEnvelopeSchema,
  encryptedSearchTokens: z.array(hmacSha256EnvelopeSchema).max(MAX_ENCRYPTED_SEARCH_TOKENS).default([])
}).strict();

export type VaultItemCiphertext = z.infer<typeof vaultItemCiphertextSchema>;

export const legacyVaultItemCiphertextSchema = vaultItemCiphertextSchema.extend({
  encryptedItemKey: legacyCiphertextEnvelopeSchema,
  encryptedPayload: legacyCiphertextEnvelopeSchema,
  encryptedSearchTokens: z.array(legacyCiphertextEnvelopeSchema).max(MAX_ENCRYPTED_SEARCH_TOKENS).default([])
}).strict();

export const mutationIdSchema = z.string().uuid();

export const itemLevelEncryptedUpsertSchema = vaultItemCiphertextSchema.extend({
  baseItemRevision: z.number().int().nonnegative(),
  clientMutationId: mutationIdSchema,
  ciphertextHash: base64UrlSchema.optional()
}).strict();

export type ItemLevelEncryptedUpsert = z.infer<typeof itemLevelEncryptedUpsertSchema>;

export const itemLevelEncryptedDeleteSchema = z.object({
  id: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  baseItemRevision: z.number().int().nonnegative(),
  deletedAt: z.string().datetime(),
  clientMutationId: mutationIdSchema
}).strict();

export type ItemLevelEncryptedDelete = z.infer<typeof itemLevelEncryptedDeleteSchema>;

export const itemLevelServerStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("missing") }).strict(),
  z.object({ kind: z.literal("item"), item: vaultItemCiphertextSchema }).strict(),
  z.object({
    kind: z.literal("deleted"),
    itemId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    deletedAt: z.string().datetime()
  }).strict()
]);

export type ItemLevelServerState = z.infer<typeof itemLevelServerStateSchema>;

export const itemLevelSyncConflictSchema = z.object({
  itemId: z.string().uuid(),
  operation: z.enum(["upsert", "delete"]),
  reason: z.enum([
    "invalid_server_revision",
    "item_revision_advanced",
    "item_revision_mismatch",
    "item_owner_mismatch",
    "mutation_id_reused"
  ]),
  clientBaseRevision: z.number().int().nonnegative(),
  serverRevision: z.number().int().nonnegative(),
  serverItemRevision: z.number().int().nonnegative().optional(),
  serverState: itemLevelServerStateSchema
}).strict();

export type ItemLevelSyncConflict = z.infer<typeof itemLevelSyncConflictSchema>;

export const itemLevelSyncPlanSchema = z.object({
  protocol: z.literal("item_level_v1"),
  baseRevision: z.number().int().nonnegative(),
  upserts: z.array(itemLevelEncryptedUpsertSchema).max(MAX_SYNC_MUTATIONS),
  deletes: z.array(itemLevelEncryptedDeleteSchema).max(MAX_SYNC_MUTATIONS)
}).strict().superRefine((plan, ctx) => {
  const itemIds = [...plan.upserts.map((item) => item.id), ...plan.deletes.map((item) => item.id)];
  if (itemIds.length > MAX_SYNC_MUTATIONS) {
    ctx.addIssue({ code: "custom", message: "too many item operations" });
  }
  if (new Set(itemIds).size !== itemIds.length) {
    ctx.addIssue({ code: "custom", message: "duplicate item operation" });
  }
  const mutationIds = [
    ...plan.upserts.map((item) => item.clientMutationId),
    ...plan.deletes.map((item) => item.clientMutationId)
  ];
  if (new Set(mutationIds).size !== mutationIds.length) {
    ctx.addIssue({ code: "custom", message: "duplicate client mutation id" });
  }
});

export type ItemLevelSyncPlan = z.infer<typeof itemLevelSyncPlanSchema>;

export const appliedMutationReceiptSchema = z.object({
  clientMutationId: mutationIdSchema,
  itemId: z.string().uuid(),
  operation: z.enum(["upsert", "delete"]),
  appliedItemRevision: z.number().int().positive()
}).strict();

export type AppliedMutationReceipt = z.infer<typeof appliedMutationReceiptSchema>;

const itemLevelAppliedSchema = z.object({
  upsertedItemIds: z.array(z.string().uuid()),
  deletedItemIds: z.array(z.string().uuid()),
  mutationReceipts: z.array(appliedMutationReceiptSchema)
}).strict();

export const itemLevelSyncResponseSchema = z.object({
  protocol: z.literal("item_level_v1"),
  serverRevision: z.number().int().nonnegative(),
  applied: itemLevelAppliedSchema,
  conflicts: z.array(itemLevelSyncConflictSchema).default([])
}).strict();

type StrictItemLevelSyncResponse = z.infer<typeof itemLevelSyncResponseSchema>;
export type ItemLevelSyncResponse = Omit<StrictItemLevelSyncResponse, "applied"> & {
  applied: Omit<StrictItemLevelSyncResponse["applied"], "mutationReceipts"> & {
    /** Required on the HTTP wire; optional here only for legacy in-process callers. */
    mutationReceipts?: AppliedMutationReceipt[];
  };
};

export const syncPullResponseSchema = z.object({
  serverRevision: z.number().int().nonnegative(),
  items: z.array(vaultItemCiphertextSchema),
  deletedItemIds: z.array(z.string().uuid())
}).strict();

export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;

export const syncPushRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  upserts: z.array(legacyVaultItemCiphertextSchema).max(MAX_SYNC_MUTATIONS),
  deletes: z.array(z.string().uuid()).max(MAX_SYNC_MUTATIONS)
}).strict().superRefine((request, ctx) => {
  if (request.upserts.length + request.deletes.length > MAX_SYNC_MUTATIONS) {
    ctx.addIssue({ code: "custom", message: "too many sync mutations" });
  }
});

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

export const x25519PublicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const deviceCredentialSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

export const mobileDeviceLoginSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(256),
  fingerprint: z.string().min(8).max(128),
  publicKey: x25519PublicKeySchema,
  credential: deviceCredentialSchema
}).strict();

export type MobileDeviceLogin = z.infer<typeof mobileDeviceLoginSchema>;

export const mobileLoginFinishRequestSchema = loginFinishRequestSchema.extend({
  device: mobileDeviceLoginSchema
}).strict();

export type MobileLoginFinishRequest = z.infer<typeof mobileLoginFinishRequestSchema>;

export const sessionUserResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    serverRevision: z.number().int().nonnegative()
  }),
  csrfToken: base64UrlSchema
});

export type SessionUserResponse = z.infer<typeof sessionUserResponseSchema>;

export const mobileSessionResponseSchema = sessionUserResponseSchema.extend({
  // Worker sessions are 32 random bytes encoded as unpadded base64url.
  sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  device: z.object({
    id: z.string().uuid(),
    status: z.enum(["pending", "approved"])
  }).strict()
}).strict();

export type MobileSessionResponse = z.infer<typeof mobileSessionResponseSchema>;

export const syncConflictResponseSchema = z.object({
  error: z.literal("sync_conflict"),
  serverRevision: z.number().int().nonnegative(),
  applied: itemLevelAppliedSchema,
  conflicts: z.array(itemLevelSyncConflictSchema).default([])
}).strict();

type StrictSyncConflictResponse = z.infer<typeof syncConflictResponseSchema>;
export type SyncConflictResponse = Omit<StrictSyncConflictResponse, "applied"> & {
  applied: Omit<StrictSyncConflictResponse["applied"], "mutationReceipts"> & {
    /** Required on the HTTP wire; optional here only for legacy in-process callers. */
    mutationReceipts?: AppliedMutationReceipt[];
  };
};

export const vaultItemHistoryResponseSchema = z.object({
  itemId: z.string().uuid(),
  versions: z.array(vaultItemCiphertextSchema)
}).strict();

export type VaultItemHistoryResponse = z.infer<typeof vaultItemHistoryResponseSchema>;

// ── Trusted Device ──────────────────────────────────────────────────────────

export const trustedDeviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(256),
  fingerprint: z.string().min(8).max(128).optional(),
  publicKey: x25519PublicKeySchema,
  status: z.enum(["pending", "approved", "rejected", "revoked"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastSeenIp: z.string().max(128).nullable().optional(),
  lastSeenLocation: z.string().max(256).nullable().optional()
}).strict();

export type TrustedDevice = z.infer<typeof trustedDeviceSchema>;

export const registerDeviceRequestSchema = z.object({
  name: z.string().min(1).max(256),
  fingerprint: z.string().min(8).max(128).optional(),
  publicKey: x25519PublicKeySchema
}).strict();

export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;

export const deviceListResponseSchema = z.object({
  devices: z.array(trustedDeviceSchema)
}).strict();

export type DeviceListResponse = z.infer<typeof deviceListResponseSchema>;

// ── Device Vault Key ─────────────────────────────────────────────────────────

export const deviceVaultKeyPacketSchema = z.object({
  version: z.literal(1),
  recipientDeviceId: z.string().uuid(),
  recipientPublicKey: x25519PublicKeySchema,
  ephemeralPublicKey: x25519PublicKeySchema,
  encryptedVaultKey: deviceVaultKeyEnvelopeSchema
}).strict();

export type DeviceVaultKeyPacket = z.infer<typeof deviceVaultKeyPacketSchema>;

export const deviceVaultKeyRequestSchema = z.object({
  encryptedVaultKeyPacket: deviceVaultKeyPacketSchema
}).strict();

export const deviceVaultKeyResponseSchema = z.object({
  encryptedVaultKeyPacket: deviceVaultKeyPacketSchema
}).strict();

export type DeviceVaultKeyResponse = z.infer<typeof deviceVaultKeyResponseSchema>;

export const mobileRegisterFinishRequestSchema = registerFinishRequestSchema
  .omit({ encryptedRecoveryPacket: true })
  .extend({
    encryptedRecoveryPacket: recoveryPacketV2Schema,
    recoverySigningPublicKey: recoverySigningPublicKeySchema,
    device: z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(256),
      fingerprint: z.string().min(8).max(128),
      publicKey: x25519PublicKeySchema,
      credential: deviceCredentialSchema,
      encryptedVaultKeyPacket: deviceVaultKeyPacketSchema
    }).strict()
  }).strict().superRefine((request, ctx) => {
    if (
      request.device.encryptedVaultKeyPacket.recipientDeviceId !== request.device.id ||
      request.device.encryptedVaultKeyPacket.recipientPublicKey !== request.device.publicKey
    ) {
      ctx.addIssue({ code: "custom", message: "vault key packet recipient does not match device" });
    }
  });

export type MobileRegisterFinishRequest = z.infer<typeof mobileRegisterFinishRequestSchema>;

// ── Vault Item Types ──────────────────────────────────────────────────────

export const vaultItemTypeSchema = z.enum(["login", "secure_note", "credit_card"]);
export type VaultItemType = z.infer<typeof vaultItemTypeSchema>;

export const customFieldSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().max(4096),
  fieldType: z.enum(["text", "hidden", "boolean"])
}).strict();
export type CustomField = z.infer<typeof customFieldSchema>;

export const androidAssociationSchema = z.object({
  packageName: z.string().min(3).max(255).regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u),
  signingCertificateSha256: z.string().regex(/^[A-Fa-f0-9]{64}$/u).transform((value) => value.toUpperCase())
}).strict();
export type AndroidAssociation = z.infer<typeof androidAssociationSchema>;

export const androidAssociationsSchema = z.array(androidAssociationSchema).max(32).refine(
  (items) => new Set(items.map((item) => `${item.packageName}:${item.signingCertificateSha256}`)).size === items.length,
  { message: "duplicate Android association" }
);

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
  totp: z.string().max(1024).optional(),
  androidAssociations: androidAssociationsSchema.optional()
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

export const recoveryPacketLookupRequestSchema = z.object({
  email: z.string().email()
}).strict();

export type RecoveryPacketLookupRequest = z.infer<typeof recoveryPacketLookupRequestSchema>;

// ── Recovery v2 authorization ──────────────────────────────────────────────

const normalizedRecoveryEmailSchema = z.string().trim().toLowerCase().email();

export const recoveryStartRequestSchema = z.object({
  email: normalizedRecoveryEmailSchema,
  registrationRequest: canonicalOpaqueMessageSchema
}).strict();

export type RecoveryStartRequest = z.infer<typeof recoveryStartRequestSchema>;

export const recoveryStartResponseSchema = z.object({
  recoveryAttemptId: z.string().uuid(),
  challenge: recoveryChallengeSchema,
  registrationSessionId: z.string().uuid(),
  registrationResponse: canonicalOpaqueMessageSchema,
  encryptedRecoveryPacket: recoveryPacketV2Schema,
  recoverySigningPublicKey: recoverySigningPublicKeySchema
}).strict();

export type RecoveryStartResponse = z.infer<typeof recoveryStartResponseSchema>;

const recoveryDeviceVaultKeyPacketSchema = deviceVaultKeyPacketSchema.extend({
  recipientPublicKey: canonicalBase64UrlBytesSchema(32),
  ephemeralPublicKey: canonicalBase64UrlBytesSchema(32)
}).strict();

export const recoveryFinishDeviceSchema = mobileDeviceLoginSchema.extend({
  publicKey: canonicalBase64UrlBytesSchema(32),
  credential: canonicalBase64UrlBytesSchema(32),
  encryptedVaultKeyPacket: recoveryDeviceVaultKeyPacketSchema
}).strict().superRefine((device, ctx) => {
  if (
    device.encryptedVaultKeyPacket.recipientDeviceId !== device.id ||
    device.encryptedVaultKeyPacket.recipientPublicKey !== device.publicKey
  ) {
    ctx.addIssue({ code: "custom", message: "vault key packet recipient does not match device" });
  }
});

export const recoveryFinishUnsignedRequestSchema = z.object({
  recoveryAttemptId: z.string().uuid(),
  email: normalizedRecoveryEmailSchema,
  registrationSessionId: z.string().uuid(),
  registrationRecord: canonicalOpaqueMessageSchema,
  newEncryptedRecoveryPacket: recoveryPacketV2Schema,
  newRecoverySigningPublicKey: recoverySigningPublicKeySchema,
  device: recoveryFinishDeviceSchema
}).strict();

export type RecoveryFinishUnsignedRequest = z.infer<typeof recoveryFinishUnsignedRequestSchema>;

export const recoveryFinishRequestSchema = recoveryFinishUnsignedRequestSchema.extend({
  signature: recoveryFinishSignatureSchema
}).strict();

export type RecoveryFinishRequest = z.infer<typeof recoveryFinishRequestSchema>;

export const recoveryFinishResponseSchema = z.object({ ok: z.literal(true) }).strict();
export type RecoveryFinishResponse = z.infer<typeof recoveryFinishResponseSchema>;

export const recoveryV2RotationRequestSchema = z.object({
  encryptedRecoveryPacket: recoveryPacketV2Schema,
  recoverySigningPublicKey: recoverySigningPublicKeySchema
}).strict();

export type RecoveryV2RotationRequest = z.infer<typeof recoveryV2RotationRequestSchema>;
// The authenticated v1 -> v2 migration uses the exact same new-material DTO,
// but is kept as an explicit compatibility name at the call site.
export const recoveryV1MigrationRequestSchema = recoveryV2RotationRequestSchema;
export type RecoveryV1MigrationRequest = RecoveryV2RotationRequest;

export const recoveryFinishTranscriptInputSchema = recoveryFinishUnsignedRequestSchema.extend({
  challenge: recoveryChallengeSchema
}).strict();

export type RecoveryFinishTranscriptInput = z.infer<typeof recoveryFinishTranscriptInputSchema>;

const RECOVERY_FINISH_TRANSCRIPT_PREFIX = new TextEncoder().encode(
  "zero-vault/recovery-finish/v2\0"
);
const MAX_RECOVERY_FINISH_TRANSCRIPT_BYTES = 65_536;

const u32be = (value: number): Uint8Array => {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
};

/**
 * Build the sole recovery-v2 signing representation shared by native clients
 * and the Worker. JSON serialization is deliberately never signed.
 */
export const buildRecoveryFinishTranscript = (
  input: RecoveryFinishTranscriptInput
): Uint8Array => {
  const parsed = recoveryFinishTranscriptInputSchema.parse(input);
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [RECOVERY_FINISH_TRANSCRIPT_PREFIX];
  let length = RECOVERY_FINISH_TRANSCRIPT_PREFIX.length;
  const append = (raw: Uint8Array): void => {
    const prefix = u32be(raw.length);
    chunks.push(prefix, raw);
    length += prefix.length + raw.length;
    if (length > MAX_RECOVERY_FINISH_TRANSCRIPT_BYTES) {
      throw new Error("recovery_finish_transcript_too_large");
    }
  };
  const appendText = (value: string): void => append(encoder.encode(value));
  const appendBase64 = (value: string): void => append(decodeCanonicalBase64Url(value));
  const appendU32 = (value: number): void => append(u32be(value));

  appendText(parsed.recoveryAttemptId);
  appendBase64(parsed.challenge);
  appendText(parsed.email);
  appendText(parsed.registrationSessionId);
  appendBase64(parsed.registrationRecord);

  const recovery = parsed.newEncryptedRecoveryPacket;
  append(Uint8Array.of(recovery.version));
  appendText(recovery.alg);
  appendText(recovery.kdf.alg);
  appendBase64(recovery.kdf.salt);
  appendU32(recovery.kdf.memoryKib);
  appendU32(recovery.kdf.iterations);
  appendU32(recovery.kdf.parallelism);
  appendBase64(recovery.nonce);
  appendBase64(recovery.ciphertext);
  appendBase64(parsed.newRecoverySigningPublicKey);

  const device = parsed.device;
  appendText(device.id);
  appendText(device.name);
  appendText(device.fingerprint);
  appendBase64(device.publicKey);
  appendBase64(device.credential);
  const packet = device.encryptedVaultKeyPacket;
  append(Uint8Array.of(packet.version));
  appendText(packet.recipientDeviceId);
  appendBase64(packet.recipientPublicKey);
  appendBase64(packet.ephemeralPublicKey);
  appendText(packet.encryptedVaultKey.alg);
  appendBase64(packet.encryptedVaultKey.nonce);
  appendBase64(packet.encryptedVaultKey.ciphertext);

  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};

// ── Item-Level Sync Pull ────────────────────────────────────────────────────

export const itemLevelSyncChangeSchema = z.discriminatedUnion("operation", [
  z.object({
    cursor: z.number().int().positive(),
    operation: z.literal("upsert"),
    item: vaultItemCiphertextSchema
  }).strict(),
  z.object({
    cursor: z.number().int().positive(),
    operation: z.literal("delete"),
    itemId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    deletedAt: z.string().datetime()
  }).strict()
]);

export type ItemLevelSyncChange = z.infer<typeof itemLevelSyncChangeSchema>;

export const itemLevelSyncPullResponseSchema = z.object({
  protocol: z.literal("item_level_v1"),
  serverRevision: z.number().int().nonnegative(),
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  changes: z.array(itemLevelSyncChangeSchema).max(500),
  items: z.array(vaultItemCiphertextSchema).max(500),
  deletedItemIds: z.array(z.string().uuid()).max(500),
  deletedItems: z.array(z.object({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    deletedAt: z.string().datetime()
  }).strict()).max(500)
}).strict();

export type ItemLevelSyncPullResponse = z.infer<typeof itemLevelSyncPullResponseSchema>;

export const itemLevelSyncCursorSchema = z.coerce.number().int().nonnegative();

export const encryptedItemUpsertRequestSchema = z.object({
  protocol: z.literal("item_level_v1"),
  baseRevision: z.number().int().nonnegative(),
  item: itemLevelEncryptedUpsertSchema
}).strict();

export const encryptedItemDeleteRequestSchema = z.object({
  protocol: z.literal("item_level_v1"),
  baseRevision: z.number().int().nonnegative(),
  deletion: itemLevelEncryptedDeleteSchema
}).strict();

// ── Encrypted Search ─────────────────────────────────────────────────────────

export const vaultSearchRequestSchema = z.object({
  tokens: z.array(z.string().min(1).max(256)).max(MAX_ENCRYPTED_SEARCH_TOKENS)
}).strict();

export type VaultSearchRequest = z.infer<typeof vaultSearchRequestSchema>;

export const vaultSearchResponseSchema = z.object({
  itemIds: z.array(z.string().uuid())
}).strict();

export type VaultSearchResponse = z.infer<typeof vaultSearchResponseSchema>;

// ── Encrypted cloud backups ─────────────────────────────────────────────────

export const cloudExportAlgorithmSchema = z.enum([
  "XCHACHA20_POLY1305",
  "ZERO_VAULT_ITEM_ENVELOPES_V1",
  "ZERO_VAULT_MOBILE_BACKUP_V2",
]);
export type CloudExportAlgorithm = z.infer<typeof cloudExportAlgorithmSchema>;

export const cloudExportMetadataSchema = z.object({
  id: z.string().uuid(),
  size: z.number().int().positive().max(50 * 1_048_576),
  algorithm: cloudExportAlgorithmSchema,
  createdAt: z.string().datetime(),
}).strict();
export type CloudExportMetadata = z.infer<typeof cloudExportMetadataSchema>;

export const cloudExportListResponseSchema = z.object({
  exports: z.array(cloudExportMetadataSchema).max(1_000),
}).strict();
export type CloudExportListResponse = z.infer<typeof cloudExportListResponseSchema>;
