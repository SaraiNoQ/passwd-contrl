import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  exportEncryptedBackupDocument: vi.fn(),
  stageBackupDocument: vi.fn(),
  restoreStagedEncryptedBackup: vi.fn(),
  importStagedCryptoCoreBackup: vi.fn(),
  discardStagedBackup: vi.fn(),
}));

vi.mock("expo", () => ({
  requireOptionalNativeModule: () => native,
}));

import {
  discardNativeStagedBackup,
  exportNativeEncryptedBackupDocument,
  importNativeStagedCryptoCoreBackup,
  restoreNativeStagedEncryptedBackup,
  stageNativeBackupDocument,
} from "@zero-vault/zero-vault-native";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = "22222222-2222-4222-8222-222222222222";

describe("native backup bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only bounded public metadata for a staged Android backup", async () => {
    native.stageBackupDocument.mockResolvedValue({
      status: "ready",
      operationId: OPERATION_ID,
      kind: "android",
      accountId: ACCOUNT_ID,
      backupId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-07-26T01:02:03.000Z",
      privatePath: "/data/user/0/secret",
      serialized: "{\"encryptedSnapshot\":\"must-not-cross-the-bridge\"}",
    });

    await expect(stageNativeBackupDocument("android")).resolves.toEqual({
      status: "ready",
      operationId: OPERATION_ID,
      kind: "android",
      accountId: ACCOUNT_ID,
      backupId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-07-26T01:02:03.000Z",
    });
    expect(native.stageBackupDocument).toHaveBeenCalledWith("android");
  });

  it("preserves a picker cancellation without inventing an operation identifier", async () => {
    native.stageBackupDocument.mockResolvedValue({ status: "cancelled", kind: "crypto-core" });

    await expect(stageNativeBackupDocument("crypto-core")).resolves.toEqual({
      status: "cancelled",
      kind: "crypto-core",
    });
  });

  it("fails closed on malformed staged metadata", async () => {
    native.stageBackupDocument.mockResolvedValue({
      status: "ready",
      operationId: "",
      kind: "android",
    });

    await expect(stageNativeBackupDocument("android")).rejects.toMatchObject({
      code: "INVALID_NATIVE_RESPONSE",
    });
  });

  it("routes export, restore, import and discard without backup JSON in JavaScript", async () => {
    native.exportEncryptedBackupDocument.mockResolvedValue({
      saved: true,
      backupId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-07-26T01:02:03.000Z",
    });
    native.importStagedCryptoCoreBackup.mockResolvedValue({ importedCount: 7 });

    await expect(exportNativeEncryptedBackupDocument(ACCOUNT_ID)).resolves.toMatchObject({
      saved: true,
    });
    await restoreNativeStagedEncryptedBackup(ACCOUNT_ID, OPERATION_ID);
    await expect(
      importNativeStagedCryptoCoreBackup(ACCOUNT_ID, OPERATION_ID, "backup-password"),
    ).resolves.toEqual({ importedCount: 7 });
    await discardNativeStagedBackup(OPERATION_ID);

    expect(native.exportEncryptedBackupDocument).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(native.restoreStagedEncryptedBackup).toHaveBeenCalledWith(ACCOUNT_ID, OPERATION_ID);
    expect(native.importStagedCryptoCoreBackup).toHaveBeenCalledWith(
      ACCOUNT_ID,
      OPERATION_ID,
      "backup-password",
    );
    expect(native.discardStagedBackup).toHaveBeenCalledWith(OPERATION_ID);
  });
});
