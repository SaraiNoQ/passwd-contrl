import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./local-vault", () => ({
  createEmptyLocalVault: vi.fn(async (pw: string) => ({
    encrypted: { schemaVersion: 1, kdf: {}, cipher: {}, ciphertext: "enc", itemCount: 0, updatedAt: new Date().toISOString() },
    unlocked: { runtime: "crypto-core-wasm", key: new Uint8Array(32), kdf: {}, snapshot: { schemaVersion: 1, items: [], createdAt: "", updatedAt: "" } },
  })),
  loadEncryptedLocalVault: vi.fn(() => null),
  saveEncryptedLocalVault: vi.fn(),
  unlockLocalVault: vi.fn(async (pw: string, ev: unknown) => ({
    runtime: "crypto-core-wasm",
    key: new Uint8Array(32),
    kdf: {},
    snapshot: { schemaVersion: 1, items: [], createdAt: "", updatedAt: "" },
  })),
}));

const { handleCreateVault, handleUnlockVault, handleLoadExistingVault } = await import("./vault-auth");
const { createEmptyLocalVault, saveEncryptedLocalVault, unlockLocalVault, loadEncryptedLocalVault } = await import("./local-vault");

describe("handleCreateVault", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates vault with valid password", async () => {
    const result = await handleCreateVault("valid-password-12");
    expect(result.encrypted).toBeDefined();
    expect(result.unlocked).toBeDefined();
    expect(saveEncryptedLocalVault).toHaveBeenCalled();
  });

  it("rejects password shorter than 12 chars", async () => {
    await expect(handleCreateVault("short")).rejects.toThrow("主密码至少需要 12 个字符。");
  });
});

describe("handleUnlockVault", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unlocks with correct password", async () => {
    const mockEncrypted = { schemaVersion: 1 } as unknown as Parameters<typeof handleUnlockVault>[1];
    const result = await handleUnlockVault("correct-password", mockEncrypted);
    expect(result).toBeDefined();
    expect(unlockLocalVault).toHaveBeenCalledWith("correct-password", mockEncrypted);
  });

  it("throws on wrong password", async () => {
    vi.mocked(unlockLocalVault).mockRejectedValueOnce(new Error("wrong_password"));
    await expect(handleUnlockVault("wrong", {} as Parameters<typeof handleUnlockVault>[1])).rejects.toThrow();
  });
});

describe("handleLoadExistingVault", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no vault exists", () => {
    vi.mocked(loadEncryptedLocalVault).mockReturnValue(null);
    expect(handleLoadExistingVault()).toBeNull();
  });

  it("returns vault when it exists", () => {
    const mockVault = { schemaVersion: 1 };
    vi.mocked(loadEncryptedLocalVault).mockReturnValue(mockVault as unknown as ReturnType<typeof loadEncryptedLocalVault>);
    expect(handleLoadExistingVault()).toEqual(mockVault);
  });
});
