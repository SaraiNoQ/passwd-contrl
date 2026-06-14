import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./api-client", () => ({
  fetchRecoveryPacket: vi.fn(async () => null),
  pullVault: vi.fn(async () => ({ serverRevision: 0, items: [], deletedItemIds: [] })),
  saveRecoveryPacketToServer: vi.fn(async () => undefined),
}));

vi.mock("./local-vault", () => ({
  addCredential: vi.fn((vault) => vault),
  createEmptyLocalVault: vi.fn(async () => ({
    encrypted: { schemaVersion: 1, kdf: {}, cipher: {}, ciphertext: "enc", itemCount: 0, updatedAt: "" },
    unlocked: { runtime: "crypto-core-wasm", key: new Uint8Array(32), kdf: {}, snapshot: { schemaVersion: 1, items: [], createdAt: "", updatedAt: "" } },
  })),
  persistUnlockedVault: vi.fn(async (vault) => ({ encrypted: { schemaVersion: 1, kdf: {}, cipher: {}, ciphertext: "enc", itemCount: 0, updatedAt: "" }, unlocked: vault })),
  saveEncryptedLocalVault: vi.fn(),
  unlockLocalVaultWithRecoveredKey: vi.fn(async () => ({
    runtime: "crypto-core-wasm",
    key: new Uint8Array(32),
    kdf: {},
    snapshot: { schemaVersion: 1, items: [{ id: "item-1", type: "login", title: "Test", origin: "https://test.com", username: "user", password: "pass", notes: "", folder: "", createdAt: "", updatedAt: "" }], createdAt: "", updatedAt: "" },
  })),
}));

vi.mock("./sync-vault", () => ({
  mergeRemoteItems: vi.fn(async (vault) => ({ vault, revisionMap: {} })),
}));

vi.mock("./recovery", () => ({
  generateRecoveryCode: vi.fn(() => "test-recovery-code-abc123"),
  createRecoveryPacket: vi.fn(async () => ({ alg: "AES_256_GCM" as const, nonce: "AA", ciphertext: "BB", kdfIterations: 2 })),
  recoverVaultKey: vi.fn(async () => new Uint8Array(32)),
  saveRecoveryPacket: vi.fn(),
  loadRecoveryPacket: vi.fn(() => null),
}));

const { handleCreateRecoveryCode, handleRecoverVault } = await import("./vault-recovery");

describe("handleCreateRecoveryCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates recovery code and saves packet", async () => {
    const mockVault = {
      runtime: "crypto-core-wasm",
      key: new Uint8Array(32),
    } as Parameters<typeof handleCreateRecoveryCode>[0]["unlockedVault"];
    const result = await handleCreateRecoveryCode({ unlockedVault: mockVault, csrfToken: "token" });
    expect(result.code).toBe("test-recovery-code-abc123");
  });

  it("saves packet to server when csrfToken provided", async () => {
    const { saveRecoveryPacketToServer } = await import("./api-client");
    const mockVault = { runtime: "crypto-core-wasm", key: new Uint8Array(32) } as Parameters<typeof handleCreateRecoveryCode>[0]["unlockedVault"];
    await handleCreateRecoveryCode({ unlockedVault: mockVault, csrfToken: "token" });
    expect(saveRecoveryPacketToServer).toHaveBeenCalled();
  });
});

describe("handleRecoverVault", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns no-code when recovery code is empty", async () => {
    const result = await handleRecoverVault({ recoveryInputCode: "", recoveryPassword: "new-password-12", encryptedVault: null });
    expect(result.status).toBe("no-code");
  });

  it("returns password-too-short when password < 12 chars", async () => {
    const result = await handleRecoverVault({ recoveryInputCode: "valid-code", recoveryPassword: "short", encryptedVault: null });
    expect(result.status).toBe("password-too-short");
  });

  it("returns no-packet when no recovery packet found", async () => {
    const { loadRecoveryPacket } = await import("./recovery");
    const { fetchRecoveryPacket } = await import("./api-client");
    vi.mocked(loadRecoveryPacket).mockReturnValue(null);
    vi.mocked(fetchRecoveryPacket).mockResolvedValue(null);
    const result = await handleRecoverVault({ recoveryInputCode: "valid-code", recoveryPassword: "new-password-12", encryptedVault: null });
    expect(result.status).toBe("no-packet");
  });

  it("recovers vault successfully with local encrypted vault", async () => {
    const { loadRecoveryPacket } = await import("./recovery");
    vi.mocked(loadRecoveryPacket).mockReturnValue({ alg: "AES_256_GCM", nonce: "AA", ciphertext: "BB", kdfIterations: 2 });
    const mockEncrypted = { schemaVersion: 1 } as Parameters<typeof handleRecoverVault>[0]["encryptedVault"];
    const result = await handleRecoverVault({ recoveryInputCode: "valid-code", recoveryPassword: "new-password-12", encryptedVault: mockEncrypted });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.recoveredCount).toBeGreaterThan(0);
    }
  });
});
