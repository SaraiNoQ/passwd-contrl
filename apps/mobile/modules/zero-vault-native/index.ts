import { requireOptionalNativeModule } from "expo";

export type NativeStatus = {
  available: boolean;
  code: "READY" | "NATIVE_UNAVAILABLE" | "OPAQUE_INTEROP_UNVERIFIED";
  room: boolean;
  keystore: boolean;
  rustCrypto: boolean;
  opaqueInteropVerified: boolean;
  protocolVersion: number;
};

export type NativeAutofillConfiguration = {
  availability: "READY" | "LOCKED_BIOMETRIC" | "UNAVAILABLE";
  autofillSupported: boolean;
  autofillEnabled: boolean;
  credentialProviderSupported: boolean;
  credentialProviderEnabled: boolean;
};

export type NativeInstalledApp = Readonly<{
  label: string;
  packageName: string;
  signingCertificateSha256: string;
}>;

export type LocalDeviceUnlockState =
  | "PASSWORD_ALLOWED"
  | "DEVICE_KEY_INVALIDATED"
  | "BIOMETRIC_READY"
  | "BIOMETRIC_UNAVAILABLE"
  | "BIOMETRIC_INVALIDATED";

export type LocalDeviceSecurityState = {
  fingerprint: string;
  unlockState: LocalDeviceUnlockState;
};

export type NativeStoredCiphertext = {
  itemId: string;
  ciphertextEnvelopeJson: string;
  itemRevision: number;
  lastSyncedAt: string;
  hasConflict: boolean;
  itemType?: "login" | "secure_note" | "credit_card" | null;
  isDeleted?: boolean;
};

export type NativeSyncMetadata = {
  serverRevision: number;
  lastSyncedAt: string | null;
  serverCursor?: number | null;
};

export type NativePendingMutation = {
  clientMutationId: string;
  itemId: string;
  operation: "upsert" | "delete";
  baseItemRevision: number;
  ciphertextEnvelopeJson: string | null;
  createdAt: string;
  attemptCount: number;
  lastErrorCode: string | null;
};

export type NativeMutationAcknowledgement = {
  clientMutationId: string;
  appliedItemRevision: number;
};

export type NativeDeletedItem = {
  id: string;
  revision: number;
  deletedAt: string;
};

export type NativeSyncConflict = {
  itemId: string;
  reason:
    | "invalid_server_revision"
    | "item_revision_advanced"
    | "item_revision_mismatch"
    | "item_owner_mismatch"
    | "mutation_id_reused";
  localCiphertextEnvelopeJson: string | null;
  remoteCiphertextEnvelopeJson: string | null;
  serverRevision: number;
  serverItemRevision: number | null;
  status: "UNRESOLVED" | "SKIPPED";
  createdAt: string;
};

export type NativeBackupKind = "android" | "crypto-core";
export type NativeEncryptedBackupExportResult = {
  saved: boolean;
  backupId: string | null;
  createdAt: string | null;
};
export type NativeStagedBackupDocument =
  | { status: "cancelled"; kind: NativeBackupKind }
  | {
      status: "ready";
      operationId: string;
      kind: NativeBackupKind;
      accountId?: string | null;
      backupId?: string | null;
      createdAt?: string | null;
    };

export type PreparedDevice = { deviceId: string; credential: string; publicKey: string; fingerprint: string };
export type BoundDevice = Omit<PreparedDevice, "credential">;
export type NativeDeviceLoginMaterial = {
  accountId: string | null;
  deviceId: string;
  credential: string;
  publicKey: string;
  fingerprint: string;
};
export type NativeDeviceVaultKeyPacket = {
  version: 1;
  recipientDeviceId: string;
  recipientPublicKey: string;
  ephemeralPublicKey: string;
  encryptedVaultKey: {
    alg: "XCHACHA20_POLY1305";
    nonce: string;
    ciphertext: string;
  };
};
export type NativeRecoveryPacketV2 = {
  version: 2;
  alg: "XCHACHA20_POLY1305";
  kdf: {
    alg: "ARGON2ID_V13";
    salt: string;
    memoryKib: 65536;
    iterations: 3;
    parallelism: 4;
  };
  nonce: string;
  ciphertext: string;
};
export type InitialVaultBootstrap = {
  sessionHandle: string;
  encryptedVaultKeyPacket: NativeDeviceVaultKeyPacket;
  recoveryCode: string;
  recoveryPacketJson: string;
  recoverySigningPublicKey: string;
};
export type NativeRecoveryV2Open = {
  sessionHandle: string;
  recoveryProofHandle: string;
  signingPublicKey: string;
};
export type NativeRecoveryV2Rotation = {
  recoveryCode: string;
  recoveryPacket: NativeRecoveryPacketV2;
  signingPublicKey: string;
};
export type NativeEncryptedItem = {
  encryptedItemKeyJson: string;
  encryptedPayloadJson: string;
};
export type NativeTotp = { code: string; validForSeconds: number };

type ZeroVaultNativeBridge = {
  getStatus(): NativeStatus;
  getAutofillConfiguration(): NativeAutofillConfiguration;
  openAutofillSettings(): Promise<boolean>;
  openCredentialProviderSettings(): Promise<boolean>;
  listInstalledApps(): Promise<unknown>;
  generateUuid(): string;
  copySensitive(value: string, ttlMs: number): void;
  createEncryptedBackup(accountId: string, backupId: string): Promise<string>;
  saveEncryptedBackupDocument(suggestedName: string, json: string): Promise<boolean>;
  restoreEncryptedBackup(accountId: string, backupId: string, snapshotJson: string): Promise<void>;
  importCryptoCoreBackup(
    accountId: string,
    backupJson: string,
    password: string,
  ): Promise<{ importedCount: number }>;
  exportEncryptedBackupDocument(accountId: string): Promise<unknown>;
  stageBackupDocument(kind: NativeBackupKind): Promise<unknown>;
  restoreStagedEncryptedBackup(accountId: string, operationId: string): Promise<void>;
  importStagedCryptoCoreBackup(
    accountId: string,
    operationId: string,
    password: string,
  ): Promise<{ importedCount: number }>;
  discardStagedBackup(operationId: string): Promise<void>;
  opaqueStartLogin(email: string, password: string): Promise<{ startLoginRequest: string }>;
  opaqueFinishLogin(email: string, loginResponse: string): Promise<{ finishLoginRequest: string }>;
  opaqueCancelLogin(): void;
  opaqueStartRegistration(email: string, password: string): Promise<{ registrationRequest: string }>;
  opaqueFinishRegistration(
    email: string,
    registrationResponse: string,
  ): Promise<{ registrationRecord: string; serverStaticPublicKey: string }>;
  opaqueCancelRegistration(): void;
  prepareDevice(email: string): Promise<PreparedDevice>;
  getRecoveryContinuationDevice(email: string): Promise<PreparedDevice | null>;
  abandonRecoveryContinuation(email: string, deviceId: string): Promise<void>;
  bindDevice(
    email: string,
    accountId: string,
    deviceId: string,
  ): Promise<BoundDevice>;
  prepareDeviceLogin(email: string): Promise<NativeDeviceLoginMaterial>;
  completeDeviceLogin(email: string, accountId: string): Promise<void>;
  resetDeviceLogin(email: string): Promise<void>;
  bootstrapInitialVault(email: string): Promise<{
    sessionHandle: string;
    encryptedVaultKeyPacketJson: string;
    recoveryCode: string;
    recoveryPacketJson: string;
    recoverySigningPublicKey: string;
  }>;
  getPendingRecovery(email: string): Promise<{
    recoveryCode: string;
    recoveryPacketJson: string;
    recoverySigningPublicKey: string;
  } | null>;
  getBoundPendingRecovery(email: string): Promise<{
    recoveryCode: string;
    recoveryPacketJson: string;
    recoverySigningPublicKey: string;
  } | null>;
  acknowledgePendingRecovery(email: string): Promise<void>;
  installEncryptedVaultKey(accountId: string, packetJson: string): Promise<void>;
  hasVaultKey(accountId: string): Promise<boolean>;
  getLocalDeviceSecurityState(accountId: string): Promise<LocalDeviceSecurityState>;
  unlockWithDevice(accountId: string): Promise<string>;
  enableBiometric(accountId: string): Promise<void>;
  unlockWithBiometric(accountId: string): Promise<string>;
  shareVaultKey(
    sessionHandle: string,
    recipientDeviceId: string,
    recipientPublicKey: string,
  ): Promise<string>;
  openSession(accountId: string): Promise<string>;
  closeSession(sessionHandle: string): Promise<void>;
  lockAll(): void;
  encryptItem(sessionHandle: string, itemJson: string, itemId: string): Promise<NativeEncryptedItem>;
  decryptItem(
    sessionHandle: string,
    encryptedItemKeyJson: string,
    encryptedPayloadJson: string,
    itemId: string,
  ): Promise<string>;
  generateRecoveryPacket(sessionHandle: string, recoveryCode: string): Promise<string>;
  restoreRecoveryPacket(accountId: string, recoveryCode: string, recoveryPacketJson: string): Promise<string>;
  openRecoveryV2(
    recoveryCode: string,
    recoveryPacketJson: string,
  ): Promise<NativeRecoveryV2Open>;
  prepareRecoveryRotation(email: string, sessionHandle: string): Promise<{
    recoveryCode: string;
    recoveryPacketJson: string;
    signingPublicKey: string;
  }>;
  signRecoveryFinish(recoveryProofHandle: string, transcriptBase64Url: string): Promise<string>;
  cancelRecovery(recoveryProofHandle: string, sessionHandle: string): Promise<void>;
  generatePassword(
    length: number,
    includeUpper: boolean,
    includeLower: boolean,
    includeDigits: boolean,
    includeSymbols: boolean,
  ): string;
  generateTotp(secretOrUri: string, timestampSeconds: number): NativeTotp;
  listCiphertexts(accountId: string): Promise<NativeStoredCiphertext[]>;
  getCiphertext(accountId: string, itemId: string): Promise<NativeStoredCiphertext | null>;
  upsertCiphertext(
    accountId: string,
    itemId: string,
    ciphertextEnvelopeJson: string,
    itemRevision: number,
    lastSyncedAt: string,
    hasConflict: boolean,
  ): Promise<void>;
  deleteCiphertext(accountId: string, itemId: string): Promise<void>;
  getSyncMetadata(accountId: string): Promise<NativeSyncMetadata>;
  setSyncMetadata(
    accountId: string,
    serverRevision: number,
    lastSyncedAt: string | null,
    serverCursor: number | null,
  ): Promise<void>;
  setConflictIds(accountId: string, itemIds: string[]): Promise<void>;
  clearCiphertexts(accountId: string): Promise<void>;
  upsertLocalCiphertextAndEnqueue(
    accountId: string,
    itemId: string,
    ciphertextEnvelopeJson: string,
    itemRevision: number,
    lastSyncedAt: string,
    baseItemRevision: number | null,
    clientMutationId: string,
  ): Promise<void>;
  deleteLocalAndEnqueue(
    accountId: string,
    itemId: string,
    baseItemRevision: number | null,
    clientMutationId: string,
    createdAt: string,
  ): Promise<void>;
  listPendingMutations(accountId: string): Promise<NativePendingMutation[]>;
  ackMutations(
    accountId: string,
    acknowledgementsJson: string,
    serverRevision: number,
    timestamp: string,
  ): Promise<void>;
  applyPull(
    accountId: string,
    itemsJson: string,
    deletedItemsJson: string,
    serverRevision: number,
    cursor: number,
    timestamp: string,
  ): Promise<void>;
  saveConflicts(accountId: string, conflictsJson: string): Promise<void>;
  listConflicts(accountId: string): Promise<NativeSyncConflict[]>;
  resolveConflict(
    accountId: string,
    itemId: string,
    resolution: "keep_local" | "accept_remote" | "create_copy" | "skip",
    replacementJson: string | null,
    clientMutationId: string | null,
  ): Promise<void>;
};

const nativeBridge = requireOptionalNativeModule<ZeroVaultNativeBridge>("ZeroVaultNative");

export class ZeroVaultNativeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ZeroVaultNativeError";
  }
}

export function getNativeStatus(): NativeStatus {
  return nativeBridge?.getStatus() ?? {
    available: false,
    code: "NATIVE_UNAVAILABLE",
    room: false,
    keystore: false,
    rustCrypto: false,
    opaqueInteropVerified: false,
    protocolVersion: 0,
  };
}

export function getNativeAutofillConfiguration(): NativeAutofillConfiguration {
  return nativeBridge?.getAutofillConfiguration() ?? {
    availability: "UNAVAILABLE",
    autofillSupported: false,
    autofillEnabled: false,
    credentialProviderSupported: false,
    credentialProviderEnabled: false,
  };
}

export const openNativeAutofillSettings = (): Promise<boolean> =>
  bridge().openAutofillSettings();

export const openNativeCredentialProviderSettings = (): Promise<boolean> =>
  bridge().openCredentialProviderSettings();

export async function listNativeInstalledApps(): Promise<NativeInstalledApp[]> {
  const value = await bridge().listInstalledApps();
  if (!Array.isArray(value) || value.length > 10_000) {
    throw invalidInstalledAppsResponse();
  }

  const seenPackages = new Set<string>();
  return value.map((entry) => {
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      throw invalidInstalledAppsResponse();
    }
    const record = entry as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.length !== 3 ||
      !keys.every((key) =>
        key === "label" || key === "packageName" || key === "signingCertificateSha256")
    ) {
      throw invalidInstalledAppsResponse();
    }

    const { label, packageName, signingCertificateSha256 } = record;
    if (
      typeof label !== "string" ||
      label.length < 1 ||
      label.length > 512 ||
      label.trim() !== label ||
      /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u.test(label) ||
      typeof packageName !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_.]{1,254}$/u.test(packageName) ||
      seenPackages.has(packageName) ||
      typeof signingCertificateSha256 !== "string" ||
      !/^[0-9A-F]{64}$/u.test(signingCertificateSha256)
    ) {
      throw invalidInstalledAppsResponse();
    }
    seenPackages.add(packageName);
    return { label, packageName, signingCertificateSha256 };
  });
}

export function generateNativeUuid(): string {
  return bridge().generateUuid();
}

export async function copySensitiveToClipboard(value: string, ttlMs = 30_000): Promise<void> {
  if (!value || value.length > 65_536 || !Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 60_000) {
    throw new ZeroVaultNativeError("INVALID_ARGUMENT", "Sensitive clipboard request is invalid");
  }
  bridge().copySensitive(value, ttlMs);
}

export const createNativeEncryptedBackup = (accountId: string, backupId: string): Promise<string> =>
  bridgeFor(accountId).createEncryptedBackup(accountId, backupId);

export const saveNativeEncryptedBackupDocument = (
  suggestedName: string,
  json: string,
): Promise<boolean> => {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.json$/u.test(suggestedName) ||
    !json ||
    new TextEncoder().encode(json).byteLength > 52 * 1_048_576
  ) {
    throw new ZeroVaultNativeError("INVALID_ARGUMENT", "Encrypted backup document is invalid");
  }
  return bridge().saveEncryptedBackupDocument(suggestedName, json);
};

export const restoreNativeEncryptedBackup = (accountId: string, backupId: string, snapshotJson: string): Promise<void> => {
  if (!snapshotJson || new TextEncoder().encode(snapshotJson).byteLength > 50 * 1_048_576) {
    throw new ZeroVaultNativeError("INVALID_ARGUMENT", "Encrypted backup is empty or too large");
  }
  return bridgeFor(accountId).restoreEncryptedBackup(accountId, backupId, snapshotJson);
};

/** Imports only crypto-core-wasm Web backups; decrypted items never cross into JavaScript. */
export const importNativeCryptoCoreBackup = (
  accountId: string,
  backupJson: string,
  password: string,
): Promise<{ importedCount: number }> => {
  if (
    !backupJson ||
    new TextEncoder().encode(backupJson).byteLength > 8 * 1_048_576 ||
    !password ||
    password.length > 1024
  ) {
    throw new ZeroVaultNativeError("INVALID_ARGUMENT", "Encrypted backup input is invalid");
  }
  return bridgeFor(accountId).importCryptoCoreBackup(accountId, backupJson, password);
};

export async function exportNativeEncryptedBackupDocument(
  accountId: string,
): Promise<NativeEncryptedBackupExportResult> {
  const result = await bridgeFor(accountId).exportEncryptedBackupDocument(accountId);
  if (!isNativeRecord(result) || typeof result.saved !== "boolean") {
    throw invalidNativeBackupResponse();
  }
  return {
    saved: result.saved,
    backupId: optionalNativeString(result.backupId),
    createdAt: optionalNativeString(result.createdAt),
  };
}

export async function stageNativeBackupDocument(
  kind: NativeBackupKind,
): Promise<NativeStagedBackupDocument> {
  if (kind !== "android" && kind !== "crypto-core") {
    throw new ZeroVaultNativeError("INVALID_ARGUMENT", "Backup kind is invalid");
  }
  const result = await bridge().stageBackupDocument(kind);
  if (!isNativeRecord(result) || result.kind !== kind) throw invalidNativeBackupResponse();
  if (result.status === "cancelled") return { status: "cancelled", kind };
  if (
    result.status !== "ready" ||
    typeof result.operationId !== "string" ||
    !result.operationId.trim() ||
    result.operationId.trim() !== result.operationId ||
    result.operationId.length > 256
  ) {
    throw invalidNativeBackupResponse();
  }
  return {
    status: "ready",
    operationId: result.operationId,
    kind,
    accountId: optionalNativeString(result.accountId),
    backupId: optionalNativeString(result.backupId),
    createdAt: optionalNativeString(result.createdAt),
  };
}

export const restoreNativeStagedEncryptedBackup = (
  accountId: string,
  operationId: string,
): Promise<void> => {
  requireIdentifier(operationId, "Backup operation");
  return bridgeFor(accountId).restoreStagedEncryptedBackup(accountId, operationId);
};

export const importNativeStagedCryptoCoreBackup = async (
  accountId: string,
  operationId: string,
  password: string,
): Promise<{ importedCount: number }> => {
  requireIdentifier(operationId, "Backup operation");
  if (!password || password.length > 1024) {
    throw new ZeroVaultNativeError("INVALID_ARGUMENT", "Encrypted backup password is invalid");
  }
  const result = await bridgeFor(accountId).importStagedCryptoCoreBackup(
    accountId,
    operationId,
    password,
  );
  if (!Number.isSafeInteger(result.importedCount) || result.importedCount < 0) {
    throw invalidNativeBackupResponse();
  }
  return result;
};

export const discardNativeStagedBackup = (operationId: string): Promise<void> => {
  requireIdentifier(operationId, "Backup operation");
  return bridge().discardStagedBackup(operationId);
};

export const nativeOpaque = {
  startLogin(email: string, password: string) {
    requireEmailAndPassword(email, password);
    return bridge().opaqueStartLogin(email, password);
  },
  finishLogin(email: string, loginResponse: string) {
    requireIdentifier(loginResponse, "OPAQUE response");
    return bridge().opaqueFinishLogin(email, loginResponse);
  },
  cancelLogin() {
    nativeBridge?.opaqueCancelLogin();
  },
  startRegistration(email: string, password: string) {
    requireEmailAndPassword(email, password);
    return bridge().opaqueStartRegistration(email, password);
  },
  finishRegistration(email: string, registrationResponse: string) {
    requireIdentifier(registrationResponse, "OPAQUE response");
    return bridge().opaqueFinishRegistration(email, registrationResponse);
  },
  cancelRegistration() {
    nativeBridge?.opaqueCancelRegistration();
  },
};

export const prepareNativeDevice = (email: string): Promise<PreparedDevice> => {
  requireEmail(email);
  return bridge().prepareDevice(email);
};
export const getNativeRecoveryContinuationDevice = (
  email: string,
): Promise<PreparedDevice | null> => {
  requireEmail(email);
  return bridge().getRecoveryContinuationDevice(email);
};
export const abandonNativeRecoveryContinuation = (
  email: string,
  deviceId: string,
): Promise<void> => {
  requireEmail(email);
  requireIdentifier(deviceId, "Device identifier");
  return bridge().abandonRecoveryContinuation(email, deviceId);
};
export const bindNativeDevice = (
  email: string,
  accountId: string,
  deviceId: string,
): Promise<BoundDevice> => {
  requireEmail(email);
  requireIdentifier(accountId, "Account identifier");
  requireIdentifier(deviceId, "Device identifier");
  return bridge().bindDevice(email, accountId, deviceId);
};
export const prepareNativeDeviceLogin = (email: string): Promise<NativeDeviceLoginMaterial> => {
  requireEmail(email);
  return bridge().prepareDeviceLogin(email);
};
export const completeNativeDeviceLogin = (email: string, accountId: string): Promise<void> => {
  requireEmail(email);
  requireIdentifier(accountId, "Account identifier");
  return bridge().completeDeviceLogin(email, accountId);
};
export const resetNativeDeviceLogin = (email: string): Promise<void> => {
  requireEmail(email);
  return bridge().resetDeviceLogin(email);
};
export const bootstrapInitialVault = async (email: string): Promise<InitialVaultBootstrap> => {
  requireEmail(email);
  const result = await bridge().bootstrapInitialVault(email);
  return {
    sessionHandle: result.sessionHandle,
    encryptedVaultKeyPacket: JSON.parse(result.encryptedVaultKeyPacketJson) as NativeDeviceVaultKeyPacket,
    recoveryCode: result.recoveryCode,
    recoveryPacketJson: result.recoveryPacketJson,
    recoverySigningPublicKey: result.recoverySigningPublicKey,
  };
};
export const getPendingNativeRecovery = (email: string): Promise<{
  recoveryCode: string;
  recoveryPacketJson: string;
  recoverySigningPublicKey: string;
} | null> => {
  requireEmail(email);
  return bridge().getPendingRecovery(email);
};
export const getBoundPendingNativeRecovery = (email: string): Promise<{
  recoveryCode: string;
  recoveryPacketJson: string;
  recoverySigningPublicKey: string;
} | null> => {
  requireEmail(email);
  return bridge().getBoundPendingRecovery(email);
};
export const acknowledgePendingNativeRecovery = (email: string): Promise<void> => {
  requireEmail(email);
  return bridge().acknowledgePendingRecovery(email);
};
export const installEncryptedVaultKey = (
  accountId: string,
  packet: NativeDeviceVaultKeyPacket,
): Promise<void> => {
  requireIdentifier(accountId, "Account identifier");
  return bridge().installEncryptedVaultKey(accountId, JSON.stringify(packet));
};
export const hasInstalledVaultKey = (accountId: string): Promise<boolean> => {
  requireIdentifier(accountId, "Account identifier");
  return bridge().hasVaultKey(accountId);
};
export const getLocalDeviceSecurityState = async (
  accountId: string,
): Promise<LocalDeviceSecurityState> => {
  requireIdentifier(accountId, "Account identifier");
  const state = await bridge().getLocalDeviceSecurityState(accountId);
  if (
    !/^[a-f0-9]{64}$/u.test(state.fingerprint) ||
    ![
      "PASSWORD_ALLOWED",
      "DEVICE_KEY_INVALIDATED",
      "BIOMETRIC_READY",
      "BIOMETRIC_UNAVAILABLE",
      "BIOMETRIC_INVALIDATED",
    ].includes(state.unlockState)
  ) {
    throw new Error("invalid_native_device_security_state");
  }
  return state;
};
export const unlockVaultWithDevice = (accountId: string): Promise<string> => bridge().unlockWithDevice(accountId);
export const enableNativeBiometric = (accountId: string): Promise<void> => bridge().enableBiometric(accountId);
export const unlockVaultWithBiometric = (accountId: string): Promise<string> =>
  bridge().unlockWithBiometric(accountId);
export const shareNativeVaultKey = async (
  sessionHandle: string,
  recipientDeviceId: string,
  recipientPublicKey: string,
): Promise<NativeDeviceVaultKeyPacket> => JSON.parse(
  await bridge().shareVaultKey(sessionHandle, recipientDeviceId, recipientPublicKey),
) as NativeDeviceVaultKeyPacket;

export async function openVaultSession(accountId: string): Promise<string> {
  requireIdentifier(accountId, "Account identifier");
  return bridge().openSession(accountId);
}

export async function closeVaultSession(sessionHandle: string): Promise<void> {
  requireIdentifier(sessionHandle, "Session handle");
  await bridge().closeSession(sessionHandle);
}

export function lockAllVaultSessions(): void {
  nativeBridge?.lockAll();
}

export const encryptNativeItem = (
  sessionHandle: string,
  item: unknown,
  itemId: string,
): Promise<NativeEncryptedItem> => bridge().encryptItem(sessionHandle, JSON.stringify(item), itemId);
export const decryptNativeItem = async (
  sessionHandle: string,
  encryptedItemKey: unknown,
  encryptedPayload: unknown,
  itemId: string,
): Promise<unknown> => JSON.parse(await bridge().decryptItem(
  sessionHandle,
  JSON.stringify(encryptedItemKey),
  JSON.stringify(encryptedPayload),
  itemId,
)) as unknown;
export const generateNativeRecoveryPacket = (sessionHandle: string, recoveryCode: string): Promise<string> =>
  bridge().generateRecoveryPacket(sessionHandle, recoveryCode);
/** @deprecated v1 migration only; requires an already-unlocked account. */
export const restoreNativeRecoveryPacket = (
  accountId: string,
  recoveryCode: string,
  packet: unknown,
): Promise<string> => bridge().restoreRecoveryPacket(accountId, recoveryCode, JSON.stringify(packet));
export const openNativeRecoveryV2 = (
  recoveryCode: string,
  packet: NativeRecoveryPacketV2,
): Promise<NativeRecoveryV2Open> => {
  requireIdentifier(recoveryCode, "Recovery code");
  return bridge().openRecoveryV2(recoveryCode, JSON.stringify(packet));
};
export const prepareNativeRecoveryRotation = async (
  email: string,
  sessionHandle: string,
): Promise<NativeRecoveryV2Rotation> => {
  requireEmail(email);
  requireIdentifier(sessionHandle, "Session handle");
  const result = await bridge().prepareRecoveryRotation(email, sessionHandle);
  return {
    recoveryCode: result.recoveryCode,
    recoveryPacket: JSON.parse(result.recoveryPacketJson) as NativeRecoveryPacketV2,
    signingPublicKey: result.signingPublicKey,
  };
};
export const signNativeRecoveryFinish = (
  recoveryProofHandle: string,
  transcriptBase64Url: string,
): Promise<string> => {
  requireIdentifier(recoveryProofHandle, "Recovery proof handle");
  if (
    !/^[A-Za-z0-9_-]+$/u.test(transcriptBase64Url) ||
    transcriptBase64Url.length > 87_384
  ) {
    throw new ZeroVaultNativeError("INVALID_ARGUMENT", "Recovery transcript is invalid");
  }
  return bridge().signRecoveryFinish(recoveryProofHandle, transcriptBase64Url);
};
export const cancelNativeRecovery = (
  recoveryProofHandle: string,
  sessionHandle: string,
): Promise<void> => {
  requireIdentifier(recoveryProofHandle, "Recovery proof handle");
  requireIdentifier(sessionHandle, "Session handle");
  return bridge().cancelRecovery(recoveryProofHandle, sessionHandle);
};
export const generateNativePassword = (
  length: number,
  options = { upper: true, lower: true, digits: true, symbols: true },
): string => bridge().generatePassword(length, options.upper, options.lower, options.digits, options.symbols);
export const generateNativeTotp = (secretOrUri: string, timestampSeconds: number): NativeTotp =>
  bridge().generateTotp(secretOrUri, timestampSeconds);

export async function listCiphertexts(accountId: string): Promise<NativeStoredCiphertext[]> {
  return bridgeFor(accountId).listCiphertexts(accountId);
}

export async function getCiphertext(accountId: string, itemId: string): Promise<NativeStoredCiphertext | null> {
  requireIdentifier(itemId, "Item identifier");
  return bridgeFor(accountId).getCiphertext(accountId, itemId);
}

export async function upsertCiphertext(accountId: string, item: NativeStoredCiphertext): Promise<void> {
  validateStoredCiphertext(item);
  await bridgeFor(accountId).upsertCiphertext(
    accountId,
    item.itemId,
    item.ciphertextEnvelopeJson,
    item.itemRevision,
    item.lastSyncedAt,
    item.hasConflict,
  );
}

export async function deleteCiphertext(accountId: string, itemId: string): Promise<void> {
  requireIdentifier(itemId, "Item identifier");
  await bridgeFor(accountId).deleteCiphertext(accountId, itemId);
}

export async function getSyncMetadata(accountId: string): Promise<NativeSyncMetadata> {
  return bridgeFor(accountId).getSyncMetadata(accountId);
}

export async function setSyncMetadata(accountId: string, metadata: NativeSyncMetadata): Promise<void> {
  requireSafeInteger(metadata.serverRevision, "Server revision");
  await bridgeFor(accountId).setSyncMetadata(
    accountId,
    metadata.serverRevision,
    metadata.lastSyncedAt,
    metadata.serverCursor ?? null,
  );
}

export async function setConflictIds(accountId: string, itemIds: string[]): Promise<void> {
  itemIds.forEach((itemId) => requireIdentifier(itemId, "Item identifier"));
  await bridgeFor(accountId).setConflictIds(accountId, itemIds);
}

export async function clearCiphertexts(accountId: string): Promise<void> {
  await bridgeFor(accountId).clearCiphertexts(accountId);
}

export async function upsertLocalCiphertextAndEnqueue(
  accountId: string,
  item: NativeStoredCiphertext,
  baseItemRevision: number | null,
  clientMutationId: string,
): Promise<void> {
  validateStoredCiphertext(item);
  await bridgeFor(accountId).upsertLocalCiphertextAndEnqueue(
    accountId,
    item.itemId,
    item.ciphertextEnvelopeJson,
    item.itemRevision,
    item.lastSyncedAt,
    baseItemRevision,
    clientMutationId,
  );
}

export const deleteLocalAndEnqueue = (
  accountId: string,
  itemId: string,
  baseItemRevision: number | null,
  clientMutationId: string,
  createdAt: string,
): Promise<void> => bridgeFor(accountId).deleteLocalAndEnqueue(
  accountId,
  itemId,
  baseItemRevision,
  clientMutationId,
  createdAt,
);
export const listPendingMutations = (accountId: string): Promise<NativePendingMutation[]> =>
  bridgeFor(accountId).listPendingMutations(accountId);
export const ackMutations = (
  accountId: string,
  acknowledgements: NativeMutationAcknowledgement[],
  serverRevision: number,
  timestamp: string,
): Promise<void> => {
  acknowledgements.forEach(({ clientMutationId, appliedItemRevision }) => {
    requireIdentifier(clientMutationId, "Client mutation identifier");
    requireSafeInteger(appliedItemRevision, "Applied item revision");
  });
  requireSafeInteger(serverRevision, "Server revision");
  return bridgeFor(accountId).ackMutations(
    accountId,
    JSON.stringify(acknowledgements),
    serverRevision,
    timestamp,
  );
};
export const applyPullAtomically = (
  accountId: string,
  items: unknown[],
  deletedItems: NativeDeletedItem[],
  serverRevision: number,
  cursor: number,
  timestamp: string,
): Promise<void> => {
  deletedItems.forEach(({ id, revision, deletedAt }) => {
    requireIdentifier(id, "Deleted item identifier");
    requireSafeInteger(revision, "Deleted item revision");
    requireIdentifier(deletedAt, "Deleted item timestamp");
  });
  return bridgeFor(accountId).applyPull(
    accountId,
    JSON.stringify(items),
    JSON.stringify(deletedItems),
    serverRevision,
    cursor,
    timestamp,
  );
};
export const saveSyncConflicts = (accountId: string, conflicts: unknown[]): Promise<void> =>
  bridgeFor(accountId).saveConflicts(accountId, JSON.stringify(conflicts));
export const listSyncConflicts = (accountId: string): Promise<NativeSyncConflict[]> =>
  bridgeFor(accountId).listConflicts(accountId);
export const resolveSyncConflict = (
  accountId: string,
  itemId: string,
  resolution: "keep_local" | "accept_remote" | "create_copy" | "skip",
  replacement: unknown | null = null,
  clientMutationId: string | null = null,
): Promise<void> => bridgeFor(accountId).resolveConflict(
  accountId,
  itemId,
  resolution,
  replacement == null ? null : JSON.stringify(replacement),
  clientMutationId,
);

function bridgeFor(accountId: string): ZeroVaultNativeBridge {
  requireIdentifier(accountId, "Account identifier");
  return bridge();
}

function bridge(): ZeroVaultNativeBridge {
  if (!nativeBridge) {
    throw new ZeroVaultNativeError("NATIVE_UNAVAILABLE", "Native vault support is unavailable");
  }
  return nativeBridge;
}

function invalidInstalledAppsResponse(): ZeroVaultNativeError {
  return new ZeroVaultNativeError(
    "INVALID_NATIVE_RESPONSE",
    "Installed application metadata returned by Android is invalid",
  );
}

function invalidNativeBackupResponse(): ZeroVaultNativeError {
  return new ZeroVaultNativeError(
    "INVALID_NATIVE_RESPONSE",
    "Backup metadata returned by Android is invalid",
  );
}

function isNativeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNativeString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 4096) throw invalidNativeBackupResponse();
  return value;
}

function requireEmailAndPassword(email: string, password: string): void {
  requireEmail(email);
  if (password.length < 1 || password.length > 1024) {
    throw new ZeroVaultNativeError("INVALID_ARGUMENT", "Authentication input is invalid");
  }
}

function requireEmail(email: string): void {
  if (email.trim() !== email || !email.includes("@") || email.length > 320 || /\s/u.test(email)) {
    throw new ZeroVaultNativeError("INVALID_ARGUMENT", "Email address is invalid");
  }
}

function requireIdentifier(value: string, name: string): void {
  if (!value.trim() || value.length > 4096) {
    throw new ZeroVaultNativeError("INVALID_ARGUMENT", `${name} is invalid`);
  }
}

function requireSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ZeroVaultNativeError("INVALID_ARGUMENT", `${name} is invalid`);
  }
}

function validateStoredCiphertext(item: NativeStoredCiphertext): void {
  requireIdentifier(item.itemId, "Item identifier");
  if (!item.ciphertextEnvelopeJson.trim() || item.ciphertextEnvelopeJson.length > 1_048_576) {
    throw new ZeroVaultNativeError("INVALID_ARGUMENT", "Ciphertext envelope is invalid");
  }
  requireSafeInteger(item.itemRevision, "Item revision");
}
