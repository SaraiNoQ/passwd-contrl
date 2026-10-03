import type {
  AppliedMutationReceipt,
  DeviceVaultKeyPacket,
  ItemLevelSyncConflict,
  ItemLevelSyncPlan,
  ItemLevelSyncPullResponse,
  RecoveryFinishUnsignedRequest,
  RecoveryPacketEnvelope,
  RecoveryPacketV2,
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
  encryptedRecoveryPacket: RecoveryPacketEnvelope | RecoveryPacketV2;
  serverRevision: number;
  authEpoch: number;
};

export type StoredSession = {
  id: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  deviceId: string | null;
  authEpoch: number;
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
  authEpoch: number;
  expiresAt: Date;
};

export type FakeLoginSession = {
  id: string;
  email: string;
  serverLoginState: string;
  expiresAt: Date;
};

export type RecoveryRecord = {
  protocolVersion: 1 | 2;
  encryptedRecoveryPacket: RecoveryPacketEnvelope | RecoveryPacketV2;
  signingPublicKey: string | null;
  generation: number;
};

export type RecoveryChallenge = {
  id: string;
  userId: string | null;
  authEpoch: number | null;
  recoveryGeneration: number | null;
  nonce: string;
  registrationSessionId: string;
  expiresAt: Date;
};

export type PushResult =
  | { ok: true; serverRevision: number }
  | { ok: false; error: "sync_conflict"; serverRevision: number };

export type ItemLevelSyncPushResult = {
  serverRevision: number;
  applied: {
    upsertedItemIds: string[];
    deletedItemIds: string[];
    mutationReceipts: AppliedMutationReceipt[];
  };
  conflicts: ItemLevelSyncConflict[];
};

export interface VaultStore {
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserById(userId: string): Promise<StoredUser | null>;
  createRegistrationSession(input: Omit<RegistrationSession, "id">): Promise<RegistrationSession>;
  getRegistrationSession(id: string): Promise<RegistrationSession | null>;
  consumeRegistrationSession(id: string): Promise<RegistrationSession | null>;
  createUser(input: {
    email: string;
    opaqueRegistrationRecord: string;
    publicKeyBundle: string;
    encryptedRecoveryPacket: RecoveryPacketEnvelope;
  }): Promise<StoredUser>;
  createMobileAccount(input: {
    email: string;
    opaqueRegistrationRecord: string;
    publicKeyBundle: string;
    encryptedRecoveryPacket: RecoveryPacketV2;
    recoverySigningPublicKey: string;
    device: TrustedDevice;
    deviceCredentialHash: string;
    encryptedVaultKeyPacket: DeviceVaultKeyPacket;
    session: { tokenHash: string; csrfToken: string; expiresAt: Date };
  }): Promise<{ user: StoredUser; session: StoredSession }>;
  createLoginSession(
    input: Omit<LoginSession, "id" | "authEpoch"> & { authEpoch?: number }
  ): Promise<LoginSession>;
  consumeLoginSession(id: string): Promise<LoginSession | null>;
  createFakeLoginSession(input: Omit<FakeLoginSession, "id">): Promise<FakeLoginSession>;
  consumeFakeLoginSession(id: string): Promise<FakeLoginSession | null>;
  createSession(
    input: Omit<StoredSession, "id" | "deviceId" | "authEpoch"> & {
      deviceId?: string | null;
      authEpoch?: number;
    }
  ): Promise<StoredSession>;
  rotateDeviceSession(
    input: Omit<StoredSession, "id" | "deviceId" | "authEpoch"> & {
      deviceId: string;
      authEpoch?: number;
    }
  ): Promise<StoredSession>;
  findSessionByTokenHash(tokenHash: string): Promise<(StoredSession & { user: StoredUser }) | null>;
  deleteSession(tokenHash: string): Promise<void>;
  cleanupExpiredSessions(now?: Date): Promise<{
    sessions: number;
    loginSessions: number;
    fakeLoginSessions: number;
    registrationSessions: number;
    recoveryChallenges: number;
  }>;
  pullVault(userId: string): Promise<SyncPullResponse>;
  pushVault(userId: string, request: SyncPushRequest): Promise<PushResult>;
  getItemHistory(userId: string, itemId: string): Promise<VaultItemCiphertext[]>;
  pushItemLevelSync(userId: string, plan: ItemLevelSyncPlan): Promise<ItemLevelSyncPushResult>;
  pullItemLevelSync(userId: string, cursor: number, limit?: number): Promise<ItemLevelSyncPullResponse>;
  getEncryptedItem(userId: string, itemId: string): Promise<VaultItemCiphertext | null>;
  searchItemsByTokens(userId: string, tokenHexes: string[]): Promise<string[]>;
  saveRecoveryPacket(userId: string, packet: RecoveryPacketEnvelope): Promise<void>;
  getRecoveryPacket(userId: string): Promise<RecoveryPacketEnvelope | null>;
  rotateRecoveryPacket(userId: string, packet: RecoveryPacketEnvelope): Promise<void>;
  findUserByRecoveryEmail(email: string): Promise<StoredUser | null>;
  getRecoveryRecord(userId: string): Promise<RecoveryRecord | null>;
  createRecoveryChallenge(input: Omit<RecoveryChallenge, "id">): Promise<RecoveryChallenge>;
  getRecoveryChallenge(id: string): Promise<RecoveryChallenge | null>;
  migrateRecoveryV1(
    userId: string,
    packet: RecoveryPacketV2,
    signingPublicKey: string
  ): Promise<void>;
  rotateRecoveryV2(
    user: StoredUser,
    expectedGeneration: number,
    packet: RecoveryPacketV2,
    signingPublicKey: string
  ): Promise<void>;
  finishRecoveryV2(input: {
    user: StoredUser;
    challenge: RecoveryChallenge;
    request: RecoveryFinishUnsignedRequest;
    deviceCredentialHash: string;
  }): Promise<void>;
  getDeviceOwnerUserId(deviceId: string): Promise<string | null>;
  registerDevice(
    userId: string,
    device: TrustedDevice,
    credentialHash?: string,
    expectedAuthEpoch?: number
  ): Promise<TrustedDevice>;
  authenticateDevice(input: {
    userId: string;
    deviceId: string;
    credentialHash: string;
    fingerprint: string;
    publicKey: string;
  }): Promise<TrustedDevice | null>;
  getDevice(userId: string, deviceId: string): Promise<TrustedDevice | null>;
  listDevices(userId: string): Promise<TrustedDevice[]>;
  approveDevice(userId: string, deviceId: string): Promise<void>;
  approveDeviceWithVaultKey(
    userId: string,
    deviceId: string,
    packet: DeviceVaultKeyPacket
  ): Promise<void>;
  rejectDevice(userId: string, deviceId: string): Promise<void>;
  revokeDevice(userId: string, deviceId: string): Promise<void>;
  saveDeviceVaultKey(userId: string, deviceId: string, packet: DeviceVaultKeyPacket): Promise<void>;
  getDeviceVaultKey(userId: string, deviceId: string): Promise<DeviceVaultKeyPacket | null>;
  deleteUser(userId: string): Promise<void>;
}
