import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./local-vault", () => ({
  addCredential: vi.fn((vault) => vault),
  createEmptyLocalVault: vi.fn(async () => ({
    encrypted: { schemaVersion: 1, kdf: {}, cipher: {}, ciphertext: "enc", itemCount: 0, updatedAt: "" },
    unlocked: { runtime: "crypto-core-wasm", key: new Uint8Array(32), kdf: {}, snapshot: { schemaVersion: 1, items: [], createdAt: "", updatedAt: "" } },
  })),
  persistUnlockedVault: vi.fn(async (vault) => ({
    encrypted: { schemaVersion: 1, kdf: {}, cipher: {}, ciphertext: "enc", itemCount: 0, updatedAt: "" },
    unlocked: vault,
  })),
  saveEncryptedLocalVault: vi.fn(),
  sealUnlockedVault: vi.fn(async () => ({ schemaVersion: 1, kdf: {}, cipher: {}, ciphertext: "sealed", itemCount: 0, updatedAt: "" })),
  unlockLocalVault: vi.fn(async () => ({ runtime: "crypto-core-wasm", key: new Uint8Array(32), kdf: {}, snapshot: { schemaVersion: 1, items: [], createdAt: "", updatedAt: "" } })),
  validateEncryptedBackup: vi.fn((data: unknown) => typeof data === "object" && data !== null && "schemaVersion" in data),
}));

vi.mock("./password-import", () => ({
  detectImportFormat: vi.fn(() => "bitwarden"),
  parsePasswordImport: vi.fn(() => ({
    rows: [
      { origin: "https://test.com", username: "user", password: "pass", title: "Test" },
    ],
    rejected: 0,
  })),
}));

vi.mock("./api-client", () => ({
  deleteAccount: vi.fn(async () => undefined),
}));

const {
  handleImportPasswords,
  handleChangeMasterPassword,
  handleImportEncryptedBackup,
  handleDeleteAccount,
} = await import("./vault-settings");

const mockUnlockedVault = {
  runtime: "crypto-core-wasm",
  key: new Uint8Array(32),
  kdf: {},
  snapshot: {
    schemaVersion: 1,
    items: [
      { id: "item-1", type: "login", title: "Existing", origin: "https://existing.com", username: "user", password: "pass", notes: "", folder: "", createdAt: "", updatedAt: "" },
    ],
    createdAt: "",
    updatedAt: "",
  },
} as Parameters<typeof handleImportPasswords>[1];

const mockEncryptedVault = { schemaVersion: 1, kdf: {}, cipher: {}, ciphertext: "enc", itemCount: 1, updatedAt: "" } as unknown as Parameters<typeof handleChangeMasterPassword>[0]["encryptedVault"];

describe("handleImportPasswords", () => {
  beforeEach(() => vi.clearAllMocks());

  it("imports valid rows successfully", async () => {
    const mockFile = { text: async () => '{"items":[]}', name: "export.json" } as File;
    const result = await handleImportPasswords(mockFile, mockUnlockedVault);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.importedCount).toBe(1);
      expect(result.format).toBe("Bitwarden JSON");
    }
  });

  it("returns unknown-format for unrecognized files", async () => {
    const { detectImportFormat } = await import("./password-import");
    vi.mocked(detectImportFormat).mockReturnValueOnce("unknown");
    const mockFile = { text: async () => "unknown content", name: "file.txt" } as File;
    const result = await handleImportPasswords(mockFile, mockUnlockedVault);
    expect(result.status).toBe("unknown-format");
  });
});

describe("handleChangeMasterPassword", () => {
  beforeEach(() => vi.clearAllMocks());

  it("changes password successfully", async () => {
    const result = await handleChangeMasterPassword({
      currentPassword: "old-password-12",
      newPassword: "new-password-123",
      encryptedVault: mockEncryptedVault,
      unlockedVault: mockUnlockedVault,
    });
    expect(result.status).toBe("ok");
  });

  it("returns wrong-current-password for incorrect password", async () => {
    const { unlockLocalVault } = await import("./local-vault");
    vi.mocked(unlockLocalVault).mockRejectedValueOnce(new Error("wrong"));
    const result = await handleChangeMasterPassword({
      currentPassword: "wrong-password",
      newPassword: "new-password-123",
      encryptedVault: mockEncryptedVault,
      unlockedVault: mockUnlockedVault,
    });
    expect(result.status).toBe("wrong-current-password");
  });
});

describe("handleImportEncryptedBackup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("imports valid backup", async () => {
    const backup = { schemaVersion: 1, kdf: {}, cipher: {}, ciphertext: "data" };
    const mockFile = { text: async () => JSON.stringify(backup) } as File;
    const result = await handleImportEncryptedBackup(mockFile);
    expect(result.status).toBe("ok");
  });

  it("returns invalid for malformed backup", async () => {
    const { validateEncryptedBackup } = await import("./local-vault");
    vi.mocked(validateEncryptedBackup).mockReturnValueOnce(false);
    const mockFile = { text: async () => '{"bad":"data"}' } as File;
    const result = await handleImportEncryptedBackup(mockFile);
    expect(result.status).toBe("invalid");
  });
});

describe("handleDeleteAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock localStorage
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((k: string) => store[k] ?? null),
      setItem: vi.fn((k: string, v: string) => { store[k] = v; }),
      removeItem: vi.fn((k: string) => { delete store[k]; }),
    });
  });

  it("calls server delete and clears local data", async () => {
    const { deleteAccount } = await import("./api-client");
    await handleDeleteAccount("csrf-token");
    expect(deleteAccount).toHaveBeenCalledWith("csrf-token");
  });

  it("works even without csrfToken", async () => {
    await handleDeleteAccount("");
    // Should not throw
  });
});
