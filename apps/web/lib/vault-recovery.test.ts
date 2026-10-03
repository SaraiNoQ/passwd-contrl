import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recoveredItems } = vi.hoisted(() => ({
  recoveredItems: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      type: "login",
      title: "Test",
      origin: "https://test.com",
      username: "user",
      password: "pass",
      notes: "login notes",
      folder: "work",
      customFields: [{ name: "tenant", value: "alpha", fieldType: "text" }],
      totp: "JBSWY3DPEHPK3PXP",
      androidAssociations: [{
        packageName: "com.example.app",
        signingCertificateSha256: "A".repeat(64),
      }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      type: "secure_note",
      title: "Recovery note",
      noteBody: "keep this body",
      notes: "note metadata",
      folder: "private",
      customFields: [{ name: "flag", value: "true", fieldType: "boolean" }],
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      type: "credit_card",
      title: "Travel card",
      cardholderName: "Ada Lovelace",
      cardNumber: "4111111111111111",
      expirationMonth: "12",
      expirationYear: "2030",
      cvv: "123",
      brand: "Visa",
      notes: "card metadata",
      folder: "travel",
      customFields: [],
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
  ],
}));

vi.mock("./api-client", () => ({
  fetchRecoveryPacket: vi.fn(async () => null),
  pullVault: vi.fn(async () => ({ serverRevision: 0, items: [], deletedItemIds: [] })),
}));

vi.mock("./local-vault", () => ({
  LOCAL_VAULT_STORAGE_KEY: "zero-vault.local.encrypted-vault.v1",
  createEmptyLocalVault: vi.fn(async () => ({
    encrypted: { schemaVersion: 1, kdf: {}, cipher: {}, ciphertext: "enc", itemCount: 0, updatedAt: "" },
    unlocked: { runtime: "crypto-core-wasm", key: new Uint8Array(32), kdf: {}, snapshot: { schemaVersion: 1, items: [], createdAt: "", updatedAt: "" } },
  })),
  saveEncryptedLocalVault: vi.fn(),
  sealUnlockedVault: vi.fn(async () => ({
    schemaVersion: 1,
    runtime: "crypto-core-wasm",
    kdf: {},
    cipher: {},
    itemCount: recoveredItems.length,
    updatedAt: "2026-07-20T00:00:00.000Z",
  })),
  unlockLocalVaultWithRecoveredKey: vi.fn(async () => ({
    runtime: "crypto-core-wasm",
    key: new Uint8Array(32),
    kdf: {},
    snapshot: {
      schemaVersion: 1,
      items: recoveredItems,
      createdAt: "",
      updatedAt: "",
    },
  })),
  validateEncryptedBackup: vi.fn(() => true),
}));

vi.mock("./sync-vault", () => ({
  getSyncedLocalVaultItem: vi.fn(() => null),
  loadItemRevisionMap: vi.fn(() => ({ existing: 7 })),
  loadPendingItemMutations: vi.fn(() => ({
    "11111111-1111-4111-8111-111111111111": {
      itemUpdatedAt: "2026-02-01T00:00:00.000Z",
      clientMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      upsert: { encryptedPayload: { ciphertext: "old-key-ciphertext" } },
    },
  })),
  mergeRemoteItems: vi.fn(async (vault) => ({
    vault,
    revisionMap: {},
    mergedItemIds: [],
    failedItemIds: [],
  })),
  saveItemRevisionMap: vi.fn(),
  savePendingItemMutations: vi.fn(),
  syncItemToEncryptedVault: vi.fn(),
}));

vi.mock("./recovery", () => ({
  LEGACY_RECOVERY_MIGRATION_MESSAGE:
    "旧版 Web 恢复包仅保存在当前浏览器。请在支持 Recovery v2 的客户端完成迁移。",
  LEGACY_RECOVERY_PROTOCOL: "web-local-v1",
  RECOVERY_PACKET_STORAGE_KEY: "zero-vault.local.recovery-packet.v1",
  generateRecoveryCode: vi.fn(() => "test-recovery-code-abc123"),
  createRecoveryPacket: vi.fn(async () => ({ alg: "AES_256_GCM" as const, nonce: "AA", ciphertext: "BB", kdfIterations: 2 })),
  recoverVaultKey: vi.fn(async () => new Uint8Array(32)),
  saveRecoveryPacket: vi.fn(),
  loadRecoveryPacket: vi.fn(() => null),
}));

const { handleCreateRecoveryCode, handleRecoverVault } = await import("./vault-recovery");
const apiClient = await import("./api-client");
const localVault = await import("./local-vault");
const recovery = await import("./recovery");
const syncVault = await import("./sync-vault");

type RemoteItem = Awaited<ReturnType<typeof apiClient.pullVault>>["items"][number];
type RemoteEnvelope = RemoteItem["encryptedItemKey"];

const remoteEnvelope = (algorithm: RemoteEnvelope["alg"]): RemoteEnvelope =>
  algorithm === "AES_256_GCM"
    ? { alg: "AES_256_GCM", nonce: "AA", ciphertext: "BB" }
    : { alg: "XCHACHA20_POLY1305", nonce: "AA", ciphertext: "BB" };

const remoteItem = (
  id: string,
  keyAlgorithm: RemoteEnvelope["alg"],
  payloadAlgorithm: RemoteEnvelope["alg"],
): RemoteItem => ({
  id,
  ownerUserId: "77777777-7777-4777-8777-777777777777",
  revision: 1,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
  encryptedItemKey: remoteEnvelope(keyAlgorithm),
  encryptedPayload: remoteEnvelope(payloadAlgorithm),
  encryptedSearchTokens: [],
});

let storage: Map<string, string>;
const previousPendingMutations = {
  "11111111-1111-4111-8111-111111111111": {
    itemUpdatedAt: "2026-02-01T00:00:00.000Z",
    clientMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    upsert: { encryptedPayload: { ciphertext: "old-key-ciphertext" } },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  storage = new Map([
    [localVault.LOCAL_VAULT_STORAGE_KEY, "old-encrypted-vault"],
    [recovery.RECOVERY_PACKET_STORAGE_KEY, "old-recovery-packet"],
  ]);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
    },
  });
  vi.mocked(recovery.loadRecoveryPacket).mockReturnValue(null);
  vi.mocked(recovery.recoverVaultKey).mockResolvedValue(new Uint8Array(32));
  vi.mocked(apiClient.fetchRecoveryPacket).mockResolvedValue(null);
  vi.mocked(apiClient.pullVault).mockResolvedValue({
    serverRevision: 0,
    items: [],
    deletedItemIds: [],
  });
  vi.mocked(syncVault.getSyncedLocalVaultItem).mockReturnValue(null);
  vi.mocked(syncVault.loadItemRevisionMap).mockReturnValue({ existing: 7 });
  vi.mocked(syncVault.loadPendingItemMutations).mockReturnValue(
    previousPendingMutations as unknown as ReturnType<typeof syncVault.loadPendingItemMutations>
  );
  vi.mocked(localVault.saveEncryptedLocalVault).mockImplementation(() => undefined);
  vi.mocked(recovery.saveRecoveryPacket).mockImplementation(() => undefined);
  vi.mocked(syncVault.savePendingItemMutations).mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("handleCreateRecoveryCode", () => {
  it("generates recovery code and saves packet", async () => {
    const mockVault = {
      runtime: "crypto-core-wasm",
      key: new Uint8Array(32),
    } as Parameters<typeof handleCreateRecoveryCode>[0]["unlockedVault"];
    const result = await handleCreateRecoveryCode({ unlockedVault: mockVault, csrfToken: "token" });
    expect(result.code).toBe("test-recovery-code-abc123");
  });

  it("keeps the legacy packet local when a server session exists", async () => {
    const mockVault = { runtime: "crypto-core-wasm", key: new Uint8Array(32) } as Parameters<typeof handleCreateRecoveryCode>[0]["unlockedVault"];
    const result = await handleCreateRecoveryCode({ unlockedVault: mockVault, csrfToken: "token" });
    expect(result).toMatchObject({
      recoveryProtocol: "web-local-v1",
      serverUploadAttempted: false,
      migrationRequired: true,
    });
  });
});

describe("handleRecoverVault", () => {
  it("returns no-code when recovery code is empty", async () => {
    const result = await handleRecoverVault({ recoveryInputCode: "", recoveryPassword: "new-password-12", encryptedVault: null, csrfToken: "" });
    expect(result.status).toBe("no-code");
  });

  it("returns password-too-short when password < 12 chars", async () => {
    const result = await handleRecoverVault({ recoveryInputCode: "valid-code", recoveryPassword: "short", encryptedVault: null, csrfToken: "" });
    expect(result.status).toBe("password-too-short");
  });

  it("returns no-packet when no recovery packet found", async () => {
    const result = await handleRecoverVault({ recoveryInputCode: "valid-code", recoveryPassword: "new-password-12", encryptedVault: null, csrfToken: "" });
    expect(result.status).toBe("no-packet");
  });

  it("recovers vault successfully with local encrypted vault", async () => {
    vi.mocked(recovery.loadRecoveryPacket).mockReturnValue({ alg: "AES_256_GCM", nonce: "AA", ciphertext: "BB", kdfIterations: 2 });
    const mockEncrypted = { schemaVersion: 1 } as Parameters<typeof handleRecoverVault>[0]["encryptedVault"];
    const result = await handleRecoverVault({ recoveryInputCode: "valid-code", recoveryPassword: "new-password-12", encryptedVault: mockEncrypted, csrfToken: "token" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.recoveredCount).toBe(3);
      expect(result.recoveryCode).toBe("test-recovery-code-abc123");
      expect(result.unlocked.snapshot.items).toEqual(recoveredItems);
      expect(result.serverUploadAttempted).toBe(false);
      expect(result.migrationRequired).toBe(true);
    }
    expect(recovery.saveRecoveryPacket).toHaveBeenCalled();
    expect(syncVault.savePendingItemMutations).toHaveBeenNthCalledWith(1, {});
    expect(syncVault.savePendingItemMutations).toHaveBeenNthCalledWith(2, {});
  });

  it("keeps a recovered legacy packet local and reports the v2 migration boundary", async () => {
    vi.mocked(recovery.loadRecoveryPacket).mockReturnValue({ alg: "AES_256_GCM", nonce: "AA", ciphertext: "BB", kdfIterations: 2 });
    const mockEncrypted = { schemaVersion: 1 } as Parameters<typeof handleRecoverVault>[0]["encryptedVault"];
    const result = await handleRecoverVault({ recoveryInputCode: "valid-code", recoveryPassword: "new-password-12", encryptedVault: mockEncrypted, csrfToken: "token" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.serverUploadAttempted).toBe(false);
      expect(result.migrationMessage).toContain("Recovery v2");
      expect(result.recoveryCode).toBe("test-recovery-code-abc123");
    }
  });

  it("fails closed when any remote-only item cannot be decrypted", async () => {
    vi.mocked(recovery.loadRecoveryPacket).mockReturnValue({ alg: "AES_256_GCM", nonce: "AA", ciphertext: "BB", kdfIterations: 2 });
    const failedRemoteItem = remoteItem(
      "44444444-4444-4444-8444-444444444444",
      "XCHACHA20_POLY1305",
      "XCHACHA20_POLY1305",
    );
    vi.mocked(apiClient.pullVault).mockResolvedValue({
      serverRevision: 1,
      items: [failedRemoteItem],
      deletedItemIds: [],
    });
    vi.mocked(syncVault.mergeRemoteItems).mockImplementationOnce(async (vault) => ({
      vault,
      revisionMap: {},
      mergedItemIds: [],
      failedItemIds: [failedRemoteItem.id],
    }));

    const result = await handleRecoverVault({
      recoveryInputCode: "valid-code",
      recoveryPassword: "new-password-12",
      encryptedVault: null,
      csrfToken: "token",
    });

    expect(result).toMatchObject({
      status: "remote-items-failed",
      failedItemIds: [failedRemoteItem.id],
    });
    expect(syncVault.saveItemRevisionMap).toHaveBeenCalledWith({ existing: 7 });
    expect(localVault.saveEncryptedLocalVault).not.toHaveBeenCalled();
    expect(recovery.saveRecoveryPacket).not.toHaveBeenCalled();
  });

  it("refuses remote-only recovery when the legacy algorithm cannot be identified", async () => {
    vi.mocked(recovery.loadRecoveryPacket).mockReturnValue({ alg: "AES_256_GCM", nonce: "AA", ciphertext: "BB", kdfIterations: 2 });
    const mixedRemoteItem = remoteItem(
      "55555555-5555-4555-8555-555555555555",
      "AES_256_GCM",
      "XCHACHA20_POLY1305",
    );
    vi.mocked(apiClient.pullVault).mockResolvedValue({
      serverRevision: 1,
      items: [mixedRemoteItem],
      deletedItemIds: [],
    });

    const result = await handleRecoverVault({
      recoveryInputCode: "valid-code",
      recoveryPassword: "new-password-12",
      encryptedVault: null,
      csrfToken: "token",
    });

    expect(result.status).toBe("remote-only-unsupported");
    expect(syncVault.mergeRemoteItems).not.toHaveBeenCalled();
    expect(localVault.saveEncryptedLocalVault).not.toHaveBeenCalled();
  });

  it("imports the recovered raw key and merges AES remote-only items with the WebCrypto runtime", async () => {
    vi.mocked(recovery.loadRecoveryPacket).mockReturnValue({ alg: "AES_256_GCM", nonce: "AA", ciphertext: "BB", kdfIterations: 2 });
    const aesRemoteItem = remoteItem(
      "66666666-6666-4666-8666-666666666666",
      "AES_256_GCM",
      "AES_256_GCM",
    );
    vi.mocked(apiClient.pullVault).mockResolvedValue({
      serverRevision: 1,
      items: [aesRemoteItem],
      deletedItemIds: [],
    });
    const importKeySpy = vi.spyOn(globalThis.crypto.subtle, "importKey");
    let mergedRuntime: string | undefined;
    vi.mocked(syncVault.mergeRemoteItems).mockImplementationOnce(async (vault) => {
      mergedRuntime = vault.runtime;
      return {
        vault: {
          ...vault,
          snapshot: {
            ...vault.snapshot,
            items: recoveredItems as typeof vault.snapshot.items,
          },
        },
        revisionMap: { [aesRemoteItem.id]: 1 },
        mergedItemIds: [aesRemoteItem.id],
        failedItemIds: [],
      };
    });

    const result = await handleRecoverVault({
      recoveryInputCode: "valid-code",
      recoveryPassword: "new-password-12",
      encryptedVault: null,
      csrfToken: "token",
    });

    expect(result.status).toBe("ok");
    expect(mergedRuntime).toBe("webcrypto-mvp");
    expect(importKeySpy).toHaveBeenCalledWith(
      "raw",
      expect.any(ArrayBuffer),
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    expect(syncVault.mergeRemoteItems).toHaveBeenCalledOnce();
  });

  it("reports a server-managed Recovery v2 packet without treating it as missing", async () => {
    vi.mocked(apiClient.fetchRecoveryPacket).mockRejectedValueOnce(new Error("recovery_v2_managed"));

    const result = await handleRecoverVault({
      recoveryInputCode: "valid-code",
      recoveryPassword: "new-password-12",
      encryptedVault: null,
      csrfToken: "token",
    });

    expect(result.status).toBe("recovery-v2-managed");
    if (result.status === "recovery-v2-managed") {
      expect(result.message).toContain("Android");
    }
    expect(apiClient.pullVault).not.toHaveBeenCalled();
  });

  it("reports recovery packet transport errors without treating them as missing", async () => {
    vi.mocked(apiClient.fetchRecoveryPacket).mockRejectedValueOnce(new Error("network_error"));

    const result = await handleRecoverVault({
      recoveryInputCode: "valid-code",
      recoveryPassword: "new-password-12",
      encryptedVault: null,
      csrfToken: "token",
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("无法连接服务器");
    }
    expect(apiClient.pullVault).not.toHaveBeenCalled();
  });

  it("rolls back the vault, recovery packet and pending mutations when commit fails", async () => {
    vi.mocked(recovery.loadRecoveryPacket).mockReturnValue({ alg: "AES_256_GCM", nonce: "AA", ciphertext: "BB", kdfIterations: 2 });
    vi.mocked(localVault.saveEncryptedLocalVault).mockImplementationOnce(() => {
      window.localStorage.setItem(localVault.LOCAL_VAULT_STORAGE_KEY, "new-encrypted-vault");
    });
    vi.mocked(recovery.saveRecoveryPacket).mockImplementationOnce(() => {
      window.localStorage.setItem(recovery.RECOVERY_PACKET_STORAGE_KEY, "partial-new-packet");
      throw new Error("quota_exceeded");
    });

    const result = await handleRecoverVault({
      recoveryInputCode: "valid-code",
      recoveryPassword: "new-password-12",
      encryptedVault: { schemaVersion: 1 } as Parameters<typeof handleRecoverVault>[0]["encryptedVault"],
      csrfToken: "token",
    });

    expect(result.status).toBe("error");
    expect(storage.get(localVault.LOCAL_VAULT_STORAGE_KEY)).toBe("old-encrypted-vault");
    expect(storage.get(recovery.RECOVERY_PACKET_STORAGE_KEY)).toBe("old-recovery-packet");
    expect(syncVault.savePendingItemMutations).toHaveBeenNthCalledWith(1, {});
    expect(syncVault.savePendingItemMutations).toHaveBeenNthCalledWith(2, previousPendingMutations);
  });

  it("validates the new recovery packet before writing any rotated state", async () => {
    vi.mocked(recovery.loadRecoveryPacket).mockReturnValue({ alg: "AES_256_GCM", nonce: "AA", ciphertext: "BB", kdfIterations: 2 });
    vi.mocked(recovery.recoverVaultKey)
      .mockResolvedValueOnce(new Uint8Array(32))
      .mockResolvedValueOnce(new Uint8Array(32).fill(1));

    const result = await handleRecoverVault({
      recoveryInputCode: "valid-code",
      recoveryPassword: "new-password-12",
      encryptedVault: { schemaVersion: 1 } as Parameters<typeof handleRecoverVault>[0]["encryptedVault"],
      csrfToken: "token",
    });

    expect(result.status).toBe("error");
    expect(localVault.saveEncryptedLocalVault).not.toHaveBeenCalled();
    expect(recovery.saveRecoveryPacket).not.toHaveBeenCalled();
    expect(syncVault.savePendingItemMutations).not.toHaveBeenCalled();
  });
});
