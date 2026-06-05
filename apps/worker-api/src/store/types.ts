import type {
  CiphertextEnvelope,
  ItemLevelSyncConflict,
  ItemLevelSyncPlan,
  ItemLevelSyncPullResponse,
  SyncPullResponse,
  SyncPushRequest,
  TrustedDevice,
  VaultItemCiphertext
} from "@zero-vault/shared";

export type StoredUser = {
  id: string;
  email: string;
  opaqueRegistrationRecord: string;
  publicKeyBundle: string;
  encryptedRecoveryPacket: CiphertextEnvelope;
  serverRevision: number;
};

export type StoredSession = {
  id: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  expiresAt: Date;
};

export type RegistrationSession = {
  id: string;
  email: string;
  registrationResponse: string;
  expiresAt: Date;
};

export type LoginSession = {
  id: string;
  userId: string;
  serverLoginState: string;
  expiresAt: Date;
};

export type PushResult =
  | { ok: true; serverRevision: number }
  | { ok: false; error: "sync_conflict"; serverRevision: number };

export type ItemLevelSyncPushResult = {
  serverRevision: number;
  applied: { upsertedItemIds: string[]; deletedItemIds: string[] };
  conflicts: ItemLevelSyncConflict[];
};

export interface VaultStore {
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserById(userId: string): Promise<StoredUser | null>;
  createRegistrationSession(input: Omit<RegistrationSession, "id">): Promise<RegistrationSession>;
  consumeRegistrationSession(id: string): Promise<RegistrationSession | null>;
  createUser(input: {
    email: string;
    opaqueRegistrationRecord: string;
    publicKeyBundle: string;
    encryptedRecoveryPacket: CiphertextEnvelope;
  }): Promise<StoredUser>;
  createLoginSession(input: Omit<LoginSession, "id">): Promise<LoginSession>;
  consumeLoginSession(id: string): Promise<LoginSession | null>;
  createSession(input: Omit<StoredSession, "id">): Promise<StoredSession>;
  findSessionByTokenHash(tokenHash: string): Promise<(StoredSession & { user: StoredUser }) | null>;
  deleteSession(tokenHash: string): Promise<void>;
  cleanupExpiredSessions(now?: Date): Promise<{ sessions: number; loginSessions: number; registrationSessions: number }>;
  pullVault(userId: string): Promise<SyncPullResponse>;
  pushVault(userId: string, request: SyncPushRequest): Promise<PushResult>;
  getItemHistory(userId: string, itemId: string): Promise<VaultItemCiphertext[]>;
  pushItemLevelSync(userId: string, plan: ItemLevelSyncPlan): Promise<ItemLevelSyncPushResult>;
  pullItemLevelSync(userId: string): Promise<ItemLevelSyncPullResponse>;
  searchItemsByTokens(userId: string, tokenHexes: string[]): Promise<string[]>;
  saveRecoveryPacket(userId: string, packet: CiphertextEnvelope): Promise<void>;
  getRecoveryPacket(userId: string): Promise<CiphertextEnvelope | null>;
  rotateRecoveryPacket(userId: string, packet: CiphertextEnvelope): Promise<void>;
  registerDevice(userId: string, device: TrustedDevice): Promise<void>;
  listDevices(userId: string): Promise<TrustedDevice[]>;
  approveDevice(userId: string, deviceId: string): Promise<void>;
  rejectDevice(userId: string, deviceId: string): Promise<void>;
  revokeDevice(userId: string, deviceId: string): Promise<void>;
  saveDeviceVaultKey(userId: string, deviceId: string, encryptedBlob: string): Promise<void>;
  getDeviceVaultKey(userId: string, deviceId: string): Promise<string | null>;
  deleteUser(userId: string): Promise<void>;
}
